import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cardPrompt, cleanTopic, grade, parseCards, pickCategories, pickDue } from '../hooks/cards'

const H = 3600_000
const NOW = 1_800_000_000_000
const START = { cwd: '/work/example-project', source: 'startup' } as never
const ZERO_USAGE = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }

/**
 * The engine beneath the mod, with a model that writes Term 1, Term 2, ... as many per call
 * as the prompt asks; `fail` answers an overloaded API instead.
 */
function world(on: On, opts: { fail?: boolean; band?: string } = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const calls: { model: string; prompt: string }[] = []
  let n = 0
  on('model.complete', (_$, e) => {
    calls.push({ model: e.model, prompt: e.prompt })
    if (opts.fail) return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as never, usage: ZERO_USAGE } }
    const count = Number(/Write (\d+) flash cards/.exec(e.prompt)?.[1] ?? 1)
    const cards = Array.from({ length: count }, () => {
      n += 1
      return { term: `Term ${n}`, category: 'testing', definition: `Definition ${n}`, example: `Example ${n}` }
    })
    return { value: { isAnswered: true as const, text: '```json\n' + JSON.stringify(cards) + '\n```', usage: ZERO_USAGE } }
  })
  const opened: { id: string; focus?: true }[] = []
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, focus: e.focus })
    return { value: { isPlaced: true } as never }
  })
  on('ui.close', () => ({ value: undefined }))
  // the band beneath this mod: empty, or another mod's text
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return opts.band ? <Text>{opts.band}</Text> : <Box />
  })
  return { clock, calls, opened }
}

const BAND = { plugin: 'flashcards', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 140 } as never } as const

const boardOn = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'flashcards',
    surface,
    component: 'Pane',
    requestId: 'flashcards',
    props: { title: 'Flash cards', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  }) as const

test('a card reply is held to the fields asked for', () => {
  const two = parseCards('Sure! [{"term":"CAP","category":"d","definition":"d","example":"e"},{"term":"cap","category":"d","definition":"d","example":"e"},{"term":"ACID","category":"d","definition":"d","example":"e"}]', NOW)
  expect(two.map(c => c.term)).toEqual(['CAP', 'ACID'])
  expect(parseCards('{"term":"CAP","category":"d","definition":"d","example":"e"}', NOW, 'Databases')[0]!.topic).toBe('Databases')
  expect(() => parseCards('no json here', NOW)).toThrow(/no JSON/)
  expect(() => parseCards('[{"term":"CAP","category":"x","definition":"","example":"e"}]', NOW)).toThrow(/no definition/)
})

test('got it climbs the ladder, again comes back in ten minutes', () => {
  const [card] = parseCards('[{"term":"Idempotency","category":"API design","definition":"d","example":"e"}]', NOW)
  const known = grade(grade(card!, true, NOW), true, NOW)
  expect(known.box).toBe(2)
  expect(known.dueAt).toBe(NOW + 3 * 24 * H)
  const again = grade(known, false, NOW)
  expect(again.box).toBe(0)
  expect(again.dueAt).toBe(NOW + 10 * 60_000)
  expect(pickDue([again], NOW + 11 * 60_000)?.term).toBe('Idempotency')
  // a card already on the board is not dealt again, nor one from another topic
  expect(pickDue([again], NOW + 11 * 60_000, [{ ...again, term: 'idempotency' }])).toBeUndefined()
  expect(pickDue([again], NOW + 11 * 60_000, [], 'Rust')).toBeUndefined()
})

test('a topic shapes the request; categories of a general batch all differ', () => {
  expect(new Set(pickCategories(3, () => 0)).size).toBe(3)
  expect(cardPrompt(['a', 'b', 'c'], [], [], 'Rust lifetimes')).toMatch(/^Write 3 flash cards about this topic: Rust lifetimes\./)
  expect(cardPrompt(['a', 'b', 'c'], [], [])).toMatch(/one for each of these categories, in order: a; b; c/)
  expect(cleanTopic('  Rust   lifetimes ')).toBe('Rust lifetimes')
  expect(cleanTopic('   ')).toBeUndefined()
})

