// Pure math for the HUD: pricing, formatting, projections, compaction advice.
// No `$` here, so every function is unit-tested directly (tests/calc.test.ts).

export type Ttl = '5m' | '1h'

/** $/MTok: input, 5m cache write, 1h cache write, cache read, output. */
export type Price = { i: number; w5: number; w1: number; r: number; o: number }

/** One API response's token counts, as the API reports them. */
export type Tokens = { in: number; rd: number; wr: number; out: number }

/** What one response cost per category, in USD. */
export type Spend = { in: number; rd: number; wr: number; out: number; total: number }

// Source: platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-08).
// Order matters: more specific ids first ('opus-5-5' before 'opus-5', 'sonnet-5-5' before 'sonnet-5').
const PRICES: ReadonlyArray<readonly [RegExp, Price]> = [
  [/opus-5-5/, { i: 4, w5: 5, w1: 8, r: 0.2, o: 20 }],
  [/(fable|mythos)-5-1/, { i: 10, w5: 12.5, w1: 20, r: 0.25, o: 50 }],
  [/(fable|mythos)-5/, { i: 10, w5: 12.5, w1: 20, r: 1, o: 50 }],
  [/opus-5|opus-4-[5-9]/, { i: 5, w5: 6.25, w1: 10, r: 0.5, o: 25 }],
  [/opus-4/, { i: 15, w5: 18.75, w1: 30, r: 1.5, o: 75 }],
  [/sonnet-5-5/, { i: 2, w5: 2.5, w1: 4, r: 0.1, o: 10 }],
  [/sonnet-5/, { i: 2, w5: 2.5, w1: 4, r: 0.2, o: 10 }],
  [/sonnet-4/, { i: 3, w5: 3.75, w1: 6, r: 0.3, o: 15 }],
  [/haiku-4/, { i: 1, w5: 1.25, w1: 2, r: 0.1, o: 5 }],
  [/haiku-3-5/, { i: 0.8, w5: 1, w1: 1.6, r: 0.08, o: 4 }],
]
const HAIKU_55_SHORT: Price = { i: 0.1, w5: 0.125, w1: 0.2, r: 0.01, o: 0.5 }
const HAIKU_55_LONG: Price = { i: 0.5, w5: 0.625, w1: 1, r: 0.05, o: 2.5 }
const DEFAULT_PRICE: Price = { i: 5, w5: 6.25, w1: 10, r: 0.5, o: 25 }

/** List price for a model id. Haiku 5.5 is priced by prompt length (over 100k tokens costs more). */
export function priceOf(model: string, promptTokens = 0): Price {
  if (/haiku-5-5/.test(model)) return promptTokens > 100_000 ? HAIKU_55_LONG : HAIKU_55_SHORT
  for (const [re, price] of PRICES) if (re.test(model)) return price
  return DEFAULT_PRICE
}

/** Cost of one response. The API reports cache writes as one total, priced at the TTL in force. */
export function spendOf(t: Tokens, model: string, ttl: Ttl): Spend {
  const p = priceOf(model, t.in + t.rd + t.wr)
  const w = ttl === '1h' ? p.w1 : p.w5
  const s = { in: (t.in * p.i) / 1e6, rd: (t.rd * p.r) / 1e6, wr: (t.wr * w) / 1e6, out: (t.out * p.o) / 1e6 }
  return { ...s, total: s.in + s.rd + s.wr + s.out }
}

// ---------- formatting ----------

/** 1234 -> "1.2k", 1234567 -> "1.2M". */
export function fmtTok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(Math.round(n))
}

/** "$0.004", "$1.23", "$1,234.50". Sub-cent amounts keep three decimals so they don't read as zero. */
export function fmtUsd(x: number): string {
  if (x > 0 && x < 0.001) return "<$0.001"
  if (x > 0 && x < 0.01) return `$${x.toFixed(3)}`
  const [int = '0', frac = '00'] = x.toFixed(2).split('.')
  return `$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`
}

/** Compact duration: "45s", "12m", "3h12m", "2d3h". */
export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

