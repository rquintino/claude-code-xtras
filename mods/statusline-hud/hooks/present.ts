// What the HUD says, as plain data: rows of colored segments per surface, the report, the
// advisor's verdict. No `$` and no JSX here, so the per-surface choices are unit-tested.

import type { HudLedger, HudView } from '../types'
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
  spark,
  spendOf,
  WINDOW_MS,
  type Advice,
  type Spend,
} from './calc'

export type Seg = { t: string; c?: string; dim?: boolean; bold?: boolean }
export type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

/** Figures a surface already draws on its own; the HUD leaves them out there. */
export type Native = 'model' | 'context' | 'planUsage' | 'branch' | 'gitDiff' | 'clock'

// Desktop's Code tab: model and effort pickers, the usage ring (context window and plan usage),
// the branch, the `+12 -1` diff stats indicator and the PR/CI bar; the OS draws the clock.
// Source: code.claude.com/docs/en/desktop (#check-usage, #review-changes-with-diff-view).
// The terminal shows none of them unless a statusLine script prints them.
export const NATIVE: Record<Surface, readonly Native[]> = {
  terminal: [],
  desktop: ['model', 'context', 'planUsage', 'branch', 'gitDiff', 'clock'],
  vscode: [],
  mobile: [],
}

export const shows = (surface: Surface, what: Native): boolean => !NATIVE[surface].includes(what)

export const SEP: Seg = { t: ' · ', dim: true }

/** Joins non-empty groups with a dim separator. */
export const join = (groups: readonly Seg[][]): Seg[] =>
  groups.filter(g => g.length > 0).flatMap((g, i) => (i === 0 ? g : [SEP, ...g]))

export function pctColor(p: number): string {
  return p >= 80 ? 'error' : p >= 50 ? 'warning' : 'success'
}

export function projColor(p: number): string {
  return p >= 115 ? 'error' : p >= 85 ? 'success' : 'cyan'
}

/** Main-loop spend per category. */
export function totals(l: HudLedger): Spend {
  return { in: l.usdIn, rd: l.usdRd, wr: l.usdWr, out: l.usdOut, total: l.usdIn + l.usdRd + l.usdWr + l.usdOut }
}

/** Everything the ledger priced: main loop, subagents and compactions. */
export function allUsd(l: HudLedger): number {
  return totals(l).total + l.agentUsd + l.compactions.reduce((a, c) => a + c.usd, 0)
}

/** Share of main-loop input tokens the cache served. */
export function hitRatio(l: HudLedger): number | undefined {
  const all = l.in + l.rd + l.wr
  return all > 0 ? l.rd / all : undefined
}

export function adviceFor(v: HudView, l: HudLedger): Advice {
  return advise({
    ctx: v.ctxTokens,
    base: l.baseCtx,
    window: v.ctxWindow,
    model: v.model,
    ttl: v.ttl,
    warm: cacheState(l.last?.at, v.ttl, v.now).warm,
  })
}

/** Compacting clearly pays: cold and cheaper now, or warm and paid back within 10 requests. */
export function shouldCompact(a: Advice): boolean {
  return (a.kind === 'cold' && a.netNowUsd > 0) || (a.kind === 'warm' && a.paybackReqs <= 10)
}

export function adviceText(a: Advice): string {
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

const windowLabel = (kind: string) => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind)