test('no model call until the board opens, and none written ahead once it closes', async ($, on) => {
  const { calls, opened } = world(on)
  await $.session.start(START)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: '0 due' })).toBeDefined()
  expect(calls.length).toBe(0)
  await band.press({ key: 'flash-open' })
  // opened with the keyboard, so the first click reaches a card
  expect(opened).toEqual([{ id: 'flashcards', focus: true }])
  // one batch for the board, one written ahead while it is open
  expect(calls.length).toBe(2)
  await band.unmount()

  const ui = await $.ui.mount(boardOn('terminal'))
  await ui.press({ key: 'flash-close' })
  // grading after the close uses the batch already written and writes none ahead
  await ui.press({ key: 'flash-flip-0' })
  await ui.press({ key: 'flash-got-0' })
  await ui.press({ key: 'flash-flip-1' })
  await ui.press({ key: 'flash-got-1' })
  expect(calls.length).toBe(2)
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`board on ${surface}: three cards, each flips on the first press, grades refill its slot`, async ($, on) => {
    const { clock, calls } = world(on)
    await $.session.start(START)
    const { text } = await $.command.run({ command: 'cards', args: '' } as never)
    expect(text).toBe('Flash card board opened.')
    expect(calls[0]!.model).toBe('claude-haiku-5-5')
    expect(calls[1]!.prompt).toMatch(/Do not use any of these terms: Term 1; Term 2; Term 3/)

    const ui = await $.ui.mount(boardOn(surface))
    for (const term of ['Term 1', 'Term 2', 'Term 3']) expect(await ui.find({ type: 'Button', text: `▸ ${term}` } as never), term).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Definition 2' })).toBeUndefined()

    // each card flips on its own, on the first press
    await ui.press({ key: 'flash-flip-1' })
    expect(await ui.find({ type: 'Text', text: 'Definition 2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Definition 1' })).toBeUndefined()
    await ui.press({ key: 'flash-flip-0' })
    expect(await ui.find({ type: 'Text', text: 'Definition 1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Example 1/ })).toBeDefined()

    // got it on card 1 refills that slot from the batch written ahead; card 2 stays flipped
    await ui.press({ key: 'flash-got-0' })
    expect(await ui.find({ type: 'Button', text: '▸ Term 4' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Definition 2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1/4 learned' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓ Term 1 · back in 1d' })).toBeDefined()

    // again on card 2: ten minutes on, it comes back before a new one
    await ui.press({ key: 'flash-again-1' })
    expect(await ui.find({ type: 'Text', text: '↺ Term 2 · back in 10m' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: '▸ Term 5' } as never)).toBeDefined()
    await clock.advance(11 * 60_000)
    await ui.press({ key: 'flash-flip-2' })
    await ui.press({ key: 'flash-again-2' })
    expect(await ui.find({ type: 'Button', text: '▸ Term 2' } as never)).toBeDefined()

    // a new set replaces all three
    await ui.press({ key: 'flash-deal' })
    expect(await ui.find({ type: 'Button', text: '▸ Term 4' } as never)).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: '▸ Term 2' } as never)).toBeUndefined()
    await ui.unmount()
  })
}

test('a typed topic deals a board on it; general goes back', async ($, on) => {
  const { calls } = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'cards', args: '' } as never)
  const ui = await $.ui.mount(boardOn('desktop'))
  await ui.input({ key: 'flash-topic', text: 'Rust lifetimes' } as never)
  expect(calls.some(c => /about this topic: Rust lifetimes/.test(c.prompt))).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'Topic: Rust lifetimes' })).toBeDefined()
  await ui.press({ key: 'flash-topic-clear' })
  expect(await ui.find({ type: 'Text', text: 'Topic cleared: general software development' })).toBeDefined()
  expect(calls.at(-1)!.prompt).toMatch(/one for each of these categories/)
  await ui.unmount()
})

test('/cards with a topic opens the board on it in one deal', async ($, on) => {
  const { calls } = world(on)
  await $.session.start(START)
  const { text } = await $.command.run({ command: 'cards', args: 'Kubernetes' } as never)
  expect(text).toBe('Flash card board opened on Kubernetes.')
  expect(calls[0]!.prompt).toMatch(/about this topic: Kubernetes/)
})

test('a failed card says why on its slot and retries on demand', async ($, on) => {
  world(on, { fail: true })
  await $.session.start(START)
  await $.command.run({ command: 'cards', args: '' } as never)
  const ui = await $.ui.mount(boardOn('terminal'))
  expect(await ui.find({ type: 'Text', text: /Couldn't write a card: api-error 529 overloaded/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'flash-retry-0' } as never)).toBeDefined()
  await ui.unmount()
})

test('the card line goes under what the band above it draws', async ($, on) => {
  // another mod's band, beneath this one in the chain
  world(on, { band: 'other band' })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'other band' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '📇 cards' })).toBeDefined()
  await ui.unmount()
})
