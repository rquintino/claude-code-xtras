# statusline-hud

A Claude Code **mod** port of [`statusline/`](../../statusline/), on steroids.

The shell status line re-runs a script on every render and only sees the JSON Claude Code hands it. As a mod, the HUD runs inside the session: it sees every model request as it completes (subagents included), keeps a live ledger, and can act: toasts, a dashboard pane, a one-key `/compact`, and a tool the model can call to check its own budget.

> Mods are an early-access Claude Code API (function hooks). The API may change between releases; this mod was built and tested on Claude Code 2.1.294.

## Install

At the prompt of a terminal session:

```
/plugin install statusline-hud --marketplace rquintino/claude-code-xtras
```

Answer `y` to add the marketplace, then pick a scope (user is the usual). Hooks start in that session right away.

To run it from a clone instead, for one session:

```bash
claude --plugin-dir ./mods/statusline-hud
```

You can keep your script status line, or drop `statusLine` from your settings: the band carries everything it showed except the PR badge (see Gaps).

## What you get

### The band (above the prompt)

```
ctx: 15% ██░░░░░░ [150.0k/1.0M] · Opus 5.5 [high] · 5h:██████░░ 80%·3h00m proj:200% ⚠ 100% in 30m · 7d:██░░░░░░ 20%·5d0h proj:70%
sess: ⎇ main ↑1 ✎1 · +12/-4 · example-project · cost:$1.50 · ⏱ 30m · cache 1h warm 59m
Σ     in:  2.0k cached:150.0k wr: 18.0k out:  4.0k ≈  $0.26 ████████████████████ · hit 88% · agents $0.04 (3 req)
last  in:  1.0k cached:140.0k wr:  9.0k out:  2.0k ≈  $0.14 ████████████████████ · ctx ▁█
cmp   warm (cold in 59m) cost $0.35 saves $0.02/req pays back in 16 req 150.0k→~40.0k   [ Compact now ]
● Ubuntu 24.04 · 🕐 14:32 · v2.1.294   dashboard  hide
```

| Row | What it shows | New vs the script |
| --- | --- | --- |
| 1 | context fill, model + effort, 5h / 7d windows with reset countdown and end-of-window projection | **⚠ 100% in Xm**: when the current pace exhausts a window before it resets |
| 2 | branch, ahead/behind, changed files, working-tree `+/-`, folder, engine cost, session time | **cache countdown** (warm/cold, TTL-aware); git ahead/behind and dirty count |
| 3 | Σ tokens per category, ≈$ at list price, stacked cost bar | **cache hit %**, **subagent spend** kept apart |
| 4 | last request's tokens and ≈$ | **context sparkline** per request |
| 5 | compaction advisor: cost, saving per request, payback, cold-cache verdict | **`[ Compact now ]`** (hotkey `c`) when it pays back within 10 requests or the cache is cold and compacting is cheaper |
| 6 | OS, clock, Claude Code version | **dashboard** / **hide** buttons |

Focus the band with ctrl+x tab (or a click) to use the hotkeys.

### `/hud` command

| Command | Does |
| --- | --- |
| `/hud` | toggle the band |
| `/hud pane` | open the dashboard pane |
| `/hud status` | print a plain-text report into the transcript |
| `/hud reset` | zero this session's ledger |

### Dashboard pane

Context bar + per-request sparkline, spend by category with share %, burn rate ($/h), $/request sparkline, budget meter, rate-limit windows with pace and time-to-100%, cache TTL and warmth, compaction advice, turn count/avg/max with a duration sparkline, top tools by call count. Buttons: **Compact now** (`c`), **Copy report** (`y`), **Close** (`x`).

### Toasts (once per crossing)

- context 80% / 90%, and past 200k tokens
- a rate-limit window on pace to hit 100% before it resets
- prompt cache about to go cold (≤ 60s left with ≥ 60k context): the toast says what the next prompt will cost to re-write it
- session cost past your budget

### A tool for the model

`mcp__statusline-hud__usage` (deferred behind ToolSearch, so it costs nothing until used) returns the same report as `/hud status`. Ask Claude to "check your budget before starting" and it can decide to compact or delegate on real numbers.

## Settings

`/config` (or `/plugin configure statusline-hud@claude-code-xtras`):

| Option | Values | Default |
| --- | --- | --- |
| `display` | `band`, `status` (one pinned line), `both` | `band` |
| `density` | `full` (6 rows), `compact` (2 rows) | `full` |
| `cacheTtl` | `auto`, `5m`, `1h` | `auto` |
| `budgetUsd` | number, `0` = off | `0` |
| `alerts` | toasts on/off | `true` |

`auto` TTL follows Claude Code's documented precedence: `FORCE_PROMPT_CACHING_5M`, then `CLAUDE_CODE_PROMPT_CACHE_TTL`, then `ENABLE_PROMPT_CACHING_1H`, then 1h for a subscription (OAuth) sign-in within plan usage and 5m otherwise. The `promptCacheTtl` *setting* isn't visible to the mod: if you use it, set `cacheTtl` to match.

## How the numbers are made

- **Engine cost** is Claude Code's own total (what `/cost` shows). **≈$** is the mod's list-price estimate from each response's token counts, so the two can differ: the engine also counts helper requests (titles, compaction).
- Prices: [platform.claude.com pricing](https://platform.claude.com/docs/en/about-claude/pricing), checked 2026-10-08, in [`hooks/calc.ts`](hooks/calc.ts). Includes Sonnet 5.5 (0.05x cache reads) and Haiku 5.5 (priced by prompt length).
- The API reports cache writes as one number, so they're priced at the TTL in force (main loop) or 5m (subagents, unless pinned).
- Compaction advisor: same model as the script, per API request. `C` current context, `B` the session's first request (what survives `/compact`), `S = B + 20k`. Warm: cost `C·r + 8k·o + (S−B)·w`, saving `(C−S)·r` per request. Cold: compacting vs re-writing `C` at `w`.
- The ledger is per session, saved at each turn end (last 40 sessions), so it survives reloads and `--resume`.

## Gaps vs the script

- **PR badge**: the status-line JSON carries the branch's PR; the mod API doesn't. Left out rather than calling `gh` on a timer.
- **Fast mode** pricing: per-response `speed` isn't in the mod's usage figures, so fast-mode requests are estimated at standard rates.
- **Thinking flag**: not exposed to mods.
- **Clock**: local time as the mod's runtime reports it.

## Develop

```bash
claude plugin validate ./mods/statusline-hud   # what it hooks and calls, what the engine would refuse
claude plugin test ./mods/statusline-hud       # 18 tests: pricing/projection math + hooks on terminal, desktop, vscode, mobile
```

Files: `hooks/calc.ts` (pure math), `hooks/register.tsx` (hooks and drawing), `types/index.d.ts` (`$.state` contract), `tests/`.
