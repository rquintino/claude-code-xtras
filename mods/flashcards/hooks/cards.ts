// Flash cards on a side board: software development terms the model writes in batches,
// with light spaced repetition (Got it pushes a card out, Again brings it back soon).
// Pure helpers; register.tsx owns the engine calls.

import type { FlashCard, FlashSlot, FlashView } from '../types'

export const DECK_KEY = 'flash:deck'
export const KEEP_CARDS = 500
/** Cards on the board, and cards the model writes per call. */
export const SLOTS = 3
const RECENT = 60
const MIN = 60_000
const DAY = 86_400_000
/** Again: back in ten minutes. Unrated: tomorrow. Got it: the next step of the ladder. */
const AGAIN_MS = 10 * MIN
const UNRATED_MS = DAY
const LADDER_MS = [DAY, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY]

export const CATEGORIES = [
  'design patterns', 'data structures', 'algorithms', 'git and version control', 'testing',
  'distributed systems', 'databases', 'application security', 'networking', 'concurrency',
  'CI/CD and DevOps', 'cloud infrastructure', 'frontend', 'API design', 'operating systems',
  'programming languages and compilers', 'LLM and AI engineering', 'software architecture',
  'performance', 'observability',
]

export const CARD_SYSTEM =
  'You write flash cards that teach software development terms to an experienced developer. ' +
  'Reply with a JSON array and nothing else (no prose, no code fence), one object per card: ' +
  '{"term": string, "category": string, "definition": string, "example": string}. ' +
  'definition: plain language, at most 220 characters. example: a concrete usage, snippet or analogy, at most 160 characters. ' +
  'Every term must be different.'

export const EMPTY_FLASH: FlashView = { slots: [], due: 0, learned: 0, total: 0 }

/** A topic as typed, trimmed and capped; empty means general. */
export const cleanTopic = (text: string): string | undefined => text.trim().replace(/\s+/g, ' ').slice(0, 120) || undefined

export const emptySlot = (): FlashSlot => ({ isFlipped: false, status: 'idle' })

/** `count` different categories, in random order. */
export function pickCategories(count: number, random: () => number = Math.random): string[] {
  const pool = [...CATEGORIES]
  return Array.from({ length: Math.min(count, pool.length) }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]!)
}

/**
 * The request for a batch of new cards, clear of the terms already studied: on the person's
 * topic when they gave one, else one per category.
 */
export function cardPrompt(categories: readonly string[], deck: readonly FlashCard[], extra: readonly string[], topic?: string): string {
  const recent = [...deck].sort((a, b) => b.seenAt - a.seenAt).slice(0, RECENT).map(c => c.term)
  const avoid = [...recent, ...extra]
  const ask = topic
    ? `Write ${categories.length} flash cards about this topic: ${topic}. Each card covers a different idea within it; set category to the sub-area. `
    : `Write ${categories.length} flash cards, one for each of these categories, in order: ${categories.join('; ')}. `
  return (
    ask +
    'Pick terms worth knowing, from fundamentals to advanced.' +
    (avoid.length ? ` Do not use any of these terms: ${avoid.join('; ')}.` : '')
  )
}

function cardFrom(o: Record<string, unknown>, now: number, topic?: string): FlashCard {
  for (const k of ['term', 'category', 'definition', 'example'] as const)
    if (typeof o[k] !== 'string' || !(o[k] as string).trim()) throw new Error(`a card in the reply has no ${k}`)
  return {
    term: (o.term as string).trim(),
    category: (o.category as string).trim(),
    definition: (o.definition as string).trim(),
    example: (o.example as string).trim(),
    box: 0,
    dueAt: now + UNRATED_MS,
    seenAt: now,
    ...(topic ? { topic } : {}),
  }
}

/** The cards of the reply as the model wrote them, held to the fields asked for; a lone object is one card. */
export function parseCards(text: string, now: number, topic?: string): FlashCard[] {
  const list = text.indexOf('[')
  const obj = text.indexOf('{')
  const isList = list >= 0 && (obj < 0 || list < obj)
  const start = isList ? list : obj
  const end = text.lastIndexOf(isList ? ']' : '}')
  if (start < 0 || end < start) throw new Error('the card reply holds no JSON')
  const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
  const items = Array.isArray(parsed) ? parsed : [parsed]
  const cards = items.map(o => cardFrom(o as Record<string, unknown>, now, topic))
  return cards.filter((c, i) => cards.findIndex(d => sameCard(c, d)) === i)
}

/** Got it climbs the ladder; Again drops to the bottom and returns in ten minutes. */
export function grade(card: FlashCard, isKnown: boolean, now: number): FlashCard {
  if (!isKnown) return { ...card, box: 0, dueAt: now + AGAIN_MS, seenAt: now }
  const box = card.box + 1
  return { ...card, box, dueAt: now + LADDER_MS[Math.min(box, LADDER_MS.length) - 1]!, seenAt: now }
}

/** A card's place on the ladder as five dots, filled per Got it. */
export const masteryDots = (box: number): string => '●'.repeat(Math.min(box, 5)) + '○'.repeat(5 - Math.min(box, 5))

/** How long until a card is back: minutes, hours or days. */
export function fmtIn(ms: number): string {
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / MIN))}m`
  if (ms < DAY) return `${Math.round(ms / 3_600_000)}h`
  return `${Math.round(ms / DAY)}d`
}

export const sameCard = (a: FlashCard, b: FlashCard) => a.term.toLowerCase() === b.term.toLowerCase()

/** The cards on the board. */
export const boardOf = (f: FlashView): FlashCard[] => f.slots.flatMap(s => (s.card ? [s.card] : []))

/** The most overdue card not on the board; with a topic, only that topic's cards. */
export function pickDue(deck: readonly FlashCard[], now: number, board: readonly FlashCard[] = [], topic?: string): FlashCard | undefined {
  return deck
    .filter(c => c.dueAt <= now && !board.some(b => sameCard(b, c)) && (!topic || c.topic === topic))
    .sort((a, b) => a.dueAt - b.dueAt)[0]
}

/** The deck with `card` in it, replacing any card of the same term, newest kept. */
export function withCard(deck: readonly FlashCard[], card: FlashCard): FlashCard[] {
  return [...deck.filter(c => !sameCard(c, card)), card].slice(-KEEP_CARDS)
}

export function deckCounts(deck: readonly FlashCard[], now: number, board: readonly FlashCard[] = []) {
  return {
    due: deck.filter(c => c.dueAt <= now && !board.some(b => sameCard(b, c))).length,
    learned: deck.filter(c => c.box > 0).length,
    total: deck.length,
  }
}

/** A progress bar `width` cells wide. */
export function progressBar(pct: number, width: number): string {
  const full = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}