/** Rate-limit windows: the full meter where the surface has none, the pace alone where it does. */
export function rateSegs(v: HudView, surface: Surface): Seg[][] {
  const meters = shows(surface, 'planUsage')
  return v.rates.flatMap(r => {
    const o = outlook(r.pct, r.resetsAt, WINDOW_MS[r.kind], v.now)
    const label = windowLabel(r.kind)
    const warn: Seg[] = o.hitsLimitInMs !== undefined && r.pct < 100 ? [{ t: ` ⚠ 100% in ${fmtDur(o.hitsLimitInMs)}`, c: 'error' }] : []
    if (!meters) {
      // the usage ring has the % used; the pace is the HUD's own
      if (o.projected === undefined) return []
      return [[{ t: `${label} pace `, dim: true }, { t: `→${o.projected}%`, c: projColor(o.projected) }, ...warn]]
    }
    const segs: Seg[] = [{ t: `${label}:`, dim: true }, { t: `${bar(r.pct, 8)} ${Math.round(r.pct)}%`, c: pctColor(r.pct) }]
    if (o.resetsInMs !== undefined) segs.push({ t: `·${fmtDur(o.resetsInMs)}`, dim: true })
    if (o.projected !== undefined) segs.push({ t: ' proj:', dim: true }, { t: `${o.projected}%`, c: projColor(o.projected) })
    return [[...segs, ...warn]]
  })
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

export { costBar }

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

function adviceSegs(a: Advice, leftMs: number): Seg[] {
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
        t: good ? `cold, compact now: ~${fmtUsd(a.netNowUsd)} cheaper than resuming` : `cold, compact costs ~${fmtUsd(-a.netNowUsd)} extra`,
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
    { t: `warm (cold in ${fmtDur(leftMs)})`, dim: true },
    { t: ' cost ', dim: true },
    { t: fmtUsd(a.costUsd) },
    { t: ' saves ', dim: true },
    { t: `${fmtUsd(a.savesPerReq)}/req ` },
    { t: `pays back in ${a.paybackReqs} req`, c: nc, dim: nc === undefined },
    shrink,
    ...tail,
  ]
}

export type BandOptions = { surface: Surface; density: string; budgetUsd: number; narrow: boolean; clock?: string }

/**
 * The band's rows, top to bottom. On the desktop it leaves out what the Code tab draws itself
 * (model, usage ring, branch, diff stats, clock) and keeps what only the HUD knows.
 */
