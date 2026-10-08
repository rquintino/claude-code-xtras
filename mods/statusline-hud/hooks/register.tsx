// statusline-hud: a Claude Code mod port of statusline/statusline-command.sh, plus what a
// script status line can't do: live per-request accounting, subagent spend, rate-limit
// burn ETAs, cache-cold countdown, a one-key /compact, toasts, a dashboard pane and a
// tool the model can call to check its own budget.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { HudLedger, HudRate, HudView } from '../types'
import {
  advise,
  bar,
  cacheState,
  costSegments,
  fmtDur,
  fmtTok,
  fmtUsd,
  modelLabel,
  outlook,
  parseGit,
  spark,
  spendOf,
  WINDOW_MS,
  type Advice,
  type Spend,
  type Ttl,
} from './calc'

const PANE = 'hud'
const TICK_MS = 15_000
const HISTORY = 60
const KEEP_SESSIONS = 40

const EMPTY: HudLedger = {
  reqs: 0, in: 0, rd: 0, wr: 0, out: 0, usdIn: 0, usdRd: 0, usdWr: 0, usdOut: 0,
  agentReqs: 0, agentUsd: 0, ctxHistory: [], usdHistory: [], tools: {}, turnMs: [],
}

const view = atom({ plugin: 'statusline-hud', key: 'view' } as const, null)
const ledger = atom({ plugin: 'statusline-hud', key: 'ledger' } as const, EMPTY)
const isHidden = atom({ plugin: 'statusline-hud', key: 'isHidden' } as const, false)
const fired = atom({ plugin: 'statusline-hud', key: 'fired' } as const, [])

type Opts = { display: string; density: string; cacheTtl: string; budgetUsd: number; alerts: boolean }

function readOptions(o: PluginOptions): Opts {
  return {
    display: typeof o.display === 'string' ? o.display : 'band',
    density: typeof o.density === 'string' ? o.density : 'full',
    cacheTtl: typeof o.cacheTtl === 'string' ? o.cacheTtl : 'auto',
    budgetUsd: typeof o.budgetUsd === 'number' ? o.budgetUsd : 0,
    alerts: typeof o.alerts === 'boolean' ? o.alerts : true,
  }
}

const push = (list: readonly number[], v: number) => [...list, v].slice(-HISTORY)

/** Spend of the ledger's totals, per category. */
function totals(l: HudLedger): Spend {
  return { in: l.usdIn, rd: l.usdRd, wr: l.usdWr, out: l.usdOut, total: l.usdIn + l.usdRd + l.usdWr + l.usdOut }
}

/** Share of input tokens the cache served. */
function hitRatio(l: HudLedger): number | undefined {
  const all = l.in + l.rd + l.wr
  return all > 0 ? l.rd / all : undefined
}

function pctColor(p: number): string {
  return p >= 80 ? 'error' : p >= 50 ? 'warning' : 'success'
}

