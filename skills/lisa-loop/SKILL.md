---
name: lisa-loop
description: Timed deep research protocol that forces LLMs into System 2 thinking. Enforces minimum time budgets via bash timestamps so the AI can't shortcut to shallow first-result answers. Use when the user says "use lisa loop", "use LISA", or requests deep research with a time budget.
---

# LISA Loop — Timed Deep Research Protocol

## What is LISA?

**LISA = Learn, Inspect, Sift, Answer**

A timed research protocol that forces LLMs into System 2 (deliberate, slow) thinking instead of their default System 1 (fast, shallow, first-answer-wins) behavior.

LLMs are naturally lazy — they grab the first plausible answer and stop. The LISA Loop enforces **mandatory due diligence** via a minimum time budget, verified by bash timestamps.

> Think of it like OODA for AI research. OODA has "Orient" as its secret weapon. LISA has "Learn" — forced patience before answering.

---

## The 4 Phases

### L — Learn
- **Cast the wide net.** Understand the landscape before diving in.
- Frame the problem: state the purpose clearly
- Form hypotheses (2-3) that the research will validate or reject
- Start the bash timer: `LISA_START=$(date +%s)`
- Begin broad searches across web, past chats, internal tools (GDrive, calendar, etc.)

### I — Inspect
- **Look closely at the evidence.** Don't skim — dig in.
- Cross-reference multiple sources
- Fetch full articles when snippets are insufficient (use `web_fetch`)
- Check internal tools: past conversations, GDrive documents, calendar context
- Run periodic time-gate checks — DO NOT proceed to synthesis until budget is met

### S — Sift
- **Separate signal from noise.** Gold panning.
- Resolve hypotheses: which were confirmed, partially true, or rejected?
- Identify conflicts between sources
- Rank findings by reliability and relevance
- Discard weak evidence, amplify strong evidence

### A — Answer
- **Only now: synthesize and deliver.**
- Present findings in structured, concise format
- Show hypothesis resolution (what we learned, what surprised us)
- Cite sources where relevant
- Be honest about confidence levels and gaps

---

## Time Gate Protocol (Critical)

The time gate is what makes LISA different from "just searching a lot." It is **non-negotiable.**

### Setup
```bash
LISA_START=$(date +%s)
echo "🔬 LISA LOOP START: $LISA_START ($(date -d @$LISA_START '+%H:%M:%S'))"
echo "BUDGET: ${BUDGET}s (X min strict)"
```

### Periodic Checks (run every 2-4 tool calls)
```bash
LISA_START={timestamp}
ELAPSED=$(($(date +%s) - LISA_START))
BUDGET={seconds}
echo "ELAPSED: ${ELAPSED}s / BUDGET: ${BUDGET}s"
if [ $ELAPSED -ge $BUDGET ]; then
  echo "✅ TIME GATE MET — proceed to synthesis"
else
  echo "⛔ TIME GATE NOT MET — keep researching ($(($BUDGET - $ELAPSED))s remaining)"
fi
```

### Rules
1. **Minimum budgets:** User specifies (e.g., "2 min", "3 min", "5 min")
2. **No wait patterns:** Claude MUST NOT use `sleep` to burn clock. Every second must be spent on actual research/investigation
3. **No premature synthesis:** If time gate is not met, keep searching — find new angles, deeper sources, cross-references
4. **Strict enforcement:** The bash timestamp is the single source of truth — no rounding, no approximation

---

## Budget Guidelines

| Complexity | Suggested Budget | Example |
|-----------|-----------------|---------|
| Quick check | 1 min (60s) | "Is X still the case?" |
| Standard research | 2 min (120s) | "Analyze this draft", "Find options for Y" |
| Deep dive | 3 min (180s) | "Research trends", "Create a comprehensive skill" |
| Thorough investigation | 5 min (300s) | "Full competitive analysis", "Multi-source synthesis" |

The user can override these with explicit budget requests.

---

## Hypotheses Pattern

Always frame research with testable hypotheses. This prevents aimless searching.

```
**Hypotheses:**
- H1: [First plausible explanation]
- H2: [Alternative explanation]
- H3: [Contrarian/unexpected angle]
```

At synthesis, resolve each:
```
**Hypothesis Resolution:**
- H1: CONFIRMED / PARTIALLY TRUE / REJECTED — [evidence]
- H2: ...
- H3: ...
```

---

## Integration with Other Skills

- **Branch-Merge Skill:** Use LISA inside each branch run for independent deep research. Blind isolation still applies — don't peek at other runs.
- **Human Voice Writing Skill:** Use LISA to research voice patterns before writing.
- **Artifact Assembler:** Use LISA for architecture analysis before splitting artifacts.

---

## Anti-Patterns (Don't Do This)

| Anti-Pattern | Why It's Bad |
|-------------|-------------|
| `sleep 120` to burn clock | Zero research value. Wasted budget. Forbidden. |
| Single search → synthesize | System 1 behavior. The whole point is multi-pass depth. |
| Skipping time gate checks | Removes accountability. Always check. |
| Synthesizing before budget met | Premature. Keep digging — you'll find something you missed. |
| Searching the same query twice | Wastes budget. Vary angles, sources, keywords. |
| Reading prior branch runs during LISA | Anchoring bias. Each run must be independent. |

---

## Example Invocation

**User:** "Research X, use lisa loop, 2 minutes minimum"

**Claude:**
1. Log `LISA_START` timestamp
2. State purpose + hypotheses
3. Run 4-8 diverse searches (web, internal tools, past chats)
4. Time-gate check every 2-3 tool calls
5. If gate not met → keep researching new angles
6. Gate met → synthesize with hypothesis resolution
7. Deliver concise, structured answer

---

## Origin

Created by Q. (Rui Quintino) and Vera as part of the Agentia methodology for agentic engineering. Inspired by the observation that LLMs default to shallow, first-result answers when forced research with time budgets consistently produces dramatically better outputs.

The name evolved from "Loop, Investigate, Synthesize, Answer" (which had the ATM Machine problem — "LISA Loop" = "Loop...Loop") to **"Learn, Inspect, Sift, Answer"** — four simple verbs, each mapping to a clear action phase.
