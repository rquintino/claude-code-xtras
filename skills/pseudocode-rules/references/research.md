# Evidence Base

# Why pseudocode-DSL for LLM instructions outperforms natural-language prose.
# Citations are anchors — verify before quoting in user-facing material.

## PRIMARY CLAIMS

claim_1 = "structured pseudocode boosts instruction following vs prose"
  source = "Mishra et al., 'Prompting with Pseudo-Code Instructions' (arXiv 2305.11790)"
  finding = "pseudo-code prompts beat NL prompts on instruction-tuned models across multiple tasks"

claim_2 = "training on pseudo-code instructions transfers to NL adherence"
  source = "'Training with Pseudo-Code for Instruction Following' (arXiv 2505.18011, 2025)"
  finding = "models fine-tuned on pseudo-code instructions follow NL instructions better at inference"

claim_3 = "pseudocode planning lifts agentic accuracy substantially"
  source = "PseudoAct (2026)"
  finding = "+20.93% accuracy on FEVER/HotpotQA via decoupled pseudocode plan → execution"
  mechanism = "global plan with conditionals/loops/parallel steps, followed step-by-step"

## ANTHROPIC GUIDANCE
source = "Claude API docs: Agent Skills + Skill authoring best practices (2026)"
key_points = [
  "description in YAML frontmatter is THE most important field — drives triggering",
  "progressive disclosure: keep SKILL.md focused, move detail to references/",
  "avoid aggressive ALL-CAPS — overtriggers, degrades output",
  "pair role with clear task instructions",
  "Claude follows instructions literally — be precise, imperative",
]

## DESIGN PRINCIPLES (DERIVED)
principle_1 = "scannable call-sites > paragraphs"
  why = "literal-following models index on syntactic structure"

principle_2 = "# why comments enable edge-case judgment"
  why = "rules without rationale collapse to pattern-matching; comments add reasoning"

principle_3 = "explicit precedence kills prompt injection"
  why = "if tool/file content is lowest precedence by construction, injected instructions lose"

principle_4 = "negative space (not_a, deny()) is as load-bearing as positive (allow())"
  why = "models drift toward 'helpful' behavior unless explicitly bounded"

## OPEN QUESTIONS
# none of these are settled — flag in policy when relevant:
# - exact token-cost tradeoff of pseudocode vs prose at large scale
# - whether smaller models follow pseudocode as faithfully as frontier models
# - long-context (>100K) attention to deeply nested rule blocks