function projColor(p: number): string {
  return p >= 115 ? 'error' : p >= 85 ? 'success' : 'cyan'
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

/** Subagents, workflows and forks: five minutes unless pinned. */
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

/** One-shot plain-text report: /hud status, the Copy button and the model's tool share it. */
function report(v: HudView, l: HudLedger, now: number): string {
  const lines: string[] = []
  const cache = cacheState(l.last?.at, v.ttl, now)
  lines.push(
    `model ${modelLabel(v.model)}${v.effort ? ` [${v.effort}]` : ''}; context ${v.ctxPct ?? '?'}% ` +
      `(${fmtTok(v.ctxTokens ?? 0)} of ${fmtTok(v.ctxWindow)})`,
  )
  for (const r of v.rates) {
    const o = outlook(r.pct, r.resetsAt, WINDOW_MS[r.kind], now)
    lines.push(
      `${r.kind}: ${r.pct}% used` +
        (o.resetsInMs !== undefined ? `, resets in ${fmtDur(o.resetsInMs)}` : '') +
        (o.projected !== undefined ? `, on pace for ${o.projected}% at reset` : '') +
        (o.hitsLimitInMs !== undefined ? `, hits 100% in ~${fmtDur(o.hitsLimitInMs)}` : ''),
    )
  }
  const t = totals(l)
  const hit = hitRatio(l)
  lines.push(
    `session cost ${v.costUsd !== undefined ? fmtUsd(v.costUsd) : '?'} (engine); ${fmtUsd(t.total)} at list price over ${l.reqs} requests` +
      (hit !== undefined ? `, cache hit ${Math.round(hit * 100)}%` : '') +
      (l.agentReqs > 0 ? `; subagents ${fmtUsd(l.agentUsd)} over ${l.agentReqs} requests` : ''),
  )
  lines.push(`prompt cache (${v.ttl}): ${cache.warm ? `warm, cold in ${fmtDur(cache.leftMs)}` : 'cold'}`)
  lines.push(`compaction: ${adviceText(adviceFor(v, l, now))}`)
  return lines.join('\n')
}

function adviceFor(v: HudView, l: HudLedger, now: number): Advice {
  return advise({
    ctx: v.ctxTokens,
    base: l.baseCtx,
    window: v.ctxWindow,
    model: v.model,
    ttl: v.ttl,
    warm: cacheState(l.last?.at, v.ttl, now).warm,
  })
}

function adviceText(a: Advice): string {
  switch (a.kind) {
    case 'fresh':
      return 'fresh context'
    case 'small':
      return 'context small, no benefit'
    case 'cold':
      return a.netNowUsd > 0
        ? `cache cold: compacting now is ~${fmtUsd(a.netNowUsd)} cheaper than resuming, then saves ${fmtUsd(a.savesPerReq)}/request`
        : `cache cold: compacting costs ~${fmtUsd(-a.netNowUsd)} extra, then saves ${fmtUsd(a.savesPerReq)}/request`
    case 'warm':
      return `costs ${fmtUsd(a.costUsd)}, saves ${fmtUsd(a.savesPerReq)}/request, pays back in ${a.paybackReqs} requests`
  }
}

/** Compacting is clearly worth it: cold and cheaper now, or warm and paid back within 10 requests. */
function shouldCompact(a: Advice): boolean {
  return (a.kind === 'cold' && a.netNowUsd > 0) || (a.kind === 'warm' && a.paybackReqs <= 10)
}

/** Re-reads the engine's figures into `view`; git too when asked (it spawns processes). */
async function refresh($: EngineInterface, opts: Opts, withGit: boolean): Promise<void> {
  const [usage, model, now, cwd] = await Promise.all([$.session.usage(), $.session.model(), $.clock.now(), $.session.cwd()])
  const rates: HudRate[] = usage.rateLimits.map(r => ({
    kind: r.kind,
    pct: r.percentUsed,
    resetsAt: r.resetsAt ? Date.parse(r.resetsAt) : undefined,
  }))
  const prior = await read($, view)
  const auth = prior?.auth ?? (await $.session.authorize().then(a => (a ? a.kind : 'none')).catch(() => 'none' as const))
  const ttl = await resolveTtl($, opts, auth, rates)
  const git = withGit ? await readGit($) : undefined
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
  }))
  if (opts.display !== 'band') await pushStatus($)
  if (opts.alerts) await alert($, opts)
}

async function pushStatus($: EngineInterface): Promise<void> {
  const v = await read($, view)
  if (!v) return
  const parts = [`ctx ${v.ctxPct ?? '--'}%`, modelLabel(v.model)]
  for (const r of v.rates) parts.push(`${r.kind === 'five_hour' ? '5h' : r.kind === 'seven_day' ? '7d' : r.kind} ${r.pct}%`)
  if (v.costUsd !== undefined) parts.push(fmtUsd(v.costUsd))
  $.ui.status(parts.join(' · '))
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
  if (cache.warm && cache.leftMs <= 60_000 && (v.ctxTokens ?? 0) >= 60_000) {
    const rewrite = spendOf({ in: 0, rd: 0, wr: v.ctxTokens ?? 0, out: 0 }, v.model, v.ttl).total
    due.push([`cold:${l.last?.at}`, `Prompt cache goes cold in ${fmtDur(cache.leftMs)}: the next prompt after that re-writes ${fmtTok(v.ctxTokens ?? 0)} tokens (~${fmtUsd(rewrite)}).`])
  }
  const fresh = due.filter(([key]) => !seen.includes(key))
  if (fresh.length === 0) return
  await update($, fired, list => [...list, ...fresh.map(([key]) => key)].slice(-200))
  for (const [, text] of fresh) $.ui.toast(text, { timeoutMs: 8000 })
}

