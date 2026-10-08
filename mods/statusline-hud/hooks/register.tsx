// statusline-hud: a Claude Code mod port of statusline/statusline-command.sh, plus what a
// script status line can't do: live per-request accounting, subagent spend, rate-limit
// burn ETAs, cache-cold countdown and miss detection, per-turn cost, a one-key /compact,
// toasts, a dashboard pane and a tool the model can call to check its own budget.
// Surface-aware: on Claude Code Desktop it leaves out what the Code tab already shows.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { HudCompaction, HudLedger, HudRate, HudView } from '../types'
import { bar, cacheState, fmtDur, fmtTok, fmtUsd, outlook, parseGit, spark, spendOf, TTL_MS, WINDOW_MS, type Ttl } from './calc'
import {
  adviceFor,
  adviceText,
  allUsd,
  bandRows,
  compactLine,
  costBar,
  hitRatio,
  missCause,
  pctColor,
  projColor,
  report,
  shouldCompact,
  shows,
  totals,
  turnSoFar,
  turnTail,
  type Seg,
  type Surface,
} from './present'

const PANE = 'hud'
const TICK_MS = 15_000
const HISTORY = 60
const KEEP_SESSIONS = 40
const KEEP_DAYS = 35

const EMPTY: HudLedger = {
  reqs: 0, in: 0, rd: 0, wr: 0, out: 0, usdIn: 0, usdRd: 0, usdWr: 0, usdOut: 0,
  agentReqs: 0, agentUsd: 0, ctxHistory: [], usdHistory: [], tools: {}, turns: [],
  misses: 0, missUsd: 0, compactions: [], savedUsd: 0,
}

const view = atom({ plugin: 'statusline-hud', key: 'view' } as const, null)
const ledger = atom({ plugin: 'statusline-hud', key: 'ledger' } as const, EMPTY)
const isHidden = atom({ plugin: 'statusline-hud', key: 'isHidden' } as const, false)
const fired = atom({ plugin: 'statusline-hud', key: 'fired' } as const, [])
const turn = atom({ plugin: 'statusline-hud', key: 'turn' } as const, null)

type Opts = { display: string; density: string; cacheTtl: string; budgetUsd: number; alerts: boolean; turnCost: boolean }

function readOptions(o: PluginOptions): Opts {
  return {
    display: typeof o.display === 'string' ? o.display : 'band',
    density: typeof o.density === 'string' ? o.density : 'full',
    cacheTtl: typeof o.cacheTtl === 'string' ? o.cacheTtl : 'auto',
    budgetUsd: typeof o.budgetUsd === 'number' ? o.budgetUsd : 0,
    alerts: typeof o.alerts === 'boolean' ? o.alerts : true,
    turnCost: typeof o.turnCost === 'boolean' ? o.turnCost : true,
  }
}

const push = <T,>(list: readonly T[], v: T) => [...list, v].slice(-HISTORY)

