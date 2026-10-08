import { describe, expect, test } from 'claude-code/testing'

import type { HudLedger, HudView } from '../types'
import { bandRows, compactLine, missCause, NATIVE, turnTail } from '../hooks/present'

const H = 3600_000
const NOW = 1_800_000_000_000

const VIEW: HudView = {
  now: NOW,
  model: 'claude-opus-5-5',
  effort: 'high',
  ctxTokens: 150_000,
  ctxWindow: 1_000_000,
  ctxPct: 15,
  rates: [{ kind: 'five_hour', pct: 80, resetsAt: NOW + 3 * H }],
  costUsd: 1.5,
  startedAt: NOW - H,
  ttl: '1h',
  git: { branch: 'main', ahead: 1, behind: 0, changed: 2, added: 12, removed: 4 },
  cwdLeaf: 'example-project',
  os: 'Example Linux',
}

const LEDGER: HudLedger = {
  reqs: 2, in: 2000, rd: 150_000, wr: 18_000, out: 4000, usdIn: 0.008, usdRd: 0.03, usdWr: 0.144, usdOut: 0.08,
  agentReqs: 0, agentUsd: 0, baseCtx: 20_000,
  last: { model: 'claude-opus-5-5', in: 1000, rd: 140_000, wr: 9000, out: 2000, usd: 0.14, at: NOW - 60_000 },
  ctxHistory: [20_000, 150_000], usdHistory: [0.12, 0.14], tools: {}, turns: [],
  misses: 0, missUsd: 0, compactions: [], savedUsd: 0,
}

const text = (rows: { t: string }[][]) => rows.map(r => r.map(s => s.t).join('')).join('\n')

describe('per-surface band', () => {
  const opts = { density: 'full', budgetUsd: 0, narrow: false, clock: '14:32' }

  test('terminal shows the full status line', async () => {
    const out = text(bandRows(VIEW, LEDGER, { ...opts, surface: 'terminal' }))
    for (const s of ['ctx: 15%', 'Opus 5.5 [high]', '5h:', '⎇ main', '+12/-4', 'example-project', 'cost:$1.50', 'Example Linux', '14:32'])
      expect(out.includes(s), s).toBe(true)
  })

  test('desktop drops what the Code tab draws and keeps the rest', async () => {
    const out = text(bandRows(VIEW, LEDGER, { ...opts, surface: 'desktop' }))
    for (const s of ['ctx:', 'Opus', '5h:', '⎇', '+12', 'example-project', 'Example Linux', '14:32'])
      expect(out.includes(s), `desktop should not show ${s}`).toBe(false)
    for (const s of ['5h pace →200%', '100% in 30m', 'cost:$1.50', 'cache 1h warm', 'Σ', 'last', 'cmp'])
      expect(out.includes(s), s).toBe(true)
  })

  test('the native table names only what Desktop documents', async () => {
    expect(NATIVE.terminal).toEqual([])
    expect([...NATIVE.desktop].sort()).toEqual(['branch', 'clock', 'context', 'gitDiff', 'model', 'planUsage'])
  })

  test('compact density keeps the first rows only', async () => {
    expect(bandRows(VIEW, LEDGER, { ...opts, density: 'compact', surface: 'terminal' }).length).toBe(2)
    expect(bandRows(VIEW, LEDGER, { ...opts, density: 'compact', surface: 'desktop' }).length).toBe(1)
  })

  test('one-liners follow the surface too', async () => {
    expect(compactLine(VIEW, LEDGER, 'terminal')).toBe('ctx 15% · Opus 5.5 · 5h 80% · $1.50 · cache 59m')
    expect(compactLine(VIEW, LEDGER, 'desktop')).toBe('5h 100% in 30m · $1.50 · cache 59m')
  })
})

describe('turns and misses', () => {
  test('turn tail', async () => {
    expect(turnTail({ usd: 0.42, reqs: 7, ctxDelta: 18_000 })).toBe('$0.42 · 7 req · ctx +18.0k')
    expect(turnTail({ usd: 0.42, reqs: 1, ctxDelta: 0 })).toBe('$0.42 · 1 req')
  })

  test('miss causes', async () => {
    const prev = { model: 'claude-opus-5-5', in: 1000, rd: 140_000, wr: 9000, at: 0 }
    const base = { ttlMs: H, now: 60_000 }
    expect(missCause({ ...base, prev, cur: { model: 'claude-opus-5-5', rd: 150_000, wr: 3000 } })).toBeUndefined()
    expect(missCause({ ...base, prev, cur: { model: 'claude-sonnet-5-5', rd: 0, wr: 150_000 } })).toBe('model switch')
    expect(missCause({ ...base, prev, cur: { model: 'claude-opus-5-5', rd: 10_000, wr: 140_000 } })).toMatch(/prefix changed/)
    // an expired cache, or the request right after a compaction, re-writes by design
    expect(missCause({ ...base, now: 2 * H, prev, cur: { model: 'claude-opus-5-5', rd: 0, wr: 150_000 } })).toBeUndefined()
    expect(missCause({ ...base, compactedAt: 30_000, prev, cur: { model: 'claude-opus-5-5', rd: 0, wr: 40_000 } })).toBeUndefined()
  })
})
