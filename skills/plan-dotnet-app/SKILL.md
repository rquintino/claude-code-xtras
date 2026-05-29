---
name: plan-dotnet-app
version: 1.3.0
updated: 2026-05-18
description: >-
  Generate a self-contained build plan (≤28K chars) for a .NET 10 Blazor Web App
  with Blazor Blueprint (shadcn/ui), EF Core, Playwright testing, and GitHub
  Actions CI. Plan must fit within GitHub Copilot coding agent's 30K char prompt
  limit. Use when asked to scaffold, plan, or create a new .NET application,
  Blazor app, or web API project. Invoked via /plan-dotnet-app or auto-matched.
release_notes: >-
  v1.3.0 (2026-05-18):
  - Plan persistence first: persist full plan to tasks/current/{app-slug}/plan.md
    as the very first orchestrator action. Single source of truth for checkpoints.
  - Structured TOC with anchor links at top of generated plan.
  - HTML comment section markers (<!-- §phase-N -->) enable precise extraction
    via sed. Checkpoint eval uses concrete bash commands, not vague re-reads.
  - progress.md updated at each phase with structured checkpoint log entries.
  v1.2.1 (2026-05-18):
  - On invocation, outputs skill name + version for confirmation.
  v1.2.0 (2026-05-18):
  - Traceability: version flows into plan header, README footer, PR description.
  Prior: v1.1.1 (screenshots in README), v1.1.0 (Blazor Blueprint), v1.0.0 (initial).
---

# .NET 10 App Build Plan Generator

Generate a single, self-contained build plan document that a coding agent
can execute later without internet access. You do NOT execute the plan.
**Output must be ≤ 28,000 characters** (Copilot coding agent hard limit is 30K).

**On invocation**: immediately output a one-liner before anything else:
`📋 plan-dotnet-app v{version} ({updated})`
so the user can confirm they're running the latest skill version.

## Phase 0 — Elicit Requirements

Ask ONE AT A TIME using ask-user-input options. Always include "Other".

**Q1 — App idea** (offer starters if unsure):
- BookShelf — book library: Book, Author, Genre, Review (4 pages)
- BugHive — issue tracker: Project, Issue, Label, Comment (5 pages)
- MealBoard — meal planner: Recipe, Ingredient, Category, MealPlan (4 pages)
- ExpenseLog — expense tracker: Expense, Category, Budget, PaymentMethod (4p + dashboard)
- TeamPulse — standup tracker: Team, Member, StandupEntry, MoodEntry (4 pages)

**Q2 — Entities**: confirm starter defaults or custom (3-5 entities)
**Q3 — Auth**: None / ASP.NET Identity / JWT / OAuth / Other
**Q4 — Pages**: confirm starter defaults or custom
**Q5 — Extras**: None / File uploads / External API / Notifications / Other
**Q6 — Plan folder**: default `docs/`

## Phase 1 — Research Best Practices

Web-search (2025-2026, official sources) for:
- .NET 10 Blazor Web App render modes and project structure
- EF Core + SQLite patterns
- Blazor Blueprint (blazorblueprintui.com) — shadcn/ui component library for Blazor, installation, theming
- Playwright .NET E2E with WebApplicationFactory
- playwright-cli for agent-driven visual testing
- copilot-setup-steps.yml for GitHub coding agent
- npm `min-release-age`, NuGet audit

2-3 sentences + source URL per finding. Embed in plan's Reference section.

## Phase 2 — Generate the Plan

Save to: `{plan-folder}/{app-slug}-build-plan-{YYYYMMDD}.md`

**Critical**: FULLY EXPAND every `{placeholder}` and `{EXPAND: ...}` marker
with actual content from Phase 0 and Phase 1. No placeholders may remain.
The plan must be immediately executable with zero interpretation.
Replace `{version}` with this skill's actual version from the frontmatter above.

**Sub-agent preamble**: Every phase section that starts with "Sub-agent instructions:"
MUST begin with this exact block (sub-agents are isolated — they cannot see
the Execution Model rules, so this is the only way to enforce constraints):