/** Local calendar day, the key of the cross-session spend totals. */
function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function clockOf(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Which TTL the main conversation's cache writes get, by the precedence Claude Code documents. */
async function resolveTtl($: EngineInterface, opts: Opts, auth: HudView['auth'], rates: readonly HudRate[]): Promise<Ttl> {
  if (opts.cacheTtl === '5m' || opts.cacheTtl === '1h') return opts.cacheTtl
  if ((await $.env.get('FORCE_PROMPT_CACHING_5M')) === '1') return '5m'
  const pinned = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')
  if (pinned === '5m' || pinned === '1h') return pinned
  if ((await $.env.get('ENABLE_PROMPT_CACHING_1H')) === '1') return '1h'
  // One hour only on a subscription (OAuth sign-in) within plan usage; past it, usage credits get 5m.
  if (auth !== 'bearer' || rates.some(r => r.pct >= 100)) return '5m'
  return '1h'
}

/** Subagents, workflows, forks and compaction: five minutes unless pinned. */
async function resolveAgentTtl($: EngineInterface): Promise<Ttl> {
  if ((await $.env.get('FORCE_PROMPT_CACHING_5M')) === '1') return '5m'
  const pinned = await $.env.get('CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL')
  if (pinned === '5m' || pinned === '1h') return pinned
  return (await $.env.get('ENABLE_PROMPT_CACHING_1H')) === '1' ? '1h' : '5m'
}

async function osName($: EngineInterface): Promise<string> {
  const wsl = await $.env.get('WSL_DISTRO_NAME')
  if (wsl) return `WSL2 (${wsl})`
  if ((await $.env.get('OS')) === 'Windows_NT') return 'Windows'
  const uname = await $.process.run(['uname', '-s']).catch(() => undefined)
  const kernel = uname?.stdout.trim() ?? ''
  if (kernel === 'Darwin') {
    const sw = await $.process.run(['sw_vers', '-productVersion']).catch(() => undefined)
    return `macOS ${sw?.stdout.trim() ?? ''}`.trim()
  }
  const release = await $.fs.read('/etc/os-release').catch(() => '')
  const pretty = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(typeof release === 'string' ? release : '')?.[1]
  return pretty || kernel || 'unknown OS'
}

async function readGit($: EngineInterface): Promise<HudView['git']> {
  const status = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 5000 }).catch(() => undefined)
  if (!status || status.exitCode !== 0) return undefined
  const stat = await $.process.run(['git', 'diff', '--shortstat', 'HEAD'], { timeoutMs: 5000 }).catch(() => undefined)
  return parseGit(status.stdout, stat?.exitCode === 0 ? stat.stdout : '')
}

/** Subagents still at work, as the engine tracks them. */
async function agentsRunning($: EngineInterface): Promise<number> {
  const agents = await $.agent.list().catch(() => [])
  return agents.filter(a => a.status === 'pending' || a.status === 'running' || a.status === 'waiting').length
}

/** List-price spend today and over the last 7 days, across this machine's sessions. */
async function readSpend($: EngineInterface, now: number): Promise<HudView['spend']> {
  const days = ((await $.store.get('days')) as Record<string, number> | undefined) ?? {}
  let week = 0
  for (let i = 0; i < 7; i++) week += days[dayKey(now - i * 86_400_000)] ?? 0
  const today = days[dayKey(now)] ?? 0
  return week > 0 ? { today, week } : undefined
}

/** The surface the one-line texts are written for: the terminal when one draws, else the first. */
async function lineSurface($: EngineInterface): Promise<Surface> {
  const all = await $.session.surfaces()
  return all.includes('terminal') || all.length === 0 ? 'terminal' : all[0]!
}

/** Re-reads the engine's figures into `view`; git too when asked (it spawns processes). */
async function refresh($: EngineInterface, opts: Opts, withGit: boolean): Promise<void> {
  const [usage, model, now, cwd, running] = await Promise.all([
    $.session.usage(),
    $.session.model(),
    $.clock.now(),
    $.session.cwd(),
    agentsRunning($),
  ])
  const rates: HudRate[] = usage.rateLimits.map(r => ({
    kind: r.kind,
    pct: r.percentUsed,
    resetsAt: r.resetsAt ? Date.parse(r.resetsAt) : undefined,
  }))
  const prior = await read($, view)
  const auth = prior?.auth ?? (await $.session.authorize().then(a => (a ? a.kind : 'none')).catch(() => 'none' as const))
  const ttl = await resolveTtl($, opts, auth, rates)
  const git = withGit ? await readGit($) : undefined
  const spend = await readSpend($, now)
  await update($, view, prev => ({
    now,
    model,
    effort: prev?.effort,
    ctxTokens: usage.context.tokens,
    ctxWindow: usage.context.window,
    ctxPct: usage.context.percent,
    rates,
    costUsd: usage.cost?.usd,
    startedAt: usage.startedAt,
    ttl,
    auth,
    git: withGit ? git : prev?.git,
    cwdLeaf: cwd.split(/[\\/]/).filter(Boolean).pop(),
    os: prev?.os,
    version: prev?.version,
    agentsRunning: running,
    spend,
  }))
  if (opts.display !== 'band') await pushStatus($)
  if (opts.alerts) await alert($, opts)
}

