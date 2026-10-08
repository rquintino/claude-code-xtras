// flashcards: a side board of three software development flash cards. Each flips on a press of
// its term and is graded on its back (Got it climbs a review ladder, Again brings it back soon).
// The model writes cards three per call, and only while the board is open: no request is made
// at session start, none is written ahead with the board closed, and closing it cancels one in flight.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { FlashCard, FlashSlot, FlashView } from '../types'
import {
  boardOf,
  CARD_SYSTEM,
  cardPrompt,
  cleanTopic,
  DECK_KEY,
  deckCounts,
  EMPTY_FLASH,
  emptySlot,
  fmtIn,
  grade,
  masteryDots,
  parseCards,
  pickCategories,
  pickDue,
  progressBar,
  sameCard,
  SLOTS,
  withCard,
} from './cards'

const BOARD = 'flashcards'
const BOARD_TITLE = 'Flash cards'
const TOPIC_KEY = 'flash:topic'

const board = atom({ plugin: 'flashcards', key: 'board' } as const, EMPTY_FLASH)

type Opts = { model: string }

function readOptions(o: PluginOptions): Opts {
  return { model: typeof o.model === 'string' && o.model ? o.model : 'claude-haiku-5-5' }
}

// The module's working copy of the stored deck, the cards written ahead and the call in flight;
// session.start rebuilds them, and it runs again on every reload.
let deck: FlashCard[] = []
let ahead: FlashCard[] = []
let writing: Promise<void> | null = null
let cancel: AbortController | null = null
/** Whether the board is open: the only time the model is asked for cards. */
let isBoardOpen = false

/** Writes a batch of new cards into the queue; one batch in the works at a time. */
function writeBatch($: EngineInterface, opts: Opts): Promise<void> {
  writing ??= (async () => {
    const f = await read($, board)
    const call = new AbortController()
    cancel = call
    const r = await $.model.complete(
      {
        model: opts.model,
        system: CARD_SYSTEM,
        prompt: cardPrompt(pickCategories(SLOTS), deck, [...boardOf(f), ...ahead].map(c => c.term), f.topic),
        maxTokens: 1200,
        timeoutMs: 45_000,
      },
      { signal: call.signal },
    )
    if (!r.isAnswered) throw new Error(r.reason === 'api-error' ? `api-error ${r.status ?? ''} ${r.error}`.trim() : r.reason)
    // a batch for a topic the person has since changed is dropped
    if ((await read($, board)).topic !== f.topic) return
    const cards = parseCards(r.text, await $.clock.now(), f.topic)
    ahead = [...ahead, ...cards.filter(c => !deck.some(d => sameCard(d, c)) && !ahead.some(a => sameCard(a, c)))]
  })().finally(() => {
    writing = null
    cancel = null
  })
  return writing
}

/** The next card for a slot: a due one not on the board, then the queue, else a fresh batch. */
async function takeCard($: EngineInterface, opts: Opts): Promise<FlashCard> {
  const f = await read($, board)
  const due = pickDue(deck, await $.clock.now(), boardOf(f), f.topic)
  if (due) return due
  // two slots can drain one batch between them: a second batch, then give up
  for (let tries = 0; tries < 2 && ahead.length === 0; tries++) await writeBatch($, opts)
  const card = ahead.shift()
  if (!card) throw new Error('the model wrote no card that is new to the deck')
  return card
}

async function saveCard($: EngineInterface, card: FlashCard): Promise<void> {
  deck = withCard(deck, card)
  await $.store.set(DECK_KEY, deck)
}

async function setSlot($: EngineInterface, i: number, slot: Partial<FlashSlot>): Promise<void> {
  await update($, board, f => ({ ...f, slots: f.slots.map((s, j) => (j === i ? { ...s, ...slot } : s)) }))
}

/** Turns card `i` over, from the state as it is now, not as it was last drawn. */
async function flipSlot($: EngineInterface, i: number): Promise<void> {
  await update($, board, f => ({ ...f, slots: f.slots.map((s, j) => (j === i ? { ...s, isFlipped: !s.isFlipped } : s)) }))
}

async function recount($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, board, f => ({ ...f, ...deckCounts(deck, now, boardOf(f)) }))
}