async function storeKey($: EngineInterface): Promise<string> {
  return `ledger:${await $.session.id()}`
}

/** Keeps the ledger across reloads and resumes; only the newest sessions, so the store stays small. */
async function saveLedger($: EngineInterface): Promise<void> {
  const key = await storeKey($)
  await $.store.set(key, await read($, ledger))
  const index = ((await $.store.get('ledgers')) as string[] | undefined) ?? []
  const kept = [...index.filter(k => k !== key), key]
  for (const old of kept.slice(0, -KEEP_SESSIONS)) await $.store.delete(old)
  await $.store.set('ledgers', kept.slice(-KEEP_SESSIONS))
}

async function compactNow($: EngineInterface): Promise<void> {
  try {
    const r = await $.session.compact()
    if (r && 'skip' in r && r.skip) $.ui.toast('Compaction skipped by a hook.')
  } catch {
    $.ui.toast('Compaction runs between turns: try again when the turn ends.')
  }
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
        "Live budget for this Claude Code session: context fill, rate-limit windows with pace projections, " +
        'cost, prompt-cache warmth and whether /compact pays off now. Check before starting a large task.',
    })
    const saved = (await $.store.get(await storeKey($))) as HudLedger | undefined
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
    }
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
        return result
      }
      const v = await read($, view)
      const s = spendOf(t, usage.model, v?.ttl ?? '5m')
      const at = await $.clock.now()
      const ctx = t.in + t.rd + t.wr
      const effort = e.effort === undefined ? undefined : String(e.effort)
      await update($, ledger, l => ({
        ...l,
        reqs: l.reqs + 1,
        in: l.in + t.in, rd: l.rd + t.rd, wr: l.wr + t.wr, out: l.out + t.out,
        usdIn: l.usdIn + s.in, usdRd: l.usdRd + s.rd, usdWr: l.usdWr + s.wr, usdOut: l.usdOut + s.out,
        baseCtx: l.baseCtx ?? ctx,
        last: { model: usage.model, ...t, usd: s.total, at, effort },
        ctxHistory: push(l.ctxHistory, ctx),
        usdHistory: push(l.usdHistory, s.total),
      }))
      await update($, view, prev => (prev ? { ...prev, effort } : prev))
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
      await update($, ledger, l => ({ ...l, turnMs: push(l.turnMs, e.durationMs) }))
      await refresh($, opts, true)
      await saveLedger($)
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__statusline-hud__usage' }, async $ => {
    await refresh($, opts, false)
    const [v, l, now] = await Promise.all([read($, view), read($, ledger), $.clock.now()])
    return { result: v ? report(v, l, now) : 'No usage figures yet.' }
  }).catch(() => ({ result: 'Usage figures are unavailable right now.' }))

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'pane') {
      const opened = await $.ui.open({ id: PANE, title: 'Session HUD' })
      return { text: opened.isPlaced ? 'HUD dashboard opened.' : 'HUD dashboard queued: widen the terminal to place it.' }
    }
    if (arg === 'status') {
      await refresh($, opts, true)
      const [v, l, now] = await Promise.all([read($, view), read($, ledger), $.clock.now()])
      return { text: v ? report(v, l, now) : 'No usage figures yet.' }
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
  type Seg = { t: string; c?: string; dim?: boolean; bold?: boolean }

  const SEP: Seg = { t: ' · ', dim: true }
  const join = (groups: Seg[][]): Seg[] => groups.filter(g => g.length > 0).flatMap((g, i) => (i === 0 ? g : [SEP, ...g]))

  function Row(els: Els, segs: Seg[]) {
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

  function costBar(s: Spend, width: number): Seg[] {
    const n = costSegments(s, width)
    return [
      { t: '█'.repeat(n.in), c: 'yellow' },
      { t: '█'.repeat(n.rd), c: 'green' },
      { t: '█'.repeat(n.wr), c: 'red' },
      { t: '█'.repeat(n.out), c: 'magenta' },
    ].filter(x => x.t.length > 0)
  }

  function tokenSegs(label: Seg, t: { in: number; rd: number; wr: number; out: number }, s: Spend, width: number): Seg[] {
    return [
      label,
      { t: ` in:${fmtTok(t.in).padStart(6)}`, c: 'yellow' },
      { t: ` cached:${fmtTok(t.rd).padStart(6)}`, c: 'green' },
      { t: ` wr:${fmtTok(t.wr).padStart(6)}`, c: 'red' },
      { t: ` out:${fmtTok(t.out).padStart(6)}`, c: 'magenta' },
      { t: ' ≈', dim: true },
      { t: fmtUsd(s.total).padStart(7) + ' ' },
      ...costBar(s, width),
    ]
  }

  function rateSegs(v: HudView): Seg[][] {
    return v.rates.map(r => {
      const label = r.kind === 'five_hour' ? '5h' : r.kind === 'seven_day' ? '7d' : r.kind
      const o = outlook(r.pct, r.resetsAt, WINDOW_MS[r.kind], v.now)
      const segs: Seg[] = [
        { t: `${label}:`, dim: true },
        { t: `${bar(r.pct, 8)} ${Math.round(r.pct)}%`, c: pctColor(r.pct) },
      ]
      if (o.resetsInMs !== undefined) segs.push({ t: `·${fmtDur(o.resetsInMs)}`, dim: true })
      if (o.projected !== undefined) segs.push({ t: ' proj:', dim: true }, { t: `${o.projected}%`, c: projColor(o.projected) })
      if (o.hitsLimitInMs !== undefined && r.pct < 100) segs.push({ t: ` ⚠ 100% in ${fmtDur(o.hitsLimitInMs)}`, c: 'error' })
      return segs
    })
  }

  function adviceSegs(a: Advice, cache: { warm: boolean; leftMs: number }): Seg[] {
    const head: Seg = { t: 'cmp   ', c: 'cyan' }
    if (a.kind === 'fresh') return [head, { t: 'fresh context', dim: true }]
    if (a.kind === 'small') return [head, { t: 'context small, no benefit', dim: true }]
    const shrink: Seg = { t: ` ${fmtTok(a.ctx)}→~${fmtTok(a.after)}`, dim: true }
    const tail: Seg[] = []
    if (a.cliff) tail.push({ t: ' >200k: recall degrades', c: 'error' })
    if (a.nearAuto) tail.push({ t: ' auto-compact near', c: 'warning' })
    if (a.kind === 'cold') {
      const good = a.netNowUsd > 0
      return [
        head,
        {
          t: good
            ? `cold, compact now: ~${fmtUsd(a.netNowUsd)} cheaper than resuming`
            : `cold, compact costs ~${fmtUsd(-a.netNowUsd)} extra`,
          c: good ? 'success' : 'warning',
        },
        { t: ` then saves ${fmtUsd(a.savesPerReq)}/req`, dim: true },
        shrink,
        ...tail,
      ]
    }
    const nc = a.paybackReqs <= 10 ? 'success' : a.paybackReqs <= 30 ? 'warning' : undefined
    return [
      head,
      { t: 'warm', dim: true },
      { t: ` (cold in ${fmtDur(cache.leftMs)})`, dim: true },
      { t: ' cost ', dim: true },
      { t: fmtUsd(a.costUsd) },
      { t: ' saves ', dim: true },
      { t: `${fmtUsd(a.savesPerReq)}/req ` },
      { t: `pays back in ${a.paybackReqs} req`, c: nc, dim: nc === undefined },
      shrink,
      ...tail,
    ]
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!showBand || e.props.hasSurvey) return next(e)
    const [v, l, hidden] = await Promise.all([read($, view), read($, ledger), read($, isHidden)])
    if (!v || hidden) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Button } = els
    const narrow = e.props.bodyColumns < 110
    const barW = narrow ? 10 : 20
    const now = v.now
    const cache = cacheState(l.last?.at, v.ttl, now)

    const ctxSegs: Seg[] =
      v.ctxPct !== undefined
        ? [
            ...((v.ctxTokens ?? 0) > 200_000 ? [{ t: '⚠ ', c: 'error' }] : []),
            { t: `ctx: ${v.ctxPct}% ${bar(v.ctxPct, 8)} [${fmtTok(v.ctxTokens ?? 0)}/${fmtTok(v.ctxWindow)}]`, c: (v.ctxTokens ?? 0) > 200_000 ? 'error' : pctColor(v.ctxPct) },
          ]
        : [{ t: 'ctx: --', dim: true }]
    const modelSegs: Seg[] = [{ t: modelLabel(v.model), c: 'cyan', bold: true }]
    if (v.effort) modelSegs.push({ t: ` [${v.effort}]`, c: v.effort === 'max' || v.effort === 'xhigh' ? 'error' : v.effort === 'high' ? 'warning' : undefined, dim: v.effort === 'low' || v.effort === 'medium' })
    const line1 = join([ctxSegs, modelSegs, ...rateSegs(v)])

    const g = v.git
    const gitSegs: Seg[] = g?.branch
      ? [
          { t: `⎇ ${g.branch}`, bold: true },
          ...(g.ahead ? [{ t: ` ↑${g.ahead}`, c: 'cyan' }] : []),
          ...(g.behind ? [{ t: ` ↓${g.behind}`, c: 'warning' }] : []),
          ...(g.changed ? [{ t: ` ✎${g.changed}`, c: 'warning' }] : []),
        ]
      : []
    const diffSegs: Seg[] = g && (g.added || g.removed) ? [{ t: `+${g.added}`, c: 'success' }, { t: '/', dim: true }, { t: `-${g.removed}`, c: 'error' }] : []
    const costSegs: Seg[] =
      v.costUsd !== undefined
        ? [{ t: `cost:${fmtUsd(v.costUsd)}`, c: opts.budgetUsd > 0 && v.costUsd >= opts.budgetUsd ? 'error' : undefined }]
        : []
    const durSegs: Seg[] = v.startedAt ? [{ t: `⏱ ${fmtDur(now - v.startedAt)}`, dim: true }] : []
    const cacheSegs: Seg[] = l.last
      ? cache.warm
        ? [{ t: `cache ${v.ttl} warm ${fmtDur(cache.leftMs)}`, c: cache.leftMs <= 60_000 ? 'warning' : 'success' }]
        : [{ t: `cache ${v.ttl} cold`, c: 'subtle' }]
      : []
    const line2: Seg[] = [{ t: 'sess: ', c: 'cyan' }, ...join([gitSegs, diffSegs, v.cwdLeaf ? [{ t: v.cwdLeaf, dim: true }] : [], costSegs, durSegs, cacheSegs])]

    const rows = [Row(els, line1), Row(els, line2)]

    if (opts.density === 'full') {
      const t = totals(l)
      if (l.reqs > 0) {
        const hit = hitRatio(l)
        rows.push(
          Row(els, [
            ...tokenSegs({ t: 'Σ    ', c: 'cyan' }, l, t, barW),
            ...(hit !== undefined ? [SEP, { t: `hit ${Math.round(hit * 100)}%`, dim: true }] : []),
            ...(l.agentReqs > 0 ? [SEP, { t: `agents ${fmtUsd(l.agentUsd)} (${l.agentReqs} req)`, dim: true }] : []),
          ]),
        )
      }
      if (l.last) {
        const ls = spendOf(l.last, l.last.model, v.ttl)
        rows.push(
          Row(els, [
            ...tokenSegs({ t: 'last ', dim: true }, l.last, ls, barW),
            ...(l.ctxHistory.length > 1 ? [SEP, { t: 'ctx ', dim: true }, { t: spark(l.ctxHistory, 16, v.ctxWindow), c: 'cyan' }] : []),
          ]),
        )
      }
      const advice = adviceFor(v, l, now)
      const adv = Row(els, adviceSegs(advice, cache))
      rows.push(
        shouldCompact(advice) && !e.props.isWorking ? (
          <Box flexDirection="row" gap={1}>
            {adv}
            <Button key="compact" label="Compact now" hotkey="c" variant="primary" onPress={() => compactNow($)} />
          </Box>
        ) : (
          adv
        ),
      )
      const hh = new Date(now)
      const clock = `${String(hh.getHours()).padStart(2, '0')}:${String(hh.getMinutes()).padStart(2, '0')}`
      rows.push(
        <Box flexDirection="row" gap={1}>
          {Row(els, [{ t: '●', c: 'success' }, { t: ` ${v.os ?? ''}`, dim: true }, SEP, { t: `🕐 ${clock}`, dim: true }, ...(v.version ? [SEP, { t: `v${v.version}`, dim: true }] : [])])}
          <Button key="pane" label="dashboard" hotkey="d" plain onPress={() => void $.ui.open({ id: PANE, title: 'Session HUD' })} />
          <Button key="hide" label="hide" hotkey="h" plain onPress={() => update($, isHidden, () => true)} />
        </Box>,
      )
    }
    return <Box flexDirection="column">{rows}</Box>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const [v, l] = await Promise.all([read($, view), read($, ledger)])
    if (!v) return <Text dimColor>No usage figures yet: send a prompt.</Text>
    const now = v.now
    const w = Math.max(20, Math.min(60, e.props.bodyColumns - 24))
    const t = totals(l)
    const hit = hitRatio(l)
    const cache = cacheState(l.last?.at, v.ttl, now)
    const advice = adviceFor(v, l, now)
    const hours = v.startedAt ? (now - v.startedAt) / 3_600_000 : 0
    const H = (title: string) => (
      <Text bold color="cyan">
        {title}
      </Text>
    )
    const share = (x: number) => (t.total > 0 ? `${Math.round((x / t.total) * 100)}%`.padStart(4) : '')
    const topTools = Object.entries(l.tools).sort((a, b) => b[1] - a[1]).slice(0, 8)
    const avgTurn = l.turnMs.length ? l.turnMs.reduce((a, b) => a + b, 0) / l.turnMs.length : 0

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {H('Context')}
          {Row(els, [{ t: bar(v.ctxPct ?? 0, w), c: pctColor(v.ctxPct ?? 0) }, { t: ` ${v.ctxPct ?? '--'}%  ${fmtTok(v.ctxTokens ?? 0)} / ${fmtTok(v.ctxWindow)}` }])}
          {l.ctxHistory.length > 1 && Row(els, [{ t: 'per request ', dim: true }, { t: spark(l.ctxHistory, w, v.ctxWindow), c: 'cyan' }])}
          {Row(els, [{ t: `kept by /compact ≈ ${fmtTok(l.baseCtx ?? 0)} (system prompt + tools)`, dim: true }])}
        </Box>
        <Box flexDirection="column">
          {H('Spend')}
          {Row(els, [{ t: 'engine total ', dim: true }, { t: v.costUsd !== undefined ? fmtUsd(v.costUsd) : '?' }, { t: '   list-price estimate ', dim: true }, { t: fmtUsd(t.total) }, ...(hours > 0.05 ? [{ t: `   burn ${fmtUsd(t.total / hours)}/h`, dim: true }] : [])])}
          {Row(els, [{ t: `in      ${fmtTok(l.in).padStart(7)} ${fmtUsd(t.in).padStart(9)} ${share(t.in)}`, c: 'yellow' }])}
          {Row(els, [{ t: `cached  ${fmtTok(l.rd).padStart(7)} ${fmtUsd(t.rd).padStart(9)} ${share(t.rd)}`, c: 'green' }])}
          {Row(els, [{ t: `write   ${fmtTok(l.wr).padStart(7)} ${fmtUsd(t.wr).padStart(9)} ${share(t.wr)}`, c: 'red' }])}
          {Row(els, [{ t: `out     ${fmtTok(l.out).padStart(7)} ${fmtUsd(t.out).padStart(9)} ${share(t.out)}`, c: 'magenta' }])}
          {Row(els, costBar(t, w))}
          {l.usdHistory.length > 1 && Row(els, [{ t: '$/request ', dim: true }, { t: spark(l.usdHistory, w), c: 'magenta' }])}
          {Row(els, [{ t: `${l.reqs} requests` + (hit !== undefined ? ` · cache hit ${Math.round(hit * 100)}%` : '') + (l.agentReqs ? ` · subagents ${fmtUsd(l.agentUsd)} over ${l.agentReqs} requests` : ''), dim: true }])}
          {opts.budgetUsd > 0 && Row(els, [{ t: 'budget ', dim: true }, { t: bar(((v.costUsd ?? 0) / opts.budgetUsd) * 100, w), c: pctColor(((v.costUsd ?? 0) / opts.budgetUsd) * 100) }, { t: ` ${fmtUsd(opts.budgetUsd)}` }])}
        </Box>
        {v.rates.length > 0 && (
          <Box flexDirection="column">
            {H('Rate limits')}
            {v.rates.map(r => {
              const o = outlook(r.pct, r.resetsAt, WINDOW_MS[r.kind], now)
              return Row(els, [
                { t: `${r.kind.padEnd(10)} `, dim: true },
                { t: `${bar(r.pct, Math.min(w, 24))} ${r.pct}%`, c: pctColor(r.pct) },
                ...(o.resetsInMs !== undefined ? [{ t: `  resets ${fmtDur(o.resetsInMs)}`, dim: true }] : []),
                ...(o.projected !== undefined ? [{ t: '  pace → ', dim: true }, { t: `${o.projected}%`, c: projColor(o.projected) }] : []),
                ...(o.hitsLimitInMs !== undefined && r.pct < 100 ? [{ t: `  100% in ${fmtDur(o.hitsLimitInMs)}`, c: 'error' }] : []),
              ])
            })}
          </Box>
        )}
        <Box flexDirection="column">
          {H('Prompt cache & compaction')}
          {Row(els, [{ t: `TTL ${v.ttl} · ` , dim: true }, l.last ? (cache.warm ? { t: `warm, cold in ${fmtDur(cache.leftMs)}`, c: 'success' } : { t: 'cold: next request re-writes the context', c: 'warning' }) : { t: 'no request yet', dim: true }])}
          {Row(els, [{ t: adviceText(advice), c: shouldCompact(advice) ? 'success' : undefined }])}
        </Box>
        {(topTools.length > 0 || l.turnMs.length > 0) && (
          <Box flexDirection="column">
            {H('Activity')}
            {l.turnMs.length > 0 && Row(els, [{ t: `${l.turnMs.length} turns · avg ${fmtDur(avgTurn)} · max ${fmtDur(Math.max(...l.turnMs))} `, dim: true }, { t: spark(l.turnMs, Math.min(w, 30)), c: 'cyan' }])}
            {topTools.length > 0 && Row(els, [{ t: topTools.map(([n, c]) => `${n.replace(/^mcp__/, '')} ${c}`).join(' · '), dim: true }])}
          </Box>
        )}
        <Box flexDirection="row" gap={1}>
          <Button key="compact" label="Compact now" hotkey="c" variant={shouldCompact(advice) ? 'primary' : 'secondary'} onPress={() => compactNow($)} />
          <Button key="copy" label="Copy report" hotkey="y" onPress={async press => {
            const r = await $.ui.copy({ text: report(v, l, now), surface: press.surface })
            $.ui.toast(r.isCopied ? 'HUD report copied.' : 'Copy not available here.')
          }} />
          <Button key="close" label="Close" hotkey="x" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
