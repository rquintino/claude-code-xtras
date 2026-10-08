// State contract for the flashcards mod: every value it keeps in $.state.

/** One flash card: a term the model wrote, with its place on the review ladder. */
export type FlashCard = {
  term: string
  category: string
  definition: string
  example: string
  /** 0: new or marked Again; each Got it climbs one step (1d, 3d, 7d, 21d, 60d). */
  box: number
  /** When the card is due for review again. */
  dueAt: number
  seenAt: number
  /** The topic the person asked for when the card was written; absent for general cards. */
  topic?: string
}

/** One place on the board. */
export type FlashSlot = {
  card?: FlashCard
  isFlipped: boolean
  status: 'idle' | 'loading' | 'error'
  error?: string
}

/** What the board and its line under the band draw. */
export type FlashView = {
  slots: FlashSlot[]
  /** The topic new cards are written about; absent: general software development. */
  topic?: string
  /** What the last grade did, e.g. `✓ CAP theorem · back in 3d`. */
  last?: string
  due: number
  learned: number
  total: number
}

declare module 'claude-code' {
  interface PluginState {
    flashcards: {
      board: FlashView
    }
  }
}