/** Puts a new card in slot `i`: loading while it is written, the reason when it could not be. */
async function fillSlot($: EngineInterface, opts: Opts, i: number): Promise<void> {
  await setSlot($, i, { status: 'loading', error: undefined, isFlipped: false })
  try {
    const card = await takeCard($, opts)
    const known = deck.find(c => sameCard(c, card))
    if (!known) await saveCard($, card)
    await setSlot($, i, { status: 'idle', card: known ?? card })
  } catch (err) {
    await setSlot($, i, { status: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}

/** While the board is open and nothing is due, keeps a batch written ahead so the next cards land at once. */
async function afterChange($: EngineInterface, opts: Opts): Promise<void> {
  await recount($)
  const f = await read($, board)
  if (!isBoardOpen || ahead.length > 0 || writing || pickDue(deck, await $.clock.now(), boardOf(f), f.topic)) return
  // written in the background: a failure here resurfaces on the next fill, which writes in the open
  await writeBatch($, opts).catch(() => undefined)
}

/** Deals a full board: every slot gets a new card. */
async function dealBoard($: EngineInterface, opts: Opts): Promise<void> {
  await update($, board, f => ({ ...f, slots: Array.from({ length: SLOTS }, (_, i) => f.slots[i] ?? emptySlot()) }))
  for (let i = 0; i < SLOTS; i++) await fillSlot($, opts, i)
  await afterChange($, opts)
}

/** Sets the topic new cards are written about (empty: general); a change drops the cards written for the old one. */
async function applyTopic($: EngineInterface, text: string): Promise<boolean> {
  const topic = cleanTopic(text)
  if (topic === (await read($, board)).topic) return false
  cancel?.abort()
  ahead = []
  await update($, board, f => ({ ...f, topic, last: topic ? `Topic: ${topic}` : 'Topic cleared: general software development' }))
  if (topic) await $.store.set(TOPIC_KEY, topic)
  else await $.store.delete(TOPIC_KEY)
  return true
}

async function setTopic($: EngineInterface, opts: Opts, text: string): Promise<void> {
  if (await applyTopic($, text)) await dealBoard($, opts)
}

/**
 * Opens the board with the keyboard, so the first click lands on a card; deals when it is empty
 * or the topic changed.
 */
async function openBoard($: EngineInterface, opts: Opts, topic?: string): Promise<boolean> {
  const opened = await $.ui.open({ id: BOARD, title: BOARD_TITLE, focus: true })
  isBoardOpen = true
  const isNewTopic = topic !== undefined && (await applyTopic($, topic))
  if (isNewTopic || boardOf(await read($, board)).length === 0) await dealBoard($, opts)
  return opened.isPlaced
}

async function rateSlot($: EngineInterface, opts: Opts, i: number, isKnown: boolean): Promise<void> {
  const card = (await read($, board)).slots[i]?.card
  if (!card) return
  const now = await $.clock.now()
  const graded = grade(card, isKnown, now)
  await saveCard($, graded)
  await update($, board, f => ({ ...f, last: `${isKnown ? '✓' : '↺'} ${card.term} · back in ${fmtIn(graded.dueAt - now)}` }))
  await fillSlot($, opts, i)
  await afterChange($, opts)
}

type Els = ReturnType<EngineInterface['ui']['resolve']>

/** The line under the band: the deck's counts and the way to the board. */
async function CardsLine($: EngineInterface, els: Els, opts: Opts) {
  const { Box, Button, Text } = els
  const f = await read($, board)
  return (
    <Box flexDirection="row" gap={1}>
      <Text color="cyan">📇 cards</Text>
      <Text color={f.due > 0 ? 'warning' : undefined} dimColor={f.due === 0}>{`${f.due} due`}</Text>
      <Text dimColor>{`· ${f.learned}/${f.total} learned${f.topic ? ` · ${f.topic}` : ''}`}</Text>
      <Button key="flash-open" label={f.slots.length > 0 ? 'board' : 'start learning'} hotkey="f" plain onPress={() => void openBoard($, opts)} />
    </Box>
  )
}

/** The board: a topic field, three cards that flip on a press of their term, graded on their back. */
async function Board($: EngineInterface, els: Els, opts: Opts, columns: number) {
  const { Box, Button, Text } = els
  const f = await read($, board)
  const w = Math.max(10, Math.min(30, columns - 24))
  const pct = f.total > 0 ? (f.learned / f.total) * 100 : 0
  // g and a grade the first card turned over, so a keyboard run is: 1, g, 2, a, ...
  const graded = f.slots.findIndex(s => s.isFlipped && s.status === 'idle' && s.card)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color="success">{progressBar(pct, w)}</Text>
          <Text>{`${f.learned}/${f.total} learned`}</Text>
          <Text color={f.due > 0 ? 'warning' : undefined} dimColor={f.due === 0}>{`· ${f.due} due`}</Text>
        </Box>
        <Text dimColor italic>
          {f.last ?? 'Press a term to flip its card.'}
        </Text>
      </Box>
      {'Input' in els && (
        <Box flexDirection="row" gap={1}>
          <els.Input
            key="flash-topic"
            label="Topic"
            placeholder="anything: Kubernetes, Rust lifetimes, OAuth… (empty: general)"
            value={f.topic ?? ''}
            submitLabel="learn this"
            onSubmit={text => setTopic($, opts, text)}
          />
          {f.topic && <Button key="flash-topic-clear" label="general" plain onPress={() => setTopic($, opts, '')} />}
        </Box>
      )}
      {f.slots.length === 0 && <Text dimColor>No cards yet: press new set.</Text>}
      {f.slots.map((s, i) => (
        <Box
          key={`flash-card-${i}`}
          flexDirection="column"
          borderStyle="round"
          borderColor={s.status === 'error' ? 'error' : s.isFlipped ? 'cyan' : undefined}
          borderDimColor={!s.isFlipped && s.status !== 'error'}
          paddingX={1}
        >
          {s.status === 'loading' ? (
            <Text dimColor italic>
              ✎ writing a card…
            </Text>
          ) : s.status === 'error' || !s.card ? (
            <Box flexDirection="column">
              <Text color="error" wrap="wrap">{`Couldn't write a card: ${s.error ?? 'no card'}`}</Text>
              <Button key={`flash-retry-${i}`} label="try again" onPress={() => fillSlot($, opts, i)} />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Button
                key={`flash-flip-${i}`}
                label={`${s.isFlipped ? '▾' : '▸'} ${s.card.term}`}
                hotkey={String(i + 1)}
                plain
                hover={{ color: 'cyan', underline: true }}
                onPress={() => flipSlot($, i)}
              />
              <Box flexDirection="row" gap={1}>
                <Text dimColor>{s.card.category}</Text>
                <Text color={s.card.box > 0 ? 'success' : undefined} dimColor={s.card.box === 0}>
                  {masteryDots(s.card.box)}
                </Text>
              </Box>
              {s.isFlipped && (
                <Box flexDirection="column" marginTop={1}>
                  <Text wrap="wrap">{s.card.definition}</Text>
                  <Text color="cyan" italic wrap="wrap">{`e.g. ${s.card.example}`}</Text>
                  <Box flexDirection="row" gap={1} marginTop={1}>
                    <Button key={`flash-got-${i}`} label="✓ got it" {...(i === graded ? { hotkey: 'g' } : {})} variant="primary" onPress={() => rateSlot($, opts, i, true)} />
                    <Button key={`flash-again-${i}`} label="↺ again" {...(i === graded ? { hotkey: 'a' } : {})} onPress={() => rateSlot($, opts, i, false)} />
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
      ))}
      <Box flexDirection="row" gap={1}>
        <Button key="flash-deal" label="new set" hotkey="n" onPress={() => dealBoard($, opts)} />
        <Button key="flash-close" label="close" hotkey="x" role="dismiss" onPress={() => $.ui.close({ id: BOARD })} />
      </Box>
    </Box>
  )
}

export const register: Register = (on, options) => {
  const opts = readOptions(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cards', description: 'Flash cards: open the board of software development terms', argumentHint: '[topic]' })
    const [stored, topic] = await Promise.all([$.store.get(DECK_KEY), $.store.get(TOPIC_KEY)])
    deck = Array.isArray(stored) ? (stored as FlashCard[]) : []
    ahead = []
    isBoardOpen = false
    // a card being written when the module reloaded is written again on the next fill
    await update($, board, f => ({
      ...f,
      topic: typeof topic === 'string' ? topic : undefined,
      slots: (f.slots ?? []).map(s => (s.status === 'loading' ? { ...s, status: 'idle' as const } : s)),
    }))
    await recount($)
    $.clock.every(60_000, () => {
      void (async () => {
        const [now, f] = await Promise.all([$.clock.now(), read($, board)])
        if (deckCounts(deck, now, boardOf(f)).due !== f.due) await recount($)
      })().catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'cards' }, async ($, e) => {
    const topic = e.args.trim()
    const isPlaced = await openBoard($, opts, topic || undefined)
    return { text: isPlaced ? `Flash card board opened${topic ? ` on ${topic}` : ''}.` : 'Flash card board queued: widen the terminal to place it.' }
  })

  // Closing the board, by its button or the person's close mark, stops the model: the call in flight is cancelled.
  on('ui.close', { id: BOARD }, async ($, e, next) => {
    isBoardOpen = false
    cancel?.abort()
    return next(e)
  })

  // The line goes under whatever the band above it draws (another mod's band included).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const above = await next(e)
    if (e.props.hasSurvey) return above
    const els = $.ui.resolve(e)
    const { Box } = els
    return (
      <Box flexDirection="column">
        {above}
        {await CardsLine($, els, opts)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: BOARD }, async ($, e) => Board($, $.ui.resolve(e), opts, e.props.bodyColumns))
}
