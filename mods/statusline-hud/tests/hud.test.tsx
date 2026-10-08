import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const H = 3600_000
const NOW = 1_800_000_000_000
const START = { cwd: '/work/example-project', source: 'startup' } as never

type Usage = { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; output_tokens: number }
type World = { toasts: string[]; model: string; ctxTokens: number; surfaces: string[]; usage?: Usage }

/** The engine beneath the mod: a subscription session on Opus 5.5, 2h into its 5h window. */
function world(on: On, w: Partial<World> = {}) {
  const s: World = { toasts: [], model: 'claude-opus-5-5', ctxTokens: 150_000, surfaces: ['terminal'], ...w }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, {})
  on('session.usage', () => ({
    value: {
      startedAt: NOW - 30 * 60_000,
      context: { tokens: s.ctxTokens, window: 1_000_000, percent: Math.round((s.ctxTokens / 1_000_000) * 100) },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 80, resetsAt: new Date(NOW + 3 * H).toISOString() },
        { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(NOW + 5 * 24 * H).toISOString() },
      ],
      cost: { usd: 1.5 },
    },
  }))
  on('session.model', () => ({ value: s.model }))
  on('session.cwd', () => ({ value: '/work/example-project' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  on('session.surfaces', () => ({ value: s.surfaces as never }))
  on('session.version', () => ({ value: { version: '2.1.294', base: '2.1.294', builtAt: '2026-10-01T00:00:00Z' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('agent.list', () => ({ value: [] }))
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
    s.toasts.push(e.text)
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
        ...(s.usage ?? {
          input_tokens: 1_000,
          // the session's first request is just the system prompt and tools
          cache_read_input_tokens: e.index === 0 ? 10_000 : 140_000,
          cache_creation_input_tokens: 9_000,
          output_tokens: 2_000,
        }),
      },
    }
  })
  // the engine's own drawing of the lines the mod extends
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`${e.props.word}${e.props.suffix}`}</Text>
  })
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`${e.props.word} for ${Math.round(e.props.durationMs / 1000)}s`}</Text>
  })
  return { clock, s }
}

async function step($: Engine, opts: { agentId?: string; index?: number; model?: string } = {}) {
  const stream = $.turn.step({ turnId: 't1', index: opts.index ?? 0, model: opts.model ?? 'claude-opus-5-5', effort: 'high', messageCount: 3, agentId: opts.agentId })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

const BAND = { plugin: 'statusline-hud', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 140 } as never } as const

test('a response lands in the ledger and the report', async ($, on) => {
  const { s } = world(on)
  await $.session.start(START)
  await step($)
  await step($, { index: 1 })
  const { text } = await $.command.run({ command: 'hud', args: 'status' } as never)
  expect(text).toMatch(/Opus 5\.5 \[high\]/)
  expect(text).toMatch(/\*\*five_hour\*\* 80% used, resets in 3h00m, on pace for 200% at reset, hits 100% in ~30m/)
  // 1k in*4 + 140k rd*0.2 + 9k wr*8 (1h on a subscription) + 2k out*20, per MTok, plus the first request
  expect(text).toMatch(/\$0\.26 at list price over 2 requests, cache hit 88%/)
  expect(text).toMatch(/\*\*prompt cache\*\* \(1h\): warm, cold in 1h00m/)
  expect(text).toMatch(/\*\*compaction\*\* costs \$\d\.\d\d, saves \$0\.\d+\/request, pays back in \d+ requests/)
  expect(s.toasts.some(t => /five_hour limit: at this pace you hit 100% in ~30m/.test(t))).toBe(true)
})

test('subagent requests are counted apart from the main loop', async ($, on) => {
  world(on)
  await $.session.start(START)
  await step($, { agentId: 'agent-7' })
  const { text } = await $.command.run({ command: 'hud', args: 'status' } as never)
  expect(text).toMatch(/over 0 requests/)
  expect(text).toMatch(/subagents \$0\.\d+ over 1 requests/)
})

test('the model tool answers the same report', async ($, on) => {
  world(on)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'mcp__statusline-hud__usage' } as never)
  expect(String((r as { result?: unknown }).result)).toMatch(/\*\*context\*\* 15%/)
})

