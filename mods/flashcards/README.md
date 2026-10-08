# flashcards

A Claude Code **mod**: software development flash cards on a side board, written by the model on demand, with light spaced repetition.

Learn a term or two while Claude works: a one-line counter sits under the prompt band, and one key opens a board of three cards that flip on a press. Grade each card **got it** or **again** and it comes back when it should. Pick any topic (Kubernetes, Rust lifetimes, OAuth…) or stay on general software development.

> Mods are an early-access Claude Code API (function hooks). The API may change between releases.

## Install

At the prompt of a terminal session:

```
/plugin install flashcards --marketplace rquintino/claude-code-xtras
```

Answer `y` to add the marketplace, then pick a scope (user is the usual). Hooks start in that session right away.

To run it from a clone instead, for one session:

```bash
claude --plugin-dir ./mods/flashcards
```

## What you get

### The line under the band

```
📇 cards 2 due · 5/12 learned · Kubernetes  board
```

Due count (highlighted when > 0), cards learned out of the deck, the current topic, and the way to the board (`f`). Before the first deal the button reads **start learning**. It draws under whatever band sits above the prompt (the [statusline-hud](../statusline-hud/) band included), whichever order Claude Code runs the mods in.

### The board

`f` on that line, or `/cards`, opens a side pane:

```
██████████░░░░░░░░░░ 5/12 learned · 2 due
✓ CAP theorem · back in 3d

Topic [ Kubernetes                    ] learn this   general

╭────────────────────────────────────────────╮
│ ▾ Pod disruption budget                    │
│ reliability ●●○○○                          │
│                                            │
│ Caps how many pods of a workload can be    │
│ down at once during voluntary evictions.   │
│ e.g. minAvailable: 2 keeps two replicas up │
│ while a node drains.                       │
│                                            │
│ ✓ got it   ↺ again                         │
╰────────────────────────────────────────────╯
╭────────────────────────────────────────────╮
│ ▸ Readiness probe                          │
│ health checks ○○○○○                        │
╰────────────────────────────────────────────╯
╭────────────────────────────────────────────╮
│ ▸ Taints and tolerations                   │
│ scheduling ●○○○○                           │
╰────────────────────────────────────────────╯

new set   close
```

- **Flip**: press a term (or `1`–`3`) to show its definition and an example. Several cards can be open at once.
- **Grade**: on the back of a card. The header says what happened (`✓ CAP theorem · back in 3d`) and the slot refills.
- **Topic**: type one and **learn this** deals a fresh board on it; **general** goes back to software development at large.
- A card that couldn't be written shows why (`Couldn't write a card: api-error 529 overloaded`) with **try again**.

### Keys

| Key | Where | Does |
| --- | --- | --- |
| `f` | line under the band | open the board |
| `1` `2` `3` | board | flip that card |
| `g` | board | **✓ got it** on the first card turned over |
| `a` | board | **↺ again** on the first card turned over |
| `n` | board | **new set**: three fresh cards |
| `x` | board | close the board |

A keyboard run is `1`, `g`, `2`, `a`, … Focus the band with ctrl+x tab (or a click) to use its hotkey.

### `/cards` command

| Command | Does |
| --- | --- |
| `/cards` | open the board (deals one if it is empty) |
| `/cards <topic>` | open the board on that topic, e.g. `/cards Rust lifetimes` |

## Spaced repetition

Each card has a place on a five-step ladder, shown as mastery dots `●●○○○`.

| Action | Card returns in | Ladder |
| --- | --- | --- |
| **✓ got it** | 1d → 3d → 7d → 21d → 60d | one step up |
| **↺ again** | 10 minutes | back to the bottom |
| never graded | 1 day | unchanged |

- A card counts as **learned** once it has one **got it**.
- To fill a slot, a **due card comes first**, then a new one. With a topic set, only that topic's due cards are dealt; the due count on the line covers the whole deck.
- The deck (last 500 cards) and the topic live in the mod's store, so they survive reloads and new sessions.

## Tokens: only while the board is open

The `model` option (Haiku 5.5 by default) writes cards three per call, and only while the board is open:

- nothing is asked at session start, and the line under the band costs nothing;
- while the board is open, the next batch is written ahead so new cards land at once;
- closing the board (its button or the close mark) cancels a batch still being written, and nothing more is written until it opens again;
- changing topic drops the cards written ahead for the old one.

Each batch is one small request (≤ 1,200 output tokens) on your own account.

## How cards are written

- **General**: each batch asks for one card from each of three different categories, drawn at random from 20 (design patterns, data structures, distributed systems, application security, LLM and AI engineering, observability, …).
- **Topic**: each card covers a different idea within it, with the sub-area as its category.
- The request lists the 60 most recently seen terms, plus those on the board and in the queue, as terms not to use. Duplicates of a term already in the deck are dropped.
- The reply must be a JSON array of `{term, category, definition, example}`; a card missing a field fails its slot with the reason.

The prompts live in [`hooks/cards.ts`](hooks/cards.ts) (`CARD_SYSTEM`, `cardPrompt`, `CATEGORIES`).

## Settings

`/config` (or `/plugin configure flashcards@claude-code-xtras`):

| Option | Values | Default |
| --- | --- | --- |
| `model` | the model that writes the cards | `claude-haiku-5-5` |

## Develop

```bash
claude plugin validate ./mods/flashcards   # what it hooks and calls, what the engine would refuse
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test ./mods/flashcards   # 10 tests: parsing, ladder, prompts, board on terminal and desktop, topics, errors
```

Files: `hooks/cards.ts` (pure helpers: prompts, parsing, ladder, deck), `hooks/register.tsx` (hooks and drawing), `types/index.d.ts` (`$.state` contract), `tests/`.
