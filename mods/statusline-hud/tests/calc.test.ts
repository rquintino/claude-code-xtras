import { describe, expect, test } from 'claude-code/testing'

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
  priceOf,
  spark,
  spendOf,
  WINDOW_MS,
} from '../hooks/calc'

describe('pricing', () => {
  test('specific ids win over their families', async () => {
    expect(priceOf('claude-opus-5-5').i).toBe(4)
    expect(priceOf('claude-opus-5').i).toBe(5)
    expect(priceOf('claude-sonnet-5-5').r).toBe(0.1)
    expect(priceOf('claude-sonnet-5').r).toBe(0.2)
    expect(priceOf('claude-fable-5-1').r).toBe(0.25)
    expect(priceOf('claude-fable-5').r).toBe(1)
    expect(priceOf('claude-opus-4-1').i).toBe(15)
    expect(priceOf('something-new').i).toBe(5)
  })

  test('haiku 5.5 is priced by prompt length', async () => {
    expect(priceOf('claude-haiku-5-5', 50_000).i).toBe(0.1)
    expect(priceOf('claude-haiku-5-5', 150_000).i).toBe(0.5)
  })

  test('spend prices cache writes at the TTL in force', async () => {
    const t = { in: 1_000_000, rd: 1_000_000, wr: 1_000_000, out: 1_000_000 }
    const h = spendOf(t, 'claude-opus-5-5', '1h')
    expect(h).toEqual({ in: 4, rd: 0.2, wr: 8, out: 20, total: 32.2 })
    expect(spendOf(t, 'claude-opus-5-5', '5m').wr).toBe(5)
  })
})

describe('formatting', () => {
  test('tokens, dollars, durations', async () => {
    expect(fmtTok(999)).toBe('999')
    expect(fmtTok(1234)).toBe('1.2k')
    expect(fmtTok(1_234_567)).toBe('1.2M')
    expect(fmtUsd(0.004)).toBe('$0.004')
    expect(fmtUsd(1234.5)).toBe('$1,234.50')
    expect(fmtUsd(0)).toBe('$0.00')
    expect(fmtDur(45_000)).toBe('45s')
    expect(fmtDur(12 * 60_000)).toBe('12m')
    expect(fmtDur((3 * 60 + 5) * 60_000)).toBe('3h05m')
    expect(fmtDur(51 * 3600_000)).toBe('2d3h')
  })

  test('bars and sparklines', async () => {
    expect(bar(50, 8)).toBe('████░░░░')
    expect(bar(150, 4)).toBe('████')
    expect(spark([0, 50, 100], 3)).toBe('▁▅█')
    expect(spark([], 3)).toBe('')
  })

  test('cost segments fill the width and keep small categories visible', async () => {
    const n = costSegments({ in: 0.001, rd: 1, wr: 2, out: 7, total: 10.001 }, 20)
    expect(n.in + n.rd + n.wr + n.out).toBe(20)
    expect(n.in).toBe(1)
    expect(n.out).toBeGreaterThan(n.wr)
  })

  test('model labels', async () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5')
    expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(modelLabel('my-proxy-model')).toBe('my-proxy-model')
  })
})

describe('rate-limit outlook', () => {
  const H = 3600_000

  test('projects the average pace to the reset', async () => {
    // 40% used, 2h into a 5h window -> 100% at reset, and 100% in 3h (when it resets)
    const o = outlook(40, 3 * H, WINDOW_MS.five_hour, 0)
    expect(o.projected).toBe(100)
    expect(o.resetsInMs).toBe(3 * H)
    expect(o.hitsLimitInMs).toBeUndefined()
  })

  test('warns when the pace reaches 100% before the reset', async () => {
    // 80% used 2h in: full at 2.5h, i.e. in 30m, well before the reset in 3h
    const o = outlook(80, 3 * H, WINDOW_MS.five_hour, 0)
    expect(o.projected).toBe(200)
    expect(o.hitsLimitInMs).toBe(0.5 * H)
  })

  test('says nothing about pace in the first 5% of the window', async () => {
    expect(outlook(10, 4.9 * H, WINDOW_MS.five_hour, 0).projected).toBeUndefined()
    expect(outlook(10, undefined, WINDOW_MS.five_hour, 0)).toEqual({})
  })
})

describe('cache and compaction', () => {
  test('cache warmth follows the TTL', async () => {
    expect(cacheState(undefined, '5m', 0).warm).toBe(false)
    expect(cacheState(0, '5m', 4 * 60_000)).toEqual({ warm: true, leftMs: 60_000 })
    expect(cacheState(0, '5m', 6 * 60_000).warm).toBe(false)
  })

  test('advisor: fresh, small, warm payback, cold net', async () => {
    const base = { window: 1_000_000, model: 'claude-opus-5-5', ttl: '1h' as const }
    expect(advise({ ...base, warm: true }).kind).toBe('fresh')
    expect(advise({ ...base, ctx: 30_000, warm: true }).kind).toBe('small')
    const warm = advise({ ...base, ctx: 300_000, base: 20_000, warm: true })
    expect(warm.kind).toBe('warm')
    if (warm.kind === 'warm') {
      expect(warm.after).toBe(40_000)
      expect(warm.cliff).toBe(true)
      expect(warm.paybackReqs).toBeGreaterThan(0)
    }
    const cold = advise({ ...base, ctx: 300_000, base: 20_000, warm: false })
    // re-writing 300k at the 1h rate costs more than compacting at the 5m rate: compact now
    expect(cold.kind === 'cold' && cold.netNowUsd > 0).toBe(true)
  })
})

describe('git', () => {
  test('parses porcelain v2 and shortstat', async () => {
    const status = [
      '# branch.oid 0123456789abcdef',
      '# branch.head feature/hud',
      '# branch.upstream origin/feature/hud',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 abc abc src/a.ts',
      '? notes.md',
      '',
    ].join('\n')
    expect(parseGit(status, ' 2 files changed, 10 insertions(+), 3 deletions(-)\n')).toEqual({
      branch: 'feature/hud', ahead: 2, behind: 1, changed: 2, added: 10, removed: 3,
    })
    expect(parseGit('# branch.oid 0123456789abcdef\n# branch.head (detached)\n', '').branch).toBe('0123456')
  })
})
