// State contract for the statusline-hud mod: every value it keeps in $.state.

/** Running totals for one session, at list prices. */
export type HudLedger = {
  /** Main-conversation requests counted. */
  reqs: number
  in: number
  rd: number
  wr: number
  out: number
  usdIn: number
  usdRd: number
  usdWr: number
  usdOut: number
  /** Subagent / workflow requests (their own caches and loops). */
  agentReqs: number
  agentUsd: number
  /** Context of the session's first request: the prefix that survives /compact. */
  baseCtx?: number
  /** Last main-loop response. */
  last?: HudLast
  /** Context tokens per main-loop request (newest last, capped). */
  ctxHistory: number[]
  /** USD per main-loop request (newest last, capped). */
  usdHistory: number[]
  /** Calls per tool name, main loop and subagents together. */
  tools: Record<string, number>
  /** Completed main-loop turns (newest last, capped). */
  turns: HudTurnDone[]
  /** Unexpected cache misses: re-writes while the cache should have been warm. */
  misses: number
  missUsd: number
  /** Compactions this session, newest last. */
  compactions: HudCompaction[]
  /** When the last compaction finished (its next request re-writes by design). */
  compactedAt?: number
  /** USD already added to the cross-session daily totals. */
  savedUsd: number
}

/** The running turn's spend so far. */
export type HudTurn = { id: string; usd: number; reqs: number; startCtx?: number }

export type HudTurnDone = { durationMs: number; usd: number; reqs: number; ctxDelta: number }

export type HudCompaction = { at: number; before?: number; after?: number; usd: number; trigger: string }

export type HudLast = { model: string; in: number; rd: number; wr: number; out: number; usd: number; at: number; effort?: string }

export type HudRate = { kind: string; pct: number; resetsAt?: number }

/** What the HUD draws, refreshed on each response, turn end and clock tick. */
export type HudView = {
  now: number
  model: string
  effort?: string
  ctxTokens?: number
  ctxWindow: number
  ctxPct?: number
  rates: HudRate[]
  /** The engine's own session total, as /cost reports it. */
  costUsd?: number
  startedAt?: number
  ttl: '5m' | '1h'
  /** How the session signs in: OAuth (a subscription), an API key, or neither (cloud provider, gateway). */
  auth?: 'bearer' | 'api-key' | 'none'
  git?: { branch?: string; ahead: number; behind: number; changed: number; added: number; removed: number }
  cwdLeaf?: string
  os?: string
  version?: string
  /** Subagents pending, running or waiting right now. */
  agentsRunning?: number
  /** List-price spend across sessions on this machine. */
  spend?: { today: number; week: number }
}

declare module 'claude-code' {
  interface PluginState {
    'statusline-hud': {
      view: HudView | null
      ledger: HudLedger
      isHidden: boolean
      turn: HudTurn | null
      /** Alert keys already toasted this session. */
      fired: string[]
    }
  }
}