async function pushStatus($: EngineInterface): Promise<void> {
  const [v, l] = await Promise.all([read($, view), read($, ledger)])
  if (v) $.ui.status(compactLine(v, l, await lineSurface($)))
}

/** Toasts each crossing once per session. */
async function alert($: EngineInterface, opts: Opts): Promise<void> {
  const [v, l, seen] = await Promise.all([read($, view), read($, ledger), read($, fired)])
  if (!v) return
  const now = v.now
  const due: [string, string][] = []
  const ctx = v.ctxPct ?? 0
  if (ctx >= 90) due.push(['ctx90', `Context ${ctx}% full: auto-compact is close. /compact at a natural break.`])
  else if (ctx >= 80) due.push(['ctx80', `Context ${ctx}% full. Consider /compact between tasks.`])
  if ((v.ctxTokens ?? 0) > 200_000) due.push(['cliff', 'Context past 200k tokens: long-context recall degrades.'])
  for (const r of v.rates) {
    const o = outlook(r.pct, r.resetsAt, WINDOW_MS[r.kind], now)
    if (o.hitsLimitInMs !== undefined && o.resetsInMs !== undefined && r.pct < 100)
      due.push([`pace:${r.kind}:${r.resetsAt}`, `${r.kind} limit: at this pace you hit 100% in ~${fmtDur(o.hitsLimitInMs)} (resets in ${fmtDur(o.resetsInMs)}).`])
  }
  if (opts.budgetUsd > 0 && (v.costUsd ?? 0) >= opts.budgetUsd)
    due.push(['budget', `Session cost ${fmtUsd(v.costUsd ?? 0)} passed your ${fmtUsd(opts.budgetUsd)} budget.`])
  const cache = cacheState(l.last?.at, v.ttl, now)
  if (l.last && (v.ctxTokens ?? 0) >= 60_000) {
    const rewrite = spendOf({ in: 0, rd: 0, wr: v.ctxTokens ?? 0, out: 0 }, v.model, v.ttl).total
    if (cache.warm && cache.leftMs <= 60_000)
      due.push([`cooling:${l.last.at}`, `Prompt cache goes cold in ${fmtDur(cache.leftMs)}: the next prompt after that re-writes ${fmtTok(v.ctxTokens ?? 0)} tokens (~${fmtUsd(rewrite)}).`])
    else if (!cache.warm) {
      const advice = adviceFor(v, l)
      const tip = advice.kind === 'cold' && advice.netNowUsd > 0 ? ` /compact first is ~${fmtUsd(advice.netNowUsd)} cheaper.` : ''
      due.push([`cold:${l.last.at}`, `Prompt cache went cold: the next prompt re-writes ${fmtTok(v.ctxTokens ?? 0)} tokens (~${fmtUsd(rewrite)}).${tip}`])
    }
  }
  const fresh = due.filter(([key]) => !seen.includes(key))
  if (fresh.length === 0) return
  await update($, fired, list => [...list, ...fresh.map(([key]) => key)].slice(-200))
  for (const [, text] of fresh) $.ui.toast(text, { timeoutMs: 8000 })
}

async function storeKey($: EngineInterface): Promise<string> {
  return `ledger:${await $.session.id()}`
}

/**
 * Keeps the ledger across reloads and resumes (newest sessions only, so the store stays small)
 * and adds what was priced since the last save to today's cross-session total.
 */