export function bandRows(v: HudView, l: HudLedger, o: BandOptions): Seg[][] {
  const { surface } = o
  const barW = o.narrow ? 10 : 20
  const cache = cacheState(l.last?.at, v.ttl, v.now)
  const big = (v.ctxTokens ?? 0) > 200_000

  const ctx: Seg[] = !shows(surface, 'context')
    ? []
    : v.ctxPct !== undefined
      ? [
          ...(big ? [{ t: '⚠ ', c: 'error' }] : []),
          { t: `ctx: ${v.ctxPct}% ${bar(v.ctxPct, 8)} [${fmtTok(v.ctxTokens ?? 0)}/${fmtTok(v.ctxWindow)}]`, c: big ? 'error' : pctColor(v.ctxPct) },
        ]
      : [{ t: 'ctx: --', dim: true }]
  const model: Seg[] = shows(surface, 'model') ? [{ t: modelLabel(v.model), c: 'cyan', bold: true }] : []
  if (model.length > 0 && v.effort) {
    const e = v.effort
    model.push({ t: ` [${e}]`, c: e === 'max' || e === 'xhigh' ? 'error' : e === 'high' ? 'warning' : undefined, dim: e === 'low' || e === 'medium' })
  }

  const g = v.git
  const branch: Seg[] =
    shows(surface, 'branch') && g?.branch
      ? [
          { t: `⎇ ${g.branch}`, bold: true },
          ...(g.ahead ? [{ t: ` ↑${g.ahead}`, c: 'cyan' }] : []),
          ...(g.behind ? [{ t: ` ↓${g.behind}`, c: 'warning' }] : []),
          ...(g.changed ? [{ t: ` ✎${g.changed}`, c: 'warning' }] : []),
        ]
      : []
  const diff: Seg[] =
    shows(surface, 'gitDiff') && g && (g.added || g.removed)
      ? [{ t: `+${g.added}`, c: 'success' }, { t: '/', dim: true }, { t: `-${g.removed}`, c: 'error' }]
      : []
  const folder: Seg[] = shows(surface, 'branch') && v.cwdLeaf ? [{ t: v.cwdLeaf, dim: true }] : []
  const cost: Seg[] =
    v.costUsd !== undefined ? [{ t: `cost:${fmtUsd(v.costUsd)}`, c: o.budgetUsd > 0 && v.costUsd >= o.budgetUsd ? 'error' : undefined }] : []
  const dur: Seg[] = v.startedAt ? [{ t: `⏱ ${fmtDur(v.now - v.startedAt)}`, dim: true }] : []
  const cacheSeg: Seg[] = l.last
    ? cache.warm
      ? [{ t: `cache ${v.ttl} warm ${fmtDur(cache.leftMs)}`, c: cache.leftMs <= 60_000 ? 'warning' : 'success' }]
      : [{ t: `cache ${v.ttl} cold`, c: 'subtle' }]
    : []

  const rows: Seg[][] = []
  const line1 = join([ctx, model, ...rateSegs(v, surface)])
  const line2 = join([branch, diff, folder, cost, dur, cacheSeg])
  if (shows(surface, 'context')) {
    rows.push(line1)
    rows.push([{ t: 'sess: ', c: 'cyan' }, ...line2])
  } else {
    // nothing of line 1 is left but the pace: fold it into the session row
    rows.push([{ t: 'sess: ', c: 'cyan' }, ...join([line2, line1])])
  }
  if (o.density !== 'full') return rows

  if (l.reqs > 0) {
    const hit = hitRatio(l)
    const spend = v.spend
    rows.push([
      ...tokenSegs({ t: 'Σ    ', c: 'cyan' }, l, totals(l), barW),
      ...(hit !== undefined ? [SEP, { t: `hit ${Math.round(hit * 100)}%`, dim: true }] : []),
      ...(l.misses > 0 ? [SEP, { t: `${l.misses} miss ${fmtUsd(l.missUsd)}`, c: 'warning' }] : []),
      ...(l.agentReqs > 0 || (v.agentsRunning ?? 0) > 0
        ? [SEP, { t: `agents ${v.agentsRunning ? `${v.agentsRunning} running ` : ''}${fmtUsd(l.agentUsd)}`, dim: !v.agentsRunning, c: v.agentsRunning ? 'cyan' : undefined }]
        : []),
      ...(spend ? [SEP, { t: `today ${fmtUsd(spend.today)} · 7d ${fmtUsd(spend.week)}`, dim: true }] : []),
    ])
  }
  if (l.last) {
    rows.push([
      ...tokenSegs({ t: 'last ', dim: true }, l.last, spendOf(l.last, l.last.model, v.ttl), barW),
      ...(l.ctxHistory.length > 1 ? [SEP, { t: 'ctx ', dim: true }, { t: spark(l.ctxHistory, 16, v.ctxWindow), c: 'cyan' }] : []),
    ])
  }
  rows.push(adviceSegs(adviceFor(v, l), cache.leftMs))
  if (shows(surface, 'clock')) {
    rows.push([
      { t: '●', c: 'success' },
      { t: ` ${v.os ?? ''}`, dim: true },
      ...(o.clock ? [SEP, { t: `🕐 ${o.clock}`, dim: true }] : []),
      ...(v.version ? [SEP, { t: `v${v.version}`, dim: true }] : []),
    ])
  }
  return rows
}

/** One line for `$.ui.status` / the prompt hint: the full set on a terminal, the HUD's own figures elsewhere. */
export function compactLine(v: HudView, l: HudLedger, surface: Surface): string {
  const parts: string[] = []
  if (shows(surface, 'context')) parts.push(`ctx ${v.ctxPct ?? '--'}%`)
  if (shows(surface, 'model')) parts.push(modelLabel(v.model))
  for (const r of v.rates) {
    const o = outlook(r.pct, r.resetsAt, WINDOW_MS[r.kind], v.now)
    if (shows(surface, 'planUsage')) parts.push(`${windowLabel(r.kind)} ${Math.round(r.pct)}%`)
    else if (o.hitsLimitInMs !== undefined && r.pct < 100) parts.push(`${windowLabel(r.kind)} 100% in ${fmtDur(o.hitsLimitInMs)}`)
  }
  if (v.costUsd !== undefined) parts.push(fmtUsd(v.costUsd))
  const cache = cacheState(l.last?.at, v.ttl, v.now)
  if (l.last) parts.push(cache.warm ? `cache ${fmtDur(cache.leftMs)}` : 'cache cold')
  return parts.join(' · ')
}

/** Spinner suffix while a turn runs: what the turn has cost so far. */
export function turnSoFar(t: { usd: number; reqs: number } | null | undefined): string | undefined {
  return t && t.reqs > 0 ? `${fmtUsd(t.usd)} · ${t.reqs} req` : undefined
}