/** Filled/empty meter: bar(50, 8) -> "████░░░░". */
export function bar(pct: number, width: number): string {
  const filled = Math.min(width, Math.max(0, Math.round((pct * width) / 100)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const SPARKS = '▁▂▃▄▅▆▇█'

/** Unicode sparkline of the last `width` values, scaled to their own max (or `max` when given). */
export function spark(values: readonly number[], width: number, max?: number): string {
  const tail = values.slice(-width)
  const top = max ?? Math.max(0, ...tail)
  if (tail.length === 0 || top <= 0) return ''
  return tail.map(v => SPARKS[Math.min(7, Math.max(0, Math.round((v / top) * 7)))]).join('')
}

/**
 * Stacked cost-share bar: each category's width is proportional to its $, any non-zero
 * category gets at least one cell, remainder goes to the largest fractional parts.
 */
export function costSegments(s: Spend, width: number): { in: number; rd: number; wr: number; out: number } {
  const keys = ['in', 'rd', 'wr', 'out'] as const
  const tot = s.in + s.rd + s.wr + s.out
  const n = { in: 0, rd: 0, wr: 0, out: 0 }
  if (tot <= 0) return n
  const raw = { in: (s.in / tot) * width, rd: (s.rd / tot) * width, wr: (s.wr / tot) * width, out: (s.out / tot) * width }
  for (const k of keys) n[k] = s[k] > 0 ? Math.max(1, Math.floor(raw[k])) : 0
  let used = n.in + n.rd + n.wr + n.out
  const byFrac = keys.filter(k => s[k] > 0).sort((a, b) => (raw[b] % 1) - (raw[a] % 1))
  for (let i = 0; used < width && byFrac.length > 0; i++, used++) n[byFrac[i % byFrac.length]!] += 1
  for (const k of ['out', 'wr', 'rd', 'in'] as const) while (used > width && n[k] > 1) (n[k] -= 1), (used -= 1)
  return n
}

// ---------- rate-limit windows ----------

export const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }

export type WindowOutlook = {
  /** Linear projection of usage % at the window's reset. */
  projected?: number
  /** At the current average pace, how long until 100%; absent when the pace stays under it. */
  hitsLimitInMs?: number
  /** Time until the window resets. */
  resetsInMs?: number
}

/**
 * Projects a rate-limit window from its % used and reset time, assuming the average pace so
 * far continues. Too early in the window (first 5%) to say anything useful -> projection omitted.
 */
export function outlook(pct: number, resetsAtMs: number | undefined, windowMs: number | undefined, now: number): WindowOutlook {
  if (resetsAtMs === undefined || Number.isNaN(resetsAtMs)) return {}
  const remaining = resetsAtMs - now
  if (remaining <= 0) return {}
  if (windowMs === undefined) return { resetsInMs: remaining }
  const elapsed = windowMs - remaining
  if (elapsed <= windowMs * 0.05 || pct <= 0) return { resetsInMs: remaining }
  const projected = Math.round(pct / (elapsed / windowMs))
  const toFull = (elapsed * 100) / pct - elapsed
  return { projected, resetsInMs: remaining, hitsLimitInMs: pct >= 100 ? 0 : toFull < remaining ? toFull : undefined }
}

// ---------- prompt cache ----------

export const TTL_MS: Record<Ttl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

/** Whether the main conversation's cache is still warm, and for how long. */
export function cacheState(lastRequestAt: number | undefined, ttl: Ttl, now: number): { warm: boolean; leftMs: number } {
  if (lastRequestAt === undefined) return { warm: false, leftMs: 0 }
  const leftMs = lastRequestAt + TTL_MS[ttl] - now
  return { warm: leftMs > 0, leftMs: Math.max(0, leftMs) }
}

// ---------- compaction advisor ----------
// Counted per API REQUEST (an agentic prompt fans out into many, each re-reading the full context).
//   C = current context, B = prefix that survives compaction (≈ first request of the session),
//   S = estimated post-compact context = B + summary + re-attached files/skills.
//   Warm: upfront U = C*r + O*o + (S-B)*w; saving per later request D = (C-S)*r; payback N = U/D.
//   Cold: the next request re-writes C at w anyway; compacting instead costs C*w5 + O*o + S*w.
// Sources: code.claude.com/docs/en/prompt-caching (#compacting-the-conversation, #cache-lifetime).

export const CMP = { summaryOut: 8000, reattach: 20000, baseDefault: 20000, minCtx: 60000 } as const

export type Advice =
  | { kind: 'fresh' }
  | { kind: 'small'; ctx: number }
  | { kind: 'warm'; ctx: number; after: number; costUsd: number; savesPerReq: number; paybackReqs: number; cliff: boolean; nearAuto: boolean }
  | { kind: 'cold'; ctx: number; after: number; netNowUsd: number; savesPerReq: number; cliff: boolean; nearAuto: boolean }

export function advise(args: { ctx?: number; base?: number; window: number; model: string; ttl: Ttl; warm: boolean }): Advice {
  const C = args.ctx
  if (C === undefined || C <= 0) return { kind: 'fresh' }
  const B = args.base && args.base > 0 ? args.base : CMP.baseDefault
  const S = B + CMP.reattach
  if (C < CMP.minCtx || C <= S) return { kind: 'small', ctx: C }
  const p = priceOf(args.model, C)
  const w = args.ttl === '1h' ? p.w1 : p.w5
  const savesPerReq = ((C - S) * p.r) / 1e6
  const cliff = C > 200_000
  const nearAuto = args.window > 0 && C / args.window >= 0.85
  if (!args.warm) {
    const netNowUsd = (C * w - (C * p.w5 + CMP.summaryOut * p.o + S * w)) / 1e6
    return { kind: 'cold', ctx: C, after: S, netNowUsd, savesPerReq, cliff, nearAuto }
  }
  const costUsd = (C * p.r + CMP.summaryOut * p.o + (S - B) * w) / 1e6
  const paybackReqs = Math.ceil(costUsd / savesPerReq)
  return { kind: 'warm', ctx: C, after: S, costUsd, savesPerReq, paybackReqs, cliff, nearAuto }
}

// ---------- git ----------

export type Git = { branch?: string; ahead: number; behind: number; changed: number; added: number; removed: number }

/** Parses `git status --porcelain=v2 --branch` and `git diff --shortstat HEAD` output. */
export function parseGit(status: string, shortstat: string): Git {
  const g: Git = { ahead: 0, behind: 0, changed: 0, added: 0, removed: 0 }
  let oid = ''
  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) g.branch = line.slice(14).trim()
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) (g.ahead = Number(m[1])), (g.behind = Number(m[2]))
    } else if (line.trim() !== '' && !line.startsWith('#')) g.changed += 1
  }
  if (g.branch === '(detached)') g.branch = oid.slice(0, 7) || undefined
  g.added = Number(/(\d+) insertion/.exec(shortstat)?.[1] ?? 0)
  g.removed = Number(/(\d+) deletion/.exec(shortstat)?.[1] ?? 0)
  return g
}

/** "claude-opus-5-5[1m]" -> "Opus 5.5"; unknown ids pass through. */
export function modelLabel(id: string): string {
  const m = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?(?!\d)/i.exec(id)
  if (!m) return id
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  // a trailing date stamp (claude-sonnet-4-20250514) is not a minor version
  const minor = m[3] && m[3].length <= 2 ? `.${m[3]}` : ''
  return `${name} ${m[2]}${minor}`
}