async function saveLedger($: EngineInterface): Promise<void> {
  const [l, now] = await Promise.all([read($, ledger), $.clock.now()])
  const spent = allUsd(l)
  if (spent > l.savedUsd) {
    const days = ((await $.store.get('days')) as Record<string, number> | undefined) ?? {}
    const today = dayKey(now)
    days[today] = (days[today] ?? 0) + (spent - l.savedUsd)
    const keep = Object.keys(days).sort().slice(-KEEP_DAYS)
    await $.store.set('days', Object.fromEntries(keep.map(k => [k, days[k]!])))
  }
  const saved = await update($, ledger, x => ({ ...x, savedUsd: spent }))
  const key = await storeKey($)
  await $.store.set(key, saved)
  const index = ((await $.store.get('ledgers')) as string[] | undefined) ?? []
  const kept = [...index.filter(k => k !== key), key]
  for (const old of kept.slice(0, -KEEP_SESSIONS)) await $.store.delete(old)
  await $.store.set('ledgers', kept.slice(-KEEP_SESSIONS))
}

async function compactNow($: EngineInterface): Promise<void> {
  try {
    const r = await $.session.compact()
    if (r.skip !== undefined) $.ui.toast('Compaction skipped by a hook.')
  } catch {
    $.ui.toast('Compaction runs between turns: try again when the turn ends.')
  }
}

type Usage = { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; output_tokens: number }

/** Logs a main-conversation compaction: before/after, what the summarizer cost. */
async function recordCompaction($: EngineInterface, opts: Opts, c: Omit<HudCompaction, 'usd' | 'at'>, usage: Usage | undefined): Promise<void> {
  const [v, at] = await Promise.all([read($, view), $.clock.now()])
  const usd = usage
    ? spendOf(
        { in: usage.input_tokens, rd: usage.cache_read_input_tokens, wr: usage.cache_creation_input_tokens, out: usage.output_tokens },
        v?.model ?? '',
        await resolveAgentTtl($),
      ).total
    : 0
  await update($, ledger, l => ({ ...l, compactions: push(l.compactions, { ...c, usd, at }), compactedAt: at }))
  if (opts.alerts && c.before !== undefined && c.after !== undefined && c.before > 0) {
    const cut = Math.round((1 - c.after / c.before) * 100)
    $.ui.toast(`Compacted ${fmtTok(c.before)} → ${fmtTok(c.after)} tokens (−${cut}%) for ${fmtUsd(usd)}.`, { timeoutMs: 6000 })
  }
}

/** Books one main-loop response: ledger, the running turn, and a toast for an unexpected cache miss. */
async function bookMain($: EngineInterface, opts: Opts, model: string, effort: string | undefined, t: { in: number; rd: number; wr: number; out: number }): Promise<void> {
  const [v, l, at] = await Promise.all([read($, view), read($, ledger), $.clock.now()])
  const ttl = v?.ttl ?? '5m'
  const s = spendOf(t, model, ttl)
  const ctx = t.in + t.rd + t.wr
  const cause = missCause({ prev: l.last, cur: { model, rd: t.rd, wr: t.wr }, ttlMs: TTL_MS[ttl], now: at, compactedAt: l.compactedAt })
  await update($, ledger, x => ({
    ...x,
    reqs: x.reqs + 1,
    in: x.in + t.in, rd: x.rd + t.rd, wr: x.wr + t.wr, out: x.out + t.out,
    usdIn: x.usdIn + s.in, usdRd: x.usdRd + s.rd, usdWr: x.usdWr + s.wr, usdOut: x.usdOut + s.out,
    baseCtx: x.baseCtx ?? ctx,
    last: { model, ...t, usd: s.total, at, effort },
    ctxHistory: push(x.ctxHistory, ctx),
    usdHistory: push(x.usdHistory, s.total),
    misses: x.misses + (cause ? 1 : 0),
    missUsd: x.missUsd + (cause ? s.wr : 0),
  }))
  await update($, turn, cur => (cur ? { ...cur, usd: cur.usd + s.total, reqs: cur.reqs + 1 } : cur))
  await update($, view, prev => (prev ? { ...prev, effort } : prev))
  if (cause && opts.alerts)
    $.ui.toast(`Cache miss: re-wrote ${fmtTok(t.wr)} tokens (~${fmtUsd(s.wr)}) while the cache was warm. Likely cause: ${cause}.`, { timeoutMs: 8000 })
}

