import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const H = 3600_000
const NOW = 1_800_000_000_000

/** The engine beneath the mod: a subscription session on Opus 5.5, 2h into its 5h window. */
function world(on: On, toasts: string[] = []) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, {})
  on('session.usage', () => ({ value: {
    startedAt: NOW - 30 * 60_000,
    context: { tokens: 150_000, window: 1_000_000, percent: 15 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 80, resetsAt: new Date(NOW + 3 * H).toISOString() },
      { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(NOW + 5 * 24 * H).toISOString() },
    ],
    cost: { usd: 1.5 },
  } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/work/example-project' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  on('session.version', () => ({ value: { version: '2.1.294', base: '2.1.294', builtAt: '2026-10-01T00:00:00Z' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__statusline-hud__${e.name}` } }))
  on('fs.read', () => ({ value: 'PRETTY_NAME="Example Linux 1.0"\n' }))
  on('process.run', (_$, e) => {
    const argv = e.argv.join(' ')
    const stdout = argv.startsWith('git status')
      ? '# branch.oid 0123456789abcdef\n# branch.head main\n# branch.ab +1 -0\n1 .M N... 1 1 1 a a f.ts\n'
      : argv.startsWith('git diff')
        ? ' 1 file changed, 12 insertions(+), 4 deletions(-)\n'
        : 'Linux\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: e.model,
        input_tokens: 1_000,
        // the session's first request is just the system prompt and tools
        cache_read_input_tokens: e.index === 0 ? 10_000 : 140_000,
        cache_creation_input_tokens: 9_000,
        output_tokens: 2_000,
      },
    }
  })
  return clock
}

async function step($: Engine, agentId?: string, index = 0) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'high', messageCount: 3, agentId })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

test('a response lands in the ledger and the report', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await $.session.start({ cwd: '/work/example-project', source: 'startup' } as never)
  await step($)
  await step($, undefined, 1)
  const { text } = await $.command.run({ command: 'hud', args: 'status' } as never)
  expect(text).toMatch(/Opus 5\.5 \[high\]/)
  expect(text).toMatch(/five_hour: 80% used, resets in 3h00m, on pace for 200% at reset, hits 100% in ~30m/)
  // 1k in*4 + 140k rd*0.2 + 9k wr*8 (1h on a subscription) + 2k out*20, per MTok
  expect(text).toMatch(/\$0\.26 at list price over 2 requests, cache hit 88%/)
  expect(text).toMatch(/compaction: costs \$\d\.\d\d, saves \$0\.\d+\/request, pays back in \d+ requests/)
  expect(text).toMatch(/prompt cache \(1h\): warm, cold in 1h00m/)
  expect(toasts.some(t => /five_hour limit: at this pace you hit 100% in ~30m/.test(t))).toBe(true)
})

test('subagent requests are counted apart from the main loop', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/example-project', source: 'startup' } as never)
  await step($, 'agent-7')
  const { text } = await $.command.run({ command: 'hud', args: 'status' } as never)
  expect(text).toMatch(/over 0 requests/)
  expect(text).toMatch(/subagents \$0\.\d+ over 1 requests/)
})

test('the model tool answers the same report', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/example-project', source: 'startup' } as never)
  const r = await $.tool.call({ tool: 'mcp__statusline-hud__usage' } as never)
  expect(String((r as { result?: unknown }).result)).toMatch(/context 15%/)
})

test('the band draws on terminal and desktop, and hides with /hud', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/example-project', source: 'startup' } as never)
  await step($)
  await step($, undefined, 1)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'statusline-hud',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 140 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /ctx: 15%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⎇ main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Σ/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /pays back in/ })).toBeDefined()
    await ui.unmount()
  }
  const { text } = await $.command.run({ command: 'hud', args: '' } as never)
  expect(text).toMatch(/hidden/)
})

test('the dashboard pane draws everywhere and its Compact button reaches the engine', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  on('session.compact', () => ({ skip: 'a test hook vetoed it' }))
  await $.session.start({ cwd: '/work/example-project', source: 'startup' } as never)
  await step($)
  await step($, undefined, 1)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'statusline-hud',
      surface,
      component: 'Pane',
      requestId: 'hud',
      props: { title: 'Session HUD', isFocused: true, bodyColumns: 90, placement: 'dock' } as never,
    })
    expect(await ui.find({ type: 'Text', text: 'Rate limits' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /100% in 30m/ })).toBeDefined()
    await ui.press({ key: 'compact' })
    await ui.unmount()
  }
  expect(toasts.filter(t => t === 'Compaction skipped by a hook.').length).toBe(4)
})