/** What the turn-closing line adds: `$0.42 · 7 req · ctx +18.0k`. */
export function turnTail(t: { usd: number; reqs: number; ctxDelta: number }): string {
  const delta = t.ctxDelta === 0 ? '' : ` · ctx ${t.ctxDelta > 0 ? '+' : '−'}${fmtTok(Math.abs(t.ctxDelta))}`
  return `${fmtUsd(t.usd)} · ${t.reqs} req${delta}`
}

/** Markdown report: /hud status, Copy report and the model's tool share it. */
export function report(v: HudView, l: HudLedger): string {
  const lines: string[] = []
  const cache = cacheState(l.last?.at, v.ttl, v.now)
  lines.push(
    `- **model** ${modelLabel(v.model)}${v.effort ? ` [${v.effort}]` : ''}; **context** ${v.ctxPct ?? '?'}% ` +
      `(${fmtTok(v.ctxTokens ?? 0)} of ${fmtTok(v.ctxWindow)})`,
  )
  for (const r of v.rates) {
    const o = outlook(r.pct, r.resetsAt, WINDOW_MS[r.kind], v.now)
    lines.push(
      `- **${r.kind}** ${r.pct}% used` +
        (o.resetsInMs !== undefined ? `, resets in ${fmtDur(o.resetsInMs)}` : '') +
        (o.projected !== undefined ? `, on pace for ${o.projected}% at reset` : '') +
        (o.hitsLimitInMs !== undefined && r.pct < 100 ? `, hits 100% in ~${fmtDur(o.hitsLimitInMs)}` : ''),
    )
  }
  const t = totals(l)
  const hit = hitRatio(l)
  lines.push(
    `- **cost** ${v.costUsd !== undefined ? fmtUsd(v.costUsd) : '?'} (engine); ${fmtUsd(t.total)} at list price over ${l.reqs} requests` +
      (hit !== undefined ? `, cache hit ${Math.round(hit * 100)}%` : '') +
      (l.agentReqs > 0 ? `; subagents ${fmtUsd(l.agentUsd)} over ${l.agentReqs} requests` : '') +
      (v.spend ? `; today ${fmtUsd(v.spend.today)}, last 7 days ${fmtUsd(v.spend.week)}` : ''),
  )
  lines.push(
    `- **prompt cache** (${v.ttl}): ${cache.warm ? `warm, cold in ${fmtDur(cache.leftMs)}` : 'cold'}` +
      (l.misses > 0 ? `; ${l.misses} unexpected miss${l.misses > 1 ? 'es' : ''} cost ~${fmtUsd(l.missUsd)}` : ''),
  )
  lines.push(`- **compaction** ${adviceText(adviceFor(v, l))}`)
  if (l.compactions.length > 0) {
    const c = l.compactions[l.compactions.length - 1]!
    lines.push(
      `- **last compaction** ${c.before !== undefined && c.after !== undefined ? `${fmtTok(c.before)} → ${fmtTok(c.after)}, ` : ''}cost ${fmtUsd(c.usd)} (${l.compactions.length} this session)`,
    )
  }
  return lines.join('\n')
}

/**
 * An unexpected cache miss, and its likely cause: the cache should still have held the previous
 * context (warm, no compaction since), yet most of it was written again instead of read.
 * Each model has its own cache, so a switch (/model, opusplan, a fallback) is the usual cause.
 * Source: code.claude.com/docs/en/prompt-caching (#actions-that-invalidate-the-cache).
 */
export function missCause(args: {
  prev?: { model: string; in: number; rd: number; wr: number; at: number }
  cur: { model: string; rd: number; wr: number }
  ttlMs: number
  now: number
  compactedAt?: number
}): string | undefined {
  const { prev, cur } = args
  if (!prev) return undefined
  if (args.compactedAt !== undefined && args.compactedAt >= prev.at) return undefined
  if (args.now - prev.at >= args.ttlMs) return undefined // expired: an expiry, not a miss
  const prevCtx = prev.in + prev.rd + prev.wr
  if (cur.wr < 20_000 || cur.rd >= prevCtx * 0.5) return undefined
  return prev.model !== cur.model ? 'model switch' : 'prefix changed (tools, MCP servers, effort or system prompt)'
}
