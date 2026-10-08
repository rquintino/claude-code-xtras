# flashcards

A Claude Code mod: software development flash cards on a side board, written by the model on demand, with light spaced repetition.

## Install

```
/plugin install flashcards --marketplace rquintino/claude-code-xtras
```

## What you get

- **A line under the band**: `📇 cards 2 due · 5/12 learned [f] board`. It goes under whatever band mods draw above it (the statusline HUD included), whichever order Claude Code runs them in.
- **A side board** (`f` on that line, or `/cards`): three cards, each in its own frame. Press a term (or `1`–`3`) to flip it to the definition and an example. Several can be open at once.
- **Grading**: **✓ got it** (`g`) climbs the review ladder (back in 1d, 3d, 7d, 21d, 60d), shown as mastery dots `●●○○○`. **↺ again** (`a`) brings the card back in 10 minutes. `g` and `a` grade the first card turned over. A graded card's slot refills, and the header says what happened (`✓ CAP theorem · back in 3d`). Cards you never grade come back tomorrow.
- **Your own topic**: type one in the board's **Topic** field (or `/cards Kubernetes`) and new cards are written about it; due cards from that topic come first. **general** goes back to software development at large. The topic is remembered across sessions.
- **new set** (`n`) deals three fresh cards; **close** (`x`) closes the board.

## Tokens: only while the board is open

The model (`model` option, Haiku 5.5 by default) writes cards three per call, and only while the board is open:

- nothing is asked at session start, and the line under the band costs nothing;
- the next batch is written ahead only while the board is open, so the next cards land at once;
- closing the board (its button or the close mark) cancels a batch still being written.

Each batch is one small request on your own account.

## Settings

| Option | Values | Default |
| --- | --- | --- |
| `model` | the model that writes the cards | `claude-haiku-5-5` |

## Develop

```
claude plugin validate mods/flashcards
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/flashcards
```
