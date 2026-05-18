# Skills

A collection of AI agent skills I use daily. Open source, MIT licensed.

## Skills

| Skill | Description |
|-------|-------------|
| [lisa-loop](skills/lisa-loop/) | Timed deep research protocol (LISA: Learn → Inspect → Sift → Answer). Forces LLMs into System 2 thinking with enforced time budgets. |
| [plan-dotnet-app](skills/plan-dotnet-app/) | Generate a build plan for .NET 10 Blazor Web Apps with Blazor Blueprint, EF Core, Playwright testing, and GitHub Actions CI. |

## Install

```bash
# Install a specific skill
npx skills@latest add rquintino/skills --skill lisa-loop
npx skills@latest add rquintino/skills --skill plan-dotnet-app
```

Or copy the relevant `skills/<name>/SKILL.md` into `~/.claude/skills/<name>/`.

Works with Claude Code, Claude.ai, Codex, Cursor, Gemini CLI, and anything that reads SKILL.md.

## License

[MIT](LICENSE)