```
⚠️ RULES — read before doing anything:
1. Do NOT run `git push`. It will fail. Only `git add` + `git commit`.
2. After finishing, run `dotnet build` to verify. Report pass/fail.
```

**HARD LIMIT — 28,000 characters max.** GitHub Copilot coding agent truncates
prompts at 30,000 chars (see [community discussion #182719](https://github.com/orgs/community/discussions/182719)).
Use 28K as ceiling for safety margin. To stay under budget:
- Reference section: 2-3 sentences per topic, no full quotes
- Inline code: show structure/signatures, not full implementations
- Seed data: compact table, max 5 representative rows (agent can extrapolate)
- Phases 7-8 (Customization + Demo): concise bullet instructions, no templates
- Measure with: `wc -c plan.md` (bytes ≈ chars for ASCII/UTF-8 English)

After generating, ask: "Ready, or want changes?"

Once approved, guide the user:
1. Create a new blank GitHub repository
2. Commit the build plan to the repo
3. Open a GitHub Copilot cloud agent request
4. Prompt: *"Follow the build plan in `{path}`. Use the orchestrator/sub-agent
   pattern described in the plan's Execution Model."*

---

# ══════════════════════════════════════════════════
# BUILD PLAN TEMPLATE — output below as the plan
# ══════════════════════════════════════════════════

# {App Name} — Build Plan

> Generated: {YYYY-MM-DD}
> Stack: .NET 10 · Blazor Web App · Blazor Blueprint (shadcn/ui) · EF Core + SQLite · Playwright · GitHub Actions
> Skill: `plan-dotnet-app` v{version} — https://github.com/rquintino/claude-code-config
>
> **Self-contained.** Execute with a coding agent using orchestrator/sub-agent
> pattern. No internet access required.

---

## Table of Contents

> **Navigation index** — each section is self-contained. Re-read individual
> sections during checkpoint evaluation without loading the full document.

- [Execution Model](#execution-model) — orchestrator rules, sub-agent preamble, git push ban
- [Reference — Best Practices](#reference--best-practices) — research findings with source URLs
- [Solution Overview](#solution-overview) — projects, namespaces, TFM
- [Entity Model](#entity-model) — entities, properties, seed data
- [Page Inventory](#page-inventory) — routes, render modes, navigation
- [Gotchas](#-gotchas-read-before-delegating) — critical pitfalls to avoid
- [Phase 1: Environment Setup](#phase-1-environment-setup) — runtimes, supply chain, copilot-setup-steps
- [Phase 2: Solution Scaffold](#phase-2-solution-scaffold) — projects, Blazor Blueprint setup
- [Phase 3: Data Layer](#phase-3-data-layer) — EF Core, migrations, seed data
- [Phase 4: UI Layer](#phase-4-ui-layer) — Blazor pages, Blazor Blueprint components
- [Phase 5: Testing + Screenshots](#phase-5-testing--screenshots) — unit, E2E, screenshots
- [Phase 6: CI Workflow](#phase-6-ci-workflow) — GitHub Actions
- [Phase 7: Customization Layer](#phase-7-customization-layer) — AGENTS.md, README, instructions
- [Phase 8: Demo Video](#phase-8-demo-video) — Playwright video recording
- [Final Verification & Archive](#final-verification--archive) — verify, PR body, archive

---

## Execution Model

**You are the orchestrator.** Delegate each phase to a sub-agent via the
`agent` tool. Sub-agents run in isolated context — pass ALL needed context
inline (they can't see your conversation or each other's work).

Rules:
- **Plan is source of truth**: the persisted plan at `tasks/current/{app-slug}/plan.md`
  is the single source of truth for all checkpoint evaluations.
- **Section markers**: each phase is delimited by `<!-- §phase-N -->` HTML
  comments. Extract a specific section with:
  `sed -n '/<!-- §phase-N -->/,/<!-- §phase-/p' tasks/current/{app-slug}/plan.md`
- **Sequential**: complete each phase before starting the next
- **Checkpoint eval**: after each phase, (1) verify `dotnet build` (and `dotnet test`
  from Phase 5 onward), (2) extract + re-read the phase section via `sed`,
  (3) verify all requirements met, (4) update `progress.md` with status,
  timestamp, and any deviations
- **Retries**: on failure, spawn a new sub-agent with error context. Max 2.
- Sub-agents may read `tasks/current/{app-slug}/` files as reference only.

### 🚫 GIT PUSH BAN — CRITICAL

**`git push` is FORBIDDEN and WILL FAIL.** The cloud agent infrastructure
handles pushing after all work is complete. Only use `git add` and `git commit`.

**Every sub-agent delegation MUST start with this preamble** (copy-paste it
as the first lines of every sub-agent prompt — sub-agents cannot see these
top-level rules, they only see what you pass them):

```
⚠️ RULES — read before doing anything:
1. Do NOT run `git push`. It will fail. Only `git add` + `git commit`.
2. After finishing, run `dotnet build` to verify. Report pass/fail.
```

### Before Phase 1 — Plan Persistence (orchestrator direct, FIRST ACTION)

**This is the very first thing you do.** Before any code, any setup, any
sub-agent — persist the plan. This is critical for checkpoint evaluation
and session recovery.

```bash
mkdir -p tasks/current/{app-slug}
```

1. Copy this entire plan verbatim into `tasks/current/{app-slug}/plan.md`
2. Create `tasks/current/{app-slug}/progress.md` with this structure:

```markdown
# {App Name} — Progress

> Plan: `tasks/current/{app-slug}/plan.md`
> Started: {YYYY-MM-DD HH:MM UTC}

| Phase | Status | Completed | Notes |
|-------|--------|-----------|-------|
| 1 Environment Setup | ⏳ Pending | | |
| 2 Solution Scaffold | ⏳ Pending | | |
| 3 Data Layer | ⏳ Pending | | |
| 4 UI Layer | ⏳ Pending | | |
| 5 Testing + Screenshots | ⏳ Pending | | |
| 6 CI Workflow | ⏳ Pending | | |
| 7 Customization Layer | ⏳ Pending | | |
| 8 Demo Video | ⏳ Pending | | |
| Final Verification | ⏳ Pending | | |

## Checkpoint Log
<!-- Append entries after each phase completion -->
```

3. `git add tasks/ && git commit -m "chore: persist build plan and progress tracker"`

**After every phase**: update the relevant row in `progress.md` table
(⏳→✅ or ❌), add timestamp, and append a checkpoint log entry:
```markdown
### [Phase X] {title} — ✅ {YYYY-MM-DD HH:MM}
- **Plan requirements**: all met / {list deviations}
- **Build**: pass/fail
- **Tests**: N/A or pass (X passed, Y failed)
- **Notes**: {any issues, workarounds, or suggestions for plan improvement}
```

---

## Reference — Best Practices

{EXPAND: embed ALL research findings, organized by topic, each with source URL.
Must include: Blazor Blueprint installation + component API + theming (from blazorblueprintui.com/docs/installation)}

---

## Solution Overview

- **Name**: {SolutionName} · **Namespace**: {RootNamespace} · **TFM**: net10.0

| Project | Path |
|---|---|
| {Name}.Web (Blazor) | `src/{Name}.Web/` |
| {Name}.Core (lib) | `src/{Name}.Core/` |
| {Name}.UnitTests | `tests/{Name}.UnitTests/` |
| {Name}.E2ETests | `tests/{Name}.E2ETests/` |

## Entity Model

{EXPAND: full entity table with properties, types, constraints, FK
relationships, and 10-20 realistic seed records per entity. Seed data
is mandatory — the app must launch demo-ready.}

## Page Inventory

{EXPAND: table with route, render mode, description per page. Navigation structure.}

## Auth: {EXPAND: "None" or detailed approach}

---

## ⚠️ Gotchas (read before delegating)

1. **🚫 `git push` is FORBIDDEN** — it will fail. Only `git add` + `git commit`. Infrastructure handles push.
2. **`dotnet new sln`** creates `.slnx` by default in .NET 10. No `dotnet new slnx` template exists. Use `dotnet sln add` not `dotnet slnx add`.
2. **`dotnet-ef` must be installed**: `dotnet tool install --global dotnet-ef` — NOT in the SDK.
3. **Three Playwright packages** — don't confuse them:
   - `@playwright/cli` (npm): agent-driven browser automation, screenshots
   - `Microsoft.Playwright` (NuGet): .NET E2E test framework
   - `playwright` (npm): full API for demo video script
4. **Port 5177**: use `--urls http://localhost:5177` (5000 often blocked). Health-check loop:
   `until curl -sf http://localhost:5177 > /dev/null 2>&1; do sleep 1; done`
5. **npm `min-release-age`** may block fresh packages. Override: `npm install -g @playwright/cli@latest --minimum-release-age=0`
6. **Blazor Blueprint** — ships pre-built CSS (`blazorblueprint.css`), no Tailwind build step needed. Remove all Bootstrap CSS/JS from the Blazor template. Add `<BbPortalHost />` to root layout or portaled components (Dialog, Popover, Select) won't render. Theme CSS variables use OKLCH color space — get the default theme from the installation docs.

---

<!-- §phase-1 -->
## Phase 1: Environment Setup

**Sub-agent instructions:**

Set up dev environment for {SolutionName} (.NET 10 + Playwright).

**Supply chain hardening (first):**
- `.npmrc`: `min-release-age=15`
- `Directory.Build.props`: NuGetAudit true, NuGetAuditMode all, NuGetAuditLevel low, RestorePackagesWithLockFile true
- `.github/dependabot.yml`: 15-day cooldown for nuget + npm

**Runtimes:**
```bash
dotnet tool install --global dotnet-ef
npm install -g @playwright/cli@latest --minimum-release-age=0
playwright-cli install && playwright-cli install --skills
playwright install --with-deps chromium
```

**`copilot-setup-steps.yml`** at `.github/workflows/` — job `copilot-setup-steps`,
runner `ubuntu-latest`. Steps: checkout, setup-dotnet 10.x, setup-node 22,
install dotnet-ef, install playwright-cli + skills, install browsers,
install Blazor Blueprint MCP (`npx @blazorblueprint/mcp@latest`),
restore + build, verify versions.

**`scripts/setup-dev.sh`** — same setup for humans. `chmod +x`.

**Checkpoint**: dotnet 10.x ✓, dotnet-ef ✓, playwright-cli ✓,
copilot-setup-steps.yml ✓, .npmrc ✓, Directory.Build.props ✓
**Plan eval**: extract + verify this phase, then update `progress.md`:
```bash
sed -n '/<!-- §phase-1 -->/,/<!-- §phase-2 -->/p' tasks/current/{app-slug}/plan.md
```

---

<!-- §phase-2 -->
## Phase 2: Solution Scaffold

**Sub-agent instructions:**

{EXPAND: paste Solution Overview here}

```bash
dotnet new sln -n {SolutionName}
dotnet new blazor -n {Name}.Web -o src/{Name}.Web --interactivity Auto --empty
dotnet new classlib -n {Name}.Core -o src/{Name}.Core
dotnet new xunit -n {Name}.UnitTests -o tests/{Name}.UnitTests
dotnet new xunit -n {Name}.E2ETests -o tests/{Name}.E2ETests
dotnet sln add src/{Name}.Web src/{Name}.Core tests/{Name}.UnitTests tests/{Name}.E2ETests
dotnet add src/{Name}.Web reference src/{Name}.Core
dotnet add tests/{Name}.UnitTests reference src/{Name}.Core
dotnet add tests/{Name}.E2ETests reference src/{Name}.Web
dotnet add src/{Name}.Core package Microsoft.EntityFrameworkCore.Sqlite
dotnet add src/{Name}.Core package Microsoft.EntityFrameworkCore.Design
dotnet add src/{Name}.Web package BlazorBlueprint.Components
dotnet add src/{Name}.Web package BlazorBlueprint.Icons.Lucide
dotnet add tests/{Name}.E2ETests package Microsoft.Playwright
dotnet add tests/{Name}.E2ETests package Microsoft.Playwright.Xunit
```

**Blazor Blueprint setup** (in `src/{Name}.Web/`):
1. `Program.cs`: add `builder.Services.AddBlazorBlueprintComponents();`
2. `_Imports.razor`: add `@using BlazorBlueprint.Components` and `@using BlazorBlueprint.Icons.Lucide.Components`
3. `App.razor` `<head>`: add theme CSS + pre-built styles:
   ```html
   <link href="css/theme.css" rel="stylesheet" />
   <link href="_content/BlazorBlueprint.Components/blazorblueprint.css" rel="stylesheet" />
   ```
4. Create `wwwroot/css/theme.css` with shadcn/ui default theme (CSS variables for `--background`, `--foreground`, `--primary`, etc. in OKLCH color space, plus `.dark` variant). Use the default theme from https://blazorblueprintui.com/docs/installation
5. Root layout: add `<BbPortalHost />` and `<BbToastProvider />` after `@Body`
6. **Remove all Bootstrap CSS/JS** references from the template — Blazor Blueprint replaces Bootstrap entirely.

Create `global.json` (version 10.0.100, rollForward latestFeature), `.gitignore`.
Create dirs: `docs/screenshots/`, `docs/demo/`, `scripts/`, `.github/agents/`,
`.github/hooks/scripts/`, `.github/instructions/`, `.github/skills/playwright-e2e/`, `tasks/`.

No business logic. net10.0, nullable, implicit usings, file-scoped namespaces.

**Checkpoint**: `dotnet build` passes, 4 projects in solution, Blazor Blueprint renders.
**Plan eval**: extract + verify this phase, then update `progress.md`:
```bash
sed -n '/<!-- §phase-2 -->/,/<!-- §phase-3 -->/p' tasks/current/{app-slug}/plan.md
```

---

<!-- §phase-3 -->
## Phase 3: Data Layer

**Sub-agent instructions:**

{EXPAND: paste Entity Model with all seed data}

1. Entities in `src/{Name}.Core/Entities/` — {EXPAND: exact properties per entity}
2. `AppDbContext` in `src/{Name}.Core/Data/` — DbSets, OnModelCreating, **HasData() seed** (mandatory)
3. SQLite config in `Program.cs` + connection string in `appsettings.json`: `Data Source=app.db`
4. `dotnet ef migrations add InitialCreate --project src/{Name}.Core --startup-project src/{Name}.Web`
5. Auto-migrate in `Program.cs`: `db.Database.Migrate()`
6. Service interfaces + implementations in `src/{Name}.Core/Services/` — {EXPAND: methods}
7. Register services in `Program.cs`
8. `dotnet build`

SQLite only, async everywhere, constructor injection, POCOs.

**Checkpoint**: `dotnet build` passes, migration includes seed data.
**Plan eval**: extract + verify this phase, then update `progress.md`:
```bash
sed -n '/<!-- §phase-3 -->/,/<!-- §phase-4 -->/p' tasks/current/{app-slug}/plan.md
```

---

<!-- §phase-4 -->
## Phase 4: UI Layer

**Sub-agent instructions:**

{EXPAND: paste Page Inventory, Entity Model, service interfaces}

Build all Blazor pages per inventory using **Blazor Blueprint components**
(shadcn/ui design). InteractiveServer for forms/interaction, static SSR for
read-only. Use Blazor Blueprint form components (`BbFormFieldInput`,
`BbFormFieldTextarea`, `BbButton`, etc.) inside `EditForm` +
DataAnnotationsValidator. Use `BbCard`, `BbDataTable`, `BbBadge`, `BbAlert`,
`BbDialog` (for delete confirmation), etc. for layout and presentation.
Lucide icons via `<LucideIcon Name="..." />`. No Bootstrap classes anywhere.

For component API reference, read `https://blazorblueprintui.com/llms.txt`
or check the MCP server (`npx @blazorblueprint/mcp@latest`).

{EXPAND: exact pages, routes, data loading, service methods, form fields, validation}

**Checkpoint**: `dotnet build` passes, all pages at correct routes, modern shadcn/ui look.
**Plan eval**: extract + verify this phase, then update `progress.md`:
```bash
sed -n '/<!-- §phase-4 -->/,/<!-- §phase-5 -->/p' tasks/current/{app-slug}/plan.md
```

---

<!-- §phase-5 -->
## Phase 5: Testing + Screenshots

**Sub-agent instructions:**

{EXPAND: paste Entity Model, service interfaces, Page Inventory}

### Unit tests (`tests/{Name}.UnitTests/`)
In-memory SQLite (`SqliteConnection("DataSource=:memory:")`). CRUD + edge cases.
{EXPAND: specific test cases per service}

### E2E tests (`tests/{Name}.E2ETests/`)
Base class: `WebApplicationFactory<Program>` + Playwright. Get server URL from
factory, launch browser, navigate and assert. Proper async disposal.
{EXPAND: E2E scenarios per page/flow}

### Screenshots
```bash
dotnet run --project src/{Name}.Web --urls "http://localhost:5177" &
until curl -sf http://localhost:5177 > /dev/null 2>&1; do sleep 1; done
playwright-cli open http://localhost:5177
playwright-cli screenshot docs/screenshots/home.png --full-page
```
{EXPAND: screenshot per page}
Kill app when done.

**Commit all screenshots:**
```bash
git add docs/screenshots/
git commit -m "chore: add page screenshots"
```

**Checkpoint**: all tests pass, screenshots committed in `docs/screenshots/`.
**Plan eval**: extract + verify this phase, then update `progress.md`:
```bash
sed -n '/<!-- §phase-5 -->/,/<!-- §phase-6 -->/p' tasks/current/{app-slug}/plan.md
```

---

<!-- §phase-6 -->
## Phase 6: CI Workflow

**Sub-agent instructions:**

Create `.github/workflows/ci.yml`: PR + push to main. Steps: checkout,
setup-dotnet 10.x, setup-node 22, install dotnet-ef, restore, build Release,
unit tests, install Playwright browsers + CLI, E2E tests, upload screenshots
artifact (if: always, 7-day retention). Use actual solution name.

**Checkpoint**: YAML valid, `dotnet test` passes.
**Plan eval**: extract + verify this phase, then update `progress.md`:
```bash
sed -n '/<!-- §phase-6 -->/,/<!-- §phase-7 -->/p' tasks/current/{app-slug}/plan.md
```

---

<!-- §phase-7 -->
## Phase 7: Customization Layer

**Sub-agent instructions:**

Read the ACTUAL codebase. All content must reference real paths/entities.

1. **`AGENTS.md`** (root) — structure, conventions, commands, seed data, task workflow
2. **`README.md`** — title, badges, architecture, quick start, commands. Include a **Screenshots** section with markdown images for each page (`![Home](docs/screenshots/home.png)`, etc.) so the repo landing page shows the app visually. Add a footer line: `> Scaffolded by [plan-dotnet-app](https://github.com/rquintino/claude-code-config/blob/main/skills/plan-dotnet-app/SKILL.md) v{version}`
3. **`.github/instructions/blazor.instructions.md`** (applyTo: `**/*.razor`) — use Blazor Blueprint components (BbButton, BbCard, BbFormFieldInput, BbDataTable, etc.), no Bootstrap, no raw HTML where a component exists. Reference: https://blazorblueprintui.com/llms.txt
4. **`.github/instructions/efcore.instructions.md`** (applyTo: `**/Data/**,**/Entities/**`)
5. **`.github/instructions/playwright-tests.instructions.md`** (applyTo: `**/E2ETests/**`)
6. **`.github/skills/playwright-e2e/SKILL.md`** — project-specific patterns
7. **`.github/hooks/format-on-edit.json`** — postToolUse: `dotnet format --verbosity quiet` on .cs edits + script at `.github/hooks/scripts/format-csharp.sh` (chmod +x)
8. **`.github/agents/dev.agent.md`** + **`test.agent.md`**

**Checkpoint**: all files reference real paths, `dotnet test` passes.
**Plan eval**: extract + verify this phase, then update `progress.md`:
```bash
sed -n '/<!-- §phase-7 -->/,/<!-- §phase-8 -->/p' tasks/current/{app-slug}/plan.md
```

---

<!-- §phase-8 -->
## Phase 8: Demo Video

**Sub-agent instructions:**

Create `scripts/record-demo.mjs` using Playwright `recordVideo` API:
1. `npm install playwright` (full package, not @playwright/cli)
2. Start app on port 5177, health-check wait
3. Launch chromium with `recordVideo: { dir: 'docs/demo/', size: {width:1280,height:720} }`
4. Navigate ALL pages from inventory using seed data
5. Inject DOM callout banner (fixed div, dark bg, white text, centered top) before each action, clear after 2s
6. Title: "🚀 {App Name} — Demo" / closing: "✅ Built with GitHub Copilot"
7. Close page/context/browser (saves video), kill app
8. Rename UUID .webm → `docs/demo/{app-slug}-demo.webm`

Target: 30-60s, 1280×720.

**Commit demo video:**
```bash
git add docs/demo/
git commit -m "chore: add demo video"
```

**Checkpoint**: video exists, shows all pages, `dotnet test` passes.
**Plan eval**: extract + verify this phase, then update `progress.md`:
```bash
sed -n '/<!-- §phase-8 -->/,/<!-- §final -->/p' tasks/current/{app-slug}/plan.md
```

---

<!-- §final -->
## Final Verification & Archive

Orchestrator direct:

**Verify**: `dotnet build` ✓ · `dotnet test` all pass ✓ · screenshots ✓ ·
demo video ✓ · copilot-setup-steps.yml ✓ · ci.yml ✓ · AGENTS.md accurate ✓

**Review customization**: re-read `.github/agents/`, `.github/instructions/`,
`.github/skills/`, `AGENTS.md`. Fix any stale references via sub-agent.

**Update PR description with screenshots**: generate a rich PR body and apply it.
Create `docs/PR_BODY.md` with this structure, then update the PR:
```markdown
## {App Name}

> {One-line description}

### Screenshots

| Page | Preview |
|---|---|
| Home | ![Home](docs/screenshots/home.png) |
| {Page2} | ![{Page2}](docs/screenshots/{page2}.png) |
{EXPAND: one row per screenshot}

### What's included
- ✅ .NET 10 Blazor Web App with Blazor Blueprint (shadcn/ui)
- ✅ EF Core + SQLite with seed data
- ✅ {Auth type}
- ✅ Unit tests + Playwright E2E tests
- ✅ GitHub Actions CI
- ✅ Demo video: `docs/demo/{app-slug}-demo.webm`

### How to run
```
dotnet run --project src/{Name}.Web
```

> Scaffolded by `plan-dotnet-app` v{version}
```

Apply to PR:
```bash
# Get current PR number
PR_NUMBER=$(gh pr list --head "$(git branch --show-current)" --json number -q '.[0].number')
if [ -n "$PR_NUMBER" ]; then
  gh pr edit "$PR_NUMBER" --body-file docs/PR_BODY.md
fi
git add docs/PR_BODY.md
git commit -m "docs: add PR description with screenshots"
```

**Self-improvement**: review all sub-agent logs, record in `progress.md`:
`### [Phase X] {title}` — Problem / Root cause / Suggestion

**Final plan eval**: full end-to-end verification against the persisted plan:
```bash
cat tasks/current/{app-slug}/plan.md
```
Walk every phase's requirements. Verify each was met. Update `progress.md`
Final Verification row to ✅ with timestamp.

**Archive**:
```bash
mkdir -p tasks/done/{app-slug}-{YYYYMMDD}
mv tasks/current/{app-slug}/* tasks/done/{app-slug}-{YYYYMMDD}/
rmdir tasks/current/{app-slug}
rmdir tasks/current 2>/dev/null || true
```

Final `progress.md`: status ✅, test counts, screenshots, video, timestamp.

---

## Time Budget

| Phase | Est. |
|---|---|
| 1 Env Setup | ~5m |
| 2 Scaffold | ~8m |
| 3 Data | ~10m |
| 4 UI | ~15m |
| 5 Testing | ~12m |
| 6 CI | ~3m |
| 7 Customization | ~5m |
| 8 Demo Video | ~5m |
| Final | ~5m |
| **Total** | **~68m** |
