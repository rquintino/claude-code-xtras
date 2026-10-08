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
  /** Wall time of completed main-loop turns, ms (newest last, capped). */
  turnMs: number[]
}

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
}

declare module 'claude-code' {
  interface PluginState {
    'statusline-hud': {
      view: HudView | null
      ledger: HudLedger
      isHidden: boolean
      /** Alert keys already toasted this session. */
      fired: string[]
    }
  }
}
