# Skills

A collection of AI agent skills I use daily. Open source, MIT licensed.

## LISA Loop

**Learn → Inspect → Sift → Answer** — a timed research protocol that forces AI agents into deliberate thinking instead of shallow first-result answers.

LLMs default to grabbing the first plausible answer and stopping. LISA enforces a minimum time budget (verified via bash timestamps) so the agent actually has to research before it responds.

**What it does:**
- Sets a time floor — the agent can't answer before the budget runs out
- Forces multiple search passes and hypothesis formation
- Requires source citations with exact quotes and URLs
- Catches shortcuts and surface-level synthesis

**Install:**

```bash
npx skills@latest add rquintino/skills --skill lisa-loop
```

Or just copy `skills/lisa-loop/SKILL.md` into `~/.claude/skills/lisa-loop/`.

Works with Claude Code, Claude.ai, Codex, Cursor, Gemini CLI, and anything that reads SKILL.md.

## License

[MIT](LICENSE)