test('terminal band carries everything the script did', async ($, on) => {
  world(on)
  await $.session.start(START)
  await step($)
  await step($, { index: 1 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  for (const text of [/ctx: 15%/, /Opus 5\.5/, /⎇ main/, /^\+12$/, /5h:/, /Σ/, /pays back in/, /Example Linux/]) {
    expect(await ui.find({ type: 'Text', text }), String(text)).toBeDefined()
  }
  await ui.unmount()
  const { text } = await $.command.run({ command: 'hud', args: '' } as never)
  expect(text).toMatch(/hidden/)
})

test('desktop band leaves out what the Code tab already shows', async ($, on) => {
  world(on)
  await $.session.start(START)
  await step($)
  await step($, { index: 1 })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // the model picker, usage ring, branch, diff stats and the OS clock are Desktop's own
  for (const text of [/ctx:/, /Opus/, /⎇/, /^\+12$/, /5h:/, /Example Linux/, /🕐/]) {
    expect(await ui.find({ type: 'Text', text }), String(text)).toBeUndefined()
  }
  // what only the HUD knows stays: the pace, cost, cache, the ledger, the advisor
  for (const text of [/5h pace/, /100% in 30m/, /cost:\$1\.50/, /cache 1h warm/, /Σ/, /pays back in/]) {
    expect(await ui.find({ type: 'Text', text }), String(text)).toBeDefined()
  }
  await ui.unmount()
})

test('the spinner shows the running turn, its closing line what it cost', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($)
  await step($, { index: 1 })
  const spinner = await $.ui.mount({ plugin: 'statusline-hud', surface: 'terminal', component: 'Spinner', props: { word: 'Baking', message: null, suffix: '…', mode: 'responding' } as never })
  expect(await spinner.find({ type: 'Text', text: 'Baking… $0.26 · 2 req' })).toBeDefined()
  await spinner.unmount()
  await $.turn.complete({ answer: 'ok', durationMs: 64_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  const ui = await $.ui.mount({ plugin: 'statusline-hud', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 64_000 } as never })
  expect(await ui.find({ type: 'Text', text: /\$0\.26 · 2 req/ })).toBeDefined()
  await ui.unmount()
})

test('a re-write while the cache is warm is flagged as a miss', async ($, on) => {
  const { clock, s } = world(on)
  await $.session.start(START)
  await step($, { index: 1 })
  await clock.advance(60_000)
  // a model switch: the new model's cache is empty
  s.usage = { input_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 150_000, output_tokens: 1_000 }
  await step($, { index: 2, model: 'claude-sonnet-5-5' })
  expect(s.toasts.some(t => /Cache miss: re-wrote 150\.0k tokens .* Likely cause: model switch/.test(t))).toBe(true)
  const { text } = await $.command.run({ command: 'hud', args: 'status' } as never)
  expect(text).toMatch(/1 unexpected miss cost ~\$0\.60/)
})

test('compactions are logged with what they cut and cost', async ($, on) => {
  const { s } = world(on)
  on('session.compact', () => ({
    messages: [{ role: 'user', text: 'summary', toolUses: [] }] as never,
    tokensBefore: 300_000,
    tokensAfter: 40_000,
    usage: { input_tokens: 0, cache_read_input_tokens: 300_000, cache_creation_input_tokens: 0, output_tokens: 8_000 },
  }))
  await $.session.start(START)
  await step($, { index: 1 })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  expect(s.toasts.some(t => /Compacted 300\.0k → 40\.0k tokens \(−87%\)/.test(t))).toBe(true)
  const { text } = await $.command.run({ command: 'hud', args: 'status' } as never)
  expect(text).toMatch(/\*\*last compaction\*\* 300\.0k → 40\.0k, cost \$0\.\d\d \(1 this session\)/)
})

test('the dashboard pane draws everywhere and its Compact button reaches the engine', async ($, on) => {
  const { s } = world(on)
  on('session.compact', () => ({ skip: 'a test hook vetoed it' }))
  await $.session.start(START)
  await step($)
  await step($, { index: 1 })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'statusline-hud',
      surface,
      component: 'Pane',
      requestId: 'hud',
      props: { title: 'Session HUD', isFocused: true, bodyColumns: 90, placement: 'dock' } as never,
    })
    expect(await ui.find({ type: 'Text', text: surface === 'desktop' ? 'Rate-limit pace' : 'Rate limits' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /100% in 30m/ })).toBeDefined()
    await ui.press({ key: 'compact' })
    await ui.unmount()
  }
  expect(s.toasts.filter(t => t === 'Compaction skipped by a hook.').length).toBe(4)
})

test('spend carries across sessions by day', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, { index: 1 })
  await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  const { text } = await $.command.run({ command: 'hud', args: 'status' } as never)
  expect(text).toMatch(/today \$0\.\d\d, last 7 days \$0\.\d\d/)
})