export const register: Register = (on, options) => {
  const opts = readOptions(options)
  const showBand = opts.display !== 'status'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hud',
      description: 'Status HUD: toggle the band, open the dashboard, print a report',
      argumentHint: '[pane | status | reset]',
    })
    await $.tool.register({
      name: 'usage',
      description:
        'Live budget for this Claude Code session: context fill, rate-limit windows with pace projections, ' +
        'cost, prompt-cache warmth and misses, and whether /compact pays off now. Check before starting a large task.',
    })
    const saved = (await $.store.get(await storeKey($))) as Partial<HudLedger> | undefined
    if (saved && typeof saved.reqs === 'number') await update($, ledger, () => ({ ...EMPTY, ...saved }))
    const [os, version] = await Promise.all([osName($), $.session.version()])
    await refresh($, opts, true)
    await update($, view, prev => (prev ? { ...prev, os, version: version.version } : prev))
    let ticks = 0
    $.clock.every(TICK_MS, () => {
      ticks += 1
      void refresh($, opts, ticks % 4 === 0).catch(() => undefined)
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, ledger, () => EMPTY)
      await update($, fired, () => [])
      await update($, turn, () => null)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const v = await read($, view)
    await update($, turn, () => ({ id: e.turnId, usd: 0, reqs: 0, startCtx: v?.ctxTokens }))
    return next(e)
  })

  // Every model request, main loop and subagents: the per-request ledger a script status line can't keep.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (!usage) return result
    try {
      const t = { in: usage.input_tokens, rd: usage.cache_read_input_tokens, wr: usage.cache_creation_input_tokens, out: usage.output_tokens }
      if (e.agentId !== undefined) {
        const s = spendOf(t, usage.model, await resolveAgentTtl($))
        await update($, ledger, l => ({ ...l, agentReqs: l.agentReqs + 1, agentUsd: l.agentUsd + s.total }))
        await update($, turn, cur => (cur ? { ...cur, usd: cur.usd + s.total } : cur))
        return result
      }
      await bookMain($, opts, usage.model, e.effort === undefined ? undefined : String(e.effort), t)
      await refresh($, opts, false)
    } catch {
      // bookkeeping never gets in the way of the response
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    await update($, ledger, l => ({ ...l, tools: { ...l.tools, [name]: (l.tools[name] ?? 0) + 1 } }))
    return next(e)
  }).catch(($, e, next) => next(e)) // a counter, not a guard: never stands in a call's way

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await refresh($, opts, true)
      const [cur, v] = await Promise.all([read($, turn), read($, view)])
      const ctxDelta = cur?.startCtx !== undefined && v?.ctxTokens !== undefined ? v.ctxTokens - cur.startCtx : 0
      await update($, ledger, l => ({ ...l, turns: push(l.turns, { durationMs: e.durationMs, usd: cur?.usd ?? 0, reqs: cur?.reqs ?? 0, ctxDelta }) }))
      await update($, turn, () => null)
      await saveLedger($)
    }
    return next(e)
  })

  // Observes compactions (the person's /compact, auto-compact, the HUD's button) without steering them.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && r.skip === undefined)
      await recordCompaction($, opts, { before: r.tokensBefore, after: r.tokensAfter, trigger: String(e.trigger) }, r.usage)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__statusline-hud__usage' }, async $ => {
    await refresh($, opts, false)
    const [v, l] = await Promise.all([read($, view), read($, ledger)])
    return { result: v ? report(v, l) : 'No usage figures yet.' }
  }).catch(() => ({ result: 'Usage figures are unavailable right now.' }))

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'pane') {
      const opened = await $.ui.open({ id: PANE, title: 'Session HUD' })
      return { text: opened.isPlaced ? 'HUD dashboard opened.' : 'HUD dashboard queued: widen the terminal to place it.' }
    }
    if (arg === 'status') {
      await refresh($, opts, true)
      const [v, l] = await Promise.all([read($, view), read($, ledger)])
      return { text: v ? report(v, l) : 'No usage figures yet.' }
    }
    if (arg === 'reset') {
      await update($, ledger, () => EMPTY)
      await update($, fired, () => [])
      return { text: 'HUD ledger reset for this session.' }
    }
    const hidden = await update($, isHidden, h => !h)
    return { text: hidden ? 'HUD band hidden (/hud to show).' : 'HUD band shown.' }
  })

  // ---------- drawing ----------

  type Els = ReturnType<EngineInterface['ui']['resolve']>

  function Row(els: Els, segs: readonly Seg[]) {
    const { Box, Text } = els
    return (
      <Box flexDirection="row" flexWrap="wrap">
        {segs.map(s => (
          <Text color={s.c} dimColor={s.dim} bold={s.bold}>
            {s.t}
          </Text>
        ))}
      </Box>
    )
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!showBand || e.props.hasSurvey) return next(e)
    const [v, l, hidden] = await Promise.all([read($, view), read($, ledger), read($, isHidden)])
    if (!v || hidden) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Button } = els
    const rows = bandRows(v, l, {
      surface: e.surface,
      density: opts.density,
      budgetUsd: opts.budgetUsd,
      narrow: e.props.bodyColumns < 110,
      clock: clockOf(v.now),
    })
    const compact = shouldCompact(adviceFor(v, l)) && !e.props.isWorking
    const last = rows.length - 1
    return (
      <Box flexDirection="column">
        {rows.map((segs, i) => {
          const isAdvice = segs[0]?.t.startsWith('cmp') === true
          const isLast = i === last
          if (!(isAdvice && compact) && !isLast) return Row(els, segs)
          return (
            <Box flexDirection="row" gap={1}>
              {Row(els, segs)}
              {isAdvice && compact && <Button key="compact" label="Compact now" hotkey="c" variant="primary" onPress={() => compactNow($)} />}
              {isLast && <Button key="pane" label="dashboard" hotkey="d" plain onPress={() => void $.ui.open({ id: PANE, title: 'Session HUD' })} />}
              {isLast && <Button key="hide" label="hide" hotkey="h" plain onPress={() => update($, isHidden, () => true)} />}
            </Box>
          )
        })}
      </Box>
    )
  })

  // While a turn runs: what it has cost so far, beside the engine's own elapsed time and tokens.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!opts.turnCost) return next(e)
    const text = turnSoFar(await read($, turn))
    return text ? next({ ...e, props: { ...e.props, suffix: `${e.props.suffix} ${text}` } }) : next(e)
  })

  // The line that closes a turn (terminal only; Desktop draws its own footer): what the turn cost.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!opts.turnCost) return next(e)
    const done = (await read($, ledger)).turns.findLast(t => t.durationMs === e.props.durationMs)
    if (!done || done.reqs === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        {await next(e)}
        <Text dimColor> · {turnTail(done)}</Text>
      </Box>
    )
  })

  // With the band hidden or compact, the hint line under the prompt carries the essentials (terminal draws `tail`).
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isDraft || opts.display !== 'band') return next(e)
    const [v, l, hidden] = await Promise.all([read($, view), read($, ledger), read($, isHidden)])
    if (!v || (!hidden && opts.density === 'full')) return next(e)
    return next({ ...e, props: { ...e.props, tail: compactLine(v, l, 'terminal') } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const [v, l] = await Promise.all([read($, view), read($, ledger)])
    if (!v) return <Text dimColor>No usage figures yet: send a prompt.</Text>
    const surface = e.surface
    const now = v.now
    const w = Math.max(20, Math.min(60, e.props.bodyColumns - 24))
    const t = totals(l)
    const hit = hitRatio(l)
    const cache = cacheState(l.last?.at, v.ttl, now)
    const advice = adviceFor(v, l)
    const hours = v.startedAt ? (now - v.startedAt) / 3_600_000 : 0
    const H = (title: string) => (
      <Text bold color="cyan">
        {title}
      </Text>
    )
    const share = (x: number) => (t.total > 0 ? `${Math.round((x / t.total) * 100)}%`.padStart(4) : '')
    const topTools = Object.entries(l.tools).sort((a, b) => b[1] - a[1]).slice(0, 8)
    const durations = l.turns.map(x => x.durationMs)
    const avgTurn = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
    const turnUsd = l.turns.map(x => x.usd)
    const paceRows = v.rates
      .map(r => ({ r, o: outlook(r.pct, r.resetsAt, WINDOW_MS[r.kind], now) }))
      .filter(({ o }) => shows(surface, 'planUsage') || o.projected !== undefined)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {H('Context')}
          {shows(surface, 'context') &&
            Row(els, [{ t: bar(v.ctxPct ?? 0, w), c: pctColor(v.ctxPct ?? 0) }, { t: ` ${v.ctxPct ?? '--'}%  ${fmtTok(v.ctxTokens ?? 0)} / ${fmtTok(v.ctxWindow)}` }])}
          {l.ctxHistory.length > 1 && Row(els, [{ t: 'per request ', dim: true }, { t: spark(l.ctxHistory, w, v.ctxWindow), c: 'cyan' }])}
          {Row(els, [{ t: `kept by /compact ≈ ${fmtTok(l.baseCtx ?? 0)} (system prompt + tools)`, dim: true }])}
        </Box>
        <Box flexDirection="column">
          {H('Spend')}
          {Row(els, [
            { t: 'engine total ', dim: true },
            { t: v.costUsd !== undefined ? fmtUsd(v.costUsd) : '?' },
            { t: '   list-price estimate ', dim: true },
            { t: fmtUsd(allUsd(l)) },
            ...(hours > 0.05 ? [{ t: `   burn ${fmtUsd(allUsd(l) / hours)}/h`, dim: true }] : []),
          ])}
          {Row(els, [{ t: `in      ${fmtTok(l.in).padStart(7)} ${fmtUsd(t.in).padStart(9)} ${share(t.in)}`, c: 'yellow' }])}
          {Row(els, [{ t: `cached  ${fmtTok(l.rd).padStart(7)} ${fmtUsd(t.rd).padStart(9)} ${share(t.rd)}`, c: 'green' }])}
          {Row(els, [{ t: `write   ${fmtTok(l.wr).padStart(7)} ${fmtUsd(t.wr).padStart(9)} ${share(t.wr)}`, c: 'red' }])}
          {Row(els, [{ t: `out     ${fmtTok(l.out).padStart(7)} ${fmtUsd(t.out).padStart(9)} ${share(t.out)}`, c: 'magenta' }])}
          {Row(els, costBar(t, w))}
          {l.usdHistory.length > 1 && Row(els, [{ t: '$/request ', dim: true }, { t: spark(l.usdHistory, w), c: 'magenta' }])}
          {Row(els, [
            {
              t:
                `${l.reqs} requests` +
                (hit !== undefined ? ` · cache hit ${Math.round(hit * 100)}%` : '') +
                (l.agentReqs ? ` · subagents ${fmtUsd(l.agentUsd)} over ${l.agentReqs} requests` : '') +
                (v.agentsRunning ? ` (${v.agentsRunning} running)` : ''),
              dim: true,
            },
          ])}
          {v.spend && Row(els, [{ t: `today ${fmtUsd(v.spend.today)} · last 7 days ${fmtUsd(v.spend.week)} (all sessions, list price)`, dim: true }])}
          {opts.budgetUsd > 0 &&
            Row(els, [
              { t: 'budget ', dim: true },
              { t: bar(((v.costUsd ?? 0) / opts.budgetUsd) * 100, w), c: pctColor(((v.costUsd ?? 0) / opts.budgetUsd) * 100) },
              { t: ` ${fmtUsd(opts.budgetUsd)}` },
            ])}
        </Box>
        {paceRows.length > 0 && (
          <Box flexDirection="column">
            {H(shows(surface, 'planUsage') ? 'Rate limits' : 'Rate-limit pace')}
            {paceRows.map(({ r, o }) =>
              Row(els, [
                { t: `${r.kind.padEnd(10)} `, dim: true },
                ...(shows(surface, 'planUsage') ? [{ t: `${bar(r.pct, Math.min(w, 24))} ${r.pct}%`, c: pctColor(r.pct) }] : []),
                ...(o.resetsInMs !== undefined ? [{ t: `  resets ${fmtDur(o.resetsInMs)}`, dim: true }] : []),
                ...(o.projected !== undefined ? [{ t: '  pace → ', dim: true }, { t: `${o.projected}%`, c: projColor(o.projected) }] : []),
                ...(o.hitsLimitInMs !== undefined && r.pct < 100 ? [{ t: `  100% in ${fmtDur(o.hitsLimitInMs)}`, c: 'error' }] : []),
              ]),
            )}
          </Box>
        )}
        <Box flexDirection="column">
          {H('Prompt cache & compaction')}
          {Row(els, [
            { t: `TTL ${v.ttl} · `, dim: true },
            l.last ? (cache.warm ? { t: `warm, cold in ${fmtDur(cache.leftMs)}`, c: 'success' } : { t: 'cold: next request re-writes the context', c: 'warning' }) : { t: 'no request yet', dim: true },
            ...(l.misses > 0 ? [{ t: ` · ${l.misses} unexpected miss${l.misses > 1 ? 'es' : ''} ~${fmtUsd(l.missUsd)}`, c: 'warning' }] : []),
          ])}
          {Row(els, [{ t: adviceText(advice), c: shouldCompact(advice) ? 'success' : undefined }])}
          {l.compactions.slice(-3).map(c =>
            Row(els, [
              { t: `compacted ${clockOf(c.at)} (${c.trigger}) `, dim: true },
              { t: c.before !== undefined && c.after !== undefined ? `${fmtTok(c.before)} → ${fmtTok(c.after)} ` : '' },
              { t: fmtUsd(c.usd), dim: true },
            ]),
          )}
        </Box>
        {(topTools.length > 0 || l.turns.length > 0) && (
          <Box flexDirection="column">
            {H('Activity')}
            {l.turns.length > 0 &&
              Row(els, [
                { t: `${l.turns.length} turns · avg ${fmtDur(avgTurn)} · max ${fmtDur(Math.max(...durations))} `, dim: true },
                { t: spark(durations, Math.min(w, 30)), c: 'cyan' },
              ])}
            {turnUsd.some(x => x > 0) &&
              Row(els, [{ t: `$/turn avg ${fmtUsd(turnUsd.reduce((a, b) => a + b, 0) / turnUsd.length)} `, dim: true }, { t: spark(turnUsd, Math.min(w, 30)), c: 'magenta' }])}
            {topTools.length > 0 && Row(els, [{ t: topTools.map(([n, c]) => `${n.replace(/^mcp__/, '')} ${c}`).join(' · '), dim: true }])}
          </Box>
        )}
        <Box flexDirection="row" gap={1}>
          <Button key="compact" label="Compact now" hotkey="c" variant={shouldCompact(advice) ? 'primary' : 'secondary'} onPress={() => compactNow($)} />
          <Button
            key="copy"
            label="Copy report"
            hotkey="y"
            onPress={async press => {
              const r = await $.ui.copy({ text: report(v, l), surface: press.surface })
              $.ui.toast(r.isCopied ? 'HUD report copied.' : 'Copy not available here.')
            }}
          />
          <Button key="close" label="Close" hotkey="x" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
