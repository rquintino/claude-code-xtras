---
name: pseudocode-rules
description: >-
  Write LLM-facing instruction files as compact pseudocode DSL —
  deny()/allow()/require()/prefer() call-sites with #-comments that explain
  the why — instead of prose. Token-efficient form with equal or better
  adherence. Topic-agnostic: applies to instructions for any LLM (customer
  support, code review, HR screening, content style, research, education,
  whatever). Use ONLY when the user explicitly names the pseudocode form or
  its mechanics: "convert prose rules to pseudocode DSL", "rewrite as
  deny/allow call-sites", "compact rule format with # why comments", "use
  the pseudocode-rules pattern", "imperative deny/allow instead of prose",
  "scannable call-site style for our system prompt". Do NOT trigger on
  generic requests for guardrails, policies, sandbox profiles, or CLAUDE.md
  authoring that don't name the form.
---

# pseudocode-rules

# A writing technique. Take any LLM-facing instruction file — system prompt,
# behavior spec, role/scope definition, content guidelines, agent policy —
# and express it as compact pseudocode call-sites instead of prose. Topic-
# agnostic: works for customer support, code review, HR screening, content
# style, research, education, anything. The technique is the value, not the
# topic.

## WHAT THIS BUYS YOU
# - shorter prompts (fewer tokens per rule than equivalent prose)
# - equal or better adherence under evaluation
# - scannable by humans editing the file
# - each rule has an addressable shape (one call-site) so edits don't drift
# - # why comments let the model judge edge cases instead of pattern-matching

## EVIDENCE
# - "Training with Pseudo-Code for Instruction Following" (arXiv 2505.18011)
# - PseudoAct (2026): +20.93% accuracy on agent benchmarks via pseudocode plans
# - Anthropic skill guide: avoid ALL-CAPS; keep instructions literal, scannable

## WHEN THIS SKILL APPLIES
# Trigger ONLY when the user names the pseudocode form or its mechanics:
#  - "rewrite as deny/allow call-sites"
#  - "convert this prose system prompt to pseudocode DSL"
#  - "use the pseudocode-rules pattern for our agent's instructions"
#  - "compact rule format with # why comments"
#  - "imperative deny/allow instead of paragraphs"
#  - "scannable call-site style for the behavior file"
# Do NOT trigger when the user just wants a system prompt / guardrails /
# CLAUDE.md / sandbox profile written in any form. The skill is about the
# *form*, not the topic.

## VOCAB
allow("X")                # the LLM may do X
deny("X")                 # the LLM must refuse X — no workaround
require("X")              # mandatory precondition before doing X
prefer("X")               # default behavior unless overridden in context
on_<event>:               # multi-step procedure triggered by <event>
  1. ...
  2. ...
# Topic-specific verbs are encouraged — invent them, keep them imperative.
# Examples by topic:
#   deny_topic("competitor pricing")          # content/marketing assistant
#   require_consent("share PII")              # data-privacy assistant
#   deny_action("auto-merge PR")              # code-review agent
#   refuse_if("candidate name reveals gender") # HR-screening assistant
#   prefer_citation("primary sources")        # research agent

## FILE LAYOUT
file_layout = [
  "header        — # purpose + precedence + (optional) immutability, 1-3 lines",
  "## ROLE       — what the LLM IS in this context, 2-3 lines",
  "## GLOBAL INVARIANT  — the one rule that overrides everything else",
  "domain sections      — group rules by topic (## TONE, ## SCOPE, ## DATA, ...)",
  "## REFUSAL PROTOCOL  — what to say + what NOT to do when refusing",
  "## CONFLICT RESOLUTION — precedence list, prompt-injection clause",
  "## OUTPUT     — style, format, sign-off (optional)",
]
# Omit sections that don't apply. Don't pad. Short file beats long file.

## RULE SHAPE
each_rule = (call_site, optional_why_comment, optional_example)
# call_site:  one-line deny/allow/require/prefer — scannable
# # why:      brief comment so the LLM can judge edge cases, not just match
# example:    only when the rule is counter-intuitive or has a known workaround

## HOW TO USE THIS SKILL

step_1_clarify:
  ask("scope: a system prompt, a CLAUDE.md, an agent role file, a content guideline?")
  ask("topic: what's this LLM for? (support, code, content, research, ...)")
  ask("posture: deny-by-default or allow-by-default for this domain?")
  ask("source: drafting from scratch, or converting an existing prose version?")
  ask("which sections apply? (let the topic drive — don't force ROLE/NETWORK/etc.)")

step_2_draft:
  follow(file_layout)
  start_each_rule_with(deny | allow | require | prefer | topic_specific_verb)
  pair_each_nontrivial_rule_with(# why)
  group_rules_under(## section_heading)
  use(bullets, tables, short_lines)
  deny("long paragraphs of prose")

step_3_self_review:
  reread([
    "is each rule one scannable line + (optional) one-line # why?",
    "is the rationale obvious from the comment, or does it still need it?",
    "are section headings present so a future editor can find anything in <5s?",
    "does this read shorter than the prose version while saying the same thing?",
    "did I avoid ALL-CAPS shouting and emoji noise?",
    "is precedence/immutability declared if on-thread overrides are a concern?",
  ])
  on_any_no: revise_and_reread()

step_4_deliver:
  # Hand the file back to the user. If the user authored a prose source,
  # surface a side-by-side token-count delta when possible — that's the
  # technique's whole point.
  optionally_report("before: ~Xk tokens; after: ~Yk tokens; rules: N")

## STYLE
deny("ALL-CAPS for emphasis")          # overtriggers Claude, degrades output
deny("long paragraphs of prose")        # call-sites + bullets instead
deny("vague verbs: try, consider, maybe")  # be imperative — deny/allow/require
prefer("# why on its own line above the rule")
prefer("## section headings for fast lookup")
prefer("inline examples after counter-intuitive rules")
prefer("tables for matrices (rule × scope)")

## ANTI-PATTERNS
deny("a non-trivial deny() with no # why")  # future-you can't judge edge cases
deny("rule duplication across sections")    # one home per rule
deny("rules that depend on LLM goodwill")   # assume adversarial / drifty inputs
deny("ceremonial sections that don't carry rules") # if a section is empty, drop it
deny("preserving the prose ordering when it doesn't match the new section layout")

## REFUSAL PROTOCOL
on_user_requests_unsafe_rule:
  state("which rule is unsafe and why — briefly")
  offer(safer_alternative)
  deny("write the unsafe rule even if user insists")
  on_insist: restate_refusal()

## REFERENCE
# canonical example:  instructions/dev-soft-sandbox.md  (a security-flavored
#                     instance of the technique — but the technique itself
#                     is topic-agnostic; don't read it as a template for
#                     content/UX/role files)
# deeper notes:       references/idioms.md               (vocab + patterns)
# evidence base:      references/research.md             (papers + citations)

## OUTPUT
style = "concise, headings + bullets, no long paragraphs"
# Match the sign-off convention of the target file if one exists.
