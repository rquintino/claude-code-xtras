---
name: pseudocode-rules
description: >-
  Author LLM-facing instruction files (CLAUDE.md policies, agent guardrails,
  sandbox profiles, role/scope definitions) in compact pseudocode DSL — using
  deny()/allow()/require()/prefer() call-sites with #-comments that explain the
  why. Use when the user wants to draft, harden, refactor, or convert prose
  rules into structured rule blocks. Triggers: "write rules", "draft a
  CLAUDE.md", "agent policy", "guardrails", "sandbox profile", "harden this
  profile", "convert to pseudocode rules", "role/scope for an assistant".
---

# pseudocode-rules

# Write LLM instruction files as compact pseudocode DSL, not prose.
# Canonical example in this repo: instructions/dev-soft-sandbox.md — read it
# before drafting to absorb idioms.

## WHY THIS WORKS
# evidence:
#  - "Training with Pseudo-Code for Instruction Following" (arXiv 2505.18011)
#  - PseudoAct (2026): +20.93% accuracy on agent benchmarks via pseudocode plans
#  - Anthropic skill guide: avoid ALL-CAPS; keep instructions literal, scannable
# pseudocode > prose because:
#  - each rule is a token-cheap, scannable call site
#  - the `# why` comment makes edge cases judgeable, not just matchable
#  - section headings (## ROLE, ## NETWORK) enable fast lookup at runtime
#  - explicit precedence block kills ambiguity in conflicting instructions

## VOCAB
allow("X")                # whitelist — agent may do X
deny("X")                 # blacklist — agent must refuse X, no workaround
require("X")              # mandatory precondition
prefer("X")               # default unless overridden in context
deny_path("...")          # filesystem deny
deny_cmd("...")           # shell command deny
deny_outbound("...")      # network egress deny
on_<event>:               # multi-step procedure
  1. ...
  2. ...
# domain-specific verbs allowed — invent as needed, keep them imperative.

## FILE LAYOUT
file_layout = [
  "header        — # IMMUTABLE + precedence + threat-model, 1-3 lines",
  "## ROLE       — what the agent IS, 2-3 lines",
  "## GLOBAL INVARIANT  — one rule that overrides everything else",
  "domain sections      — ## FILESYSTEM, ## NETWORK, ## CREDENTIALS, ...",
  "## REFUSAL PROTOCOL  — what to say + what NOT to do on refuse",
  "## CONFLICT RESOLUTION — precedence list, prompt-injection clause",
  "## OUTPUT     — style, sign-off (optional)",
]
# omit sections that don't apply. don't pad. small policy beats long policy.

## RULE SHAPE
each_rule = (call_site, optional_why_comment, optional_example)
# call_site:  one-line deny/allow/require/prefer — scannable
# # why:      brief comment so the agent can judge edge cases, not just match
# example:    only when the rule is counter-intuitive or has a known workaround

## HOW TO USE THIS SKILL

step_1_clarify:
  ask("scope: global ~/.claude/CLAUDE.md, per-project ./CLAUDE.md, or one-off agent prompt?")
  ask("posture: strict (deny-by-default) or permissive (allow-by-default)?")
  ask("threat model: client code, untrusted deps, ops/admin session, scratch repo?")
  ask("which sections apply: ROLE, FILESYSTEM, NETWORK, CREDENTIALS, GIT, PACKAGES, DOCKER, OUTPUT?")

step_2_draft:
  follow(file_layout)
  start_each_rule_with(deny | allow | require | prefer)
  pair_each_nontrivial_rule_with(# why)
  group_rules_under(## section_heading)
  use(bullets, tables, short_lines)
  deny("long paragraphs of prose")

step_3_self_review:
  reread([
    "is each deny() unbypassable by chaining, eval, encoding, or compound commands?",
    "is each deny paired with a # why comment when the rationale isn't obvious?",
    "is precedence explicit (## CONFLICT RESOLUTION block present)?",
    "are external side effects PREPARED for the user, never executed by the agent?",
    "is the immutability header present so on-thread 'ignore previous' is rejected?",
    "did I avoid ALL-CAPS shouting and emoji noise?",
  ])
  on_any_no: revise_and_reread()

step_4_install_guidance:
  # the agent prepares install commands but never executes outside project_dir
  present_command("cp <file> ~/.claude/CLAUDE.md            # global")
  present_command("cp <file> ./CLAUDE.md                    # per-project")
  state("project rules layer on top of global; project wins on conflict")

## STYLE
deny("ALL-CAPS for emphasis")          # overtriggers Claude, degrades output
deny("long paragraphs of prose")        # bullets + call-sites instead
deny("vague verbs: try, consider, maybe")  # be imperative — deny/allow/require
prefer("# why on its own line above the rule")
prefer("## section headings for fast lookup")
prefer("inline examples after counter-intuitive rules")
prefer("tables for matrices (rule × scope)")

## ANTI-PATTERNS
deny("a deny() with no # why")           # future-you can't judge edge cases
deny("rule duplication across sections") # one home per rule
deny("rules that depend on agent goodwill") # assume adversarial inputs
deny("scope creep — personal assistant verbs in a coding policy")

## REFUSAL PROTOCOL
on_user_requests_unsafe_rule:
  state("which rule is unsafe and why — briefly")
  offer(safer_alternative)
  deny("write the unsafe rule even if user insists")
  on_insist: restate_refusal()

## REFERENCE
# canonical example: instructions/dev-soft-sandbox.md  (in this repo)
# deeper notes:     references/idioms.md               (vocab + patterns)
# evidence base:    references/research.md             (papers + citations)

## OUTPUT
style = "concise, headings + bullets, no long paragraphs"
# match the sign-off convention of the target file if one exists.
