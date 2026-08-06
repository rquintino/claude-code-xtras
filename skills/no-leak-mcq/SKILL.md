---
name: no-leak-mcq
description: Generate or review four-option multiple-choice questions for answer leakage through position, length, language, formatting, content, distractor quality, or cross-question cues. Includes a Python leak detector. Use when creating, revising, auditing, or benchmarking multiple-choice questions, quizzes, tests, exams, distractors, or answer keys.
license: MIT
compatibility: Requires Python 3.9 or later to run the bundled leak detector.
metadata:
  version: "1.1.0"
---

# No-Leak MCQ — Leak-Proof Question Authoring

Generate four-option multiple-choice questions where **no statistical, linguistic, formatting, or content signal leaks which option is correct**. A test-wise student using only non-domain cues should not beat the 25% chance baseline.

The skill is deliberately scoped to **leakage**: it does not teach general item pedagogy, only the constraints that stop a correct answer from being guessable. It works in two layers:
1. **Statistical / formatting anti-leak rules** (18 hard rules) — checked mechanically by the bundled `scripts/stress_test.py`.
2. **Content & style leak rules** — cues no script can catch (implausible distractors, overlapping options, "all/none of the above"). Apply these by hand.

## When to use

When asked to generate, create, author, draft, or review multiple-choice questions, quizzes, tests, or exams. Also when asked to audit existing MC questions for answer leakage.

---

## Instructions

You are an expert psychometrician generating multiple-choice questions. Your PRIMARY constraint is that **no statistical, linguistic, formatting, or content signal may leak which option is correct**. A test-wise student using only non-domain cues should not beat the 25% chance baseline.

### INPUT REQUIRED

The user must provide:
- **Source material** — slides, notes, documents, or topic descriptions to base questions on
- **Number of questions** — total count
- **Session/section structure** — how questions map to topics (optional)
- **Difficulty level** — conceptual recall, application, scenario-based (optional, default: mixed)
- **Answer key format** — whether to include answers inline or in a separate section (optional)

### OUTPUT FORMAT

```markdown
[Question stem — clear, scenario-based when possible]
a) [Option]
b) [Option]
c) [Option]
d) [Option]

**✓ Answer: [x])**
```

Do not add per-question titles, labels, difficulty tags, topic names, or other metadata. Export pipelines can move or style that metadata unevenly, creating an unintended cue. Output only the stem, four options, and answer marker.

This is an authoring/validation format. Before learner-facing export, remove every answer marker or keep the answer key in a separate, access-controlled artifact.

---

## THE 18 ANTI-LEAK RULES

Every generated question set MUST satisfy ALL of the following. These are hard constraints, not suggestions.

### 1. Position Distribution
Correct answers must be as evenly distributed across a/b/c/d as N permits: position counts may differ by at most 1. For N >= 20, the chi-squared diagnostic must also be < 7.815 (p > 0.05 with df=3).

**How:** After drafting all questions, count answer positions. Redistribute if any letter is over/under-represented.

### 2. No Answer Runs
Maximum 2 consecutive questions may share the same correct-answer position.

**How:** After assigning positions, scan the sequence. Break any run of 3+ by swapping with a nearby question.

### 3. Character Length Neutrality
The correct option must NOT be systematically longer or shorter than incorrect options across the set. Statistical t-test |t| < 2.0.

**How:** Write all four options to similar length. Avoid the classic trap of making the correct answer the most detailed/qualified.

### 4. Per-Question Length Balance
For each individual question, the correct option's character length must be between 0.7x and 1.3x the mean length of the three incorrect options.

**How:** If the correct answer is naturally longer (because it's more precise), pad the distractors with equal specificity. If shorter, add qualifying detail.

### 5. Word Count Neutrality
Same as Rule 3 but measured in word count. |t| < 2.0 across the full set.

### 6. Absolute Language Balance
Words like `always, never, only, all, none, every, must, cannot, impossible, guaranteed, certainly, exclusively, purely` must NOT concentrate in correct OR incorrect answers disproportionately.

**How:** If the correct answer uses "always," at least one distractor should also use absolute language. Or rephrase to avoid absolutes entirely.

### 7. Hedging Language Balance
Words like `often, usually, typically, generally, may, might, can, sometimes, tends to, in most cases, primarily` must be balanced. Do NOT make correct answers systematically more hedged (a classic leak).

**How:** Distribute hedging words across correct and incorrect options equally. Avoid the pattern where the "most nuanced" answer is always correct.

### 8. No Grammatical Cues
The question stem must NOT end with an article (`a`, `an`) that grammatically matches only one option.

**How:** End stems with complete phrases, or use "a/an" in the stem only if all four options grammatically fit.

### 9. Word Overlap Neutrality
The correct option must NOT share more keywords with the stem than incorrect options do (excluding stop words). |t| < 2.0.

**How:** Either distribute stem keywords across all options, or rephrase to use synonyms in the correct answer. Don't echo the stem's exact words only in the correct option.

### 10. Specificity Balance
Markers of specificity — digits, parenthetical content, em-dashes, slashes — must be distributed evenly. Correct answers must not be disproportionately more specific (ratio <= 1.5x).

**How:** If the correct answer includes a number or parenthetical, include similar detail in at least one distractor.

### 11. Position-Specific Length
The average character length of options at position a), b), c), d) across ALL questions must be similar (spread < 15 characters).

**How:** Don't always put the longest option in position d) or shortest in a). Vary placement.

### 12. No Session/Topic Reference Leaks
Do not add per-question titles, difficulty labels, taxonomy levels, session names, module names, or topic labels. If the source requires a reference inside an option (e.g., "S1", "Session 2"), it must appear in multiple options, not exclusively in the correct one.

### 13. No Marker Words
No content word (>3 chars, excluding stop words) should appear 3+ times exclusively in correct answers and 0 times in incorrect answers across the set. No word should appear in correct answers >60% of its total occurrences if it appears 4+ times.

**How:** Vary vocabulary. If a key concept word appears in the correct answer of one question, use it in a distractor of another question.

### 14. Dash Balance
Em/en dashes (`—`, `–`) must not appear disproportionately in correct vs incorrect answers (ratio <= 2.0x). Prefer avoiding them in options.

### 15. Parenthetical Balance
Parenthetical expressions `(...)` must not appear disproportionately in correct vs incorrect answers (ratio <= 2.0x).

### 16. Negation Question Distribution
Questions with "NOT" or negation in the stem must have their correct answers spread across multiple positions, not clustered on one letter.

### 17. Length Rank Distribution
When options are ranked by length (1=longest, 4=shortest), the correct answer's rank must be approximately uniformly distributed across the set. No single rank may exceed 36% (adjusted upward only when a smaller set makes 36% mathematically impossible). For N >= 20, chi-squared must also be < 7.815.

### 18. No Answer-Key Periodicity
The answer sequence must not contain an obvious repeated cycle such as `a b c d a b c d` or `a c a c a c`. Balanced counts are not enough if their order is predictable.

**How:** Shuffle correct-answer positions, then inspect for repeated blocks and alternating patterns. Preserve rules 1, 2, 16, and 17 while breaking any cycle.

---

## CONTENT & STYLE LEAK RULES

The 18 rules above kill *statistical and formatting* leaks. These rules kill *content and style* leaks — cues that let a test-wise student eliminate or pick options by reasoning about the choices rather than the subject. `scripts/stress_test.py` cannot detect these, so enforce them by hand.

- **Plausible distractors (no free eliminations):** Every distractor must be a genuine misconception, partial truth, or superficially reasonable claim grounded in real student errors. An implausible or joke option is a leak — it lets a clueless student eliminate it and raise their odds above 25%.
- **Homogeneous options:** All four options must share the same grammatical type, structure, and register (all phrases, all sentences, all noun groups). An option that "looks different" from the others draws attention and cues the answer.
- **Mutually exclusive — no overlap:** No two options may mean the same thing. If two overlap, a student eliminates both (neither can be the single correct answer). Conversely, avoid a pair of exact opposites where one is obviously the "real" one — the convergence cue points straight at it.
- **No "all/none of the above":** These reward test-taking strategy over knowledge — spotting two true options forces "all of the above," and one false option kills it. Omit them unless there is a strong, specific reason.
- **Independent items:** Answering one question must not reveal the answer to another. Don't use the same fact as correct in one question and as a distractor in another in a way that cross-leaks (see also rules 12–13; verify with `--cross`).
- **Balanced qualification:** Don't let the correct answer be the most carefully hedged, most complete, or "most textbook-sounding" option — that is a content leak even when lengths match (reinforces rules 6–7).
- **No metadata cues:** Do not attach titles, topic labels, difficulty tags, source references, or learning-objective codes to individual questions. Export or rendering differences can expose these unevenly.


---

## GENERATION PROCESS

Follow this sequence:

1. **Analyze source material** — identify key concepts, common misconceptions, and scenario opportunities
2. **Draft question stems** — prefer scenario-based ("A developer discovers...") over recall ("What is..."); add no per-question title or metadata
3. **Write correct answers first** — grounded in source material
4. **Write three plausible distractors per question** — based on real misconceptions
5. **Equalize formatting** — apply rules 3-15 to balance length, language, specificity, punctuation
6. **Assign answer positions** — distribute and shuffle across a/b/c/d satisfying rules 1, 2, 16, 17, and 18
7. **Self-audit** — mentally run all 18 anti-leak rules AND the content & style leak rules. Fix violations before outputting.
8. **Verify** — run `scripts/stress_test.py` on the output and resolve any failures.

### SELF-AUDIT CHECKLIST (run before output)

```
[ ] Position counts: a=__ b=__ c=__ d=__ (each ~ N/4)
[ ] Max consecutive same position: __ (must be <= 2)
[ ] No repeated or alternating answer-key cycle
[ ] Scanned for length outliers (no question has correct >1.3x or <0.7x mean distractor length)
[ ] No grammatical article cues in stems
[ ] No per-question titles, labels, difficulty tags, or topic metadata
[ ] Absolute/hedging language distributed across correct and incorrect
[ ] No marker words uniquely flagging correct answers
[ ] Specificity markers (numbers, parens, dashes) balanced
[ ] Cross-question independence verified
[ ] All distractors plausible (no free eliminations); options homogeneous & mutually exclusive
[ ] No "all/none of the above"; correct answer is not the most-qualified/most-complete option
```

---

## BUNDLED SCRIPT

One Python script is packaged in `no-leak-mcq/scripts/`. It is generic, domain-agnostic, and uses only the Python standard library.

### `stress_test.py` — Leak Detector (post-generation QA)

Runs the 18 anti-leak tests against a generated markdown test file and reports pass/fail with diagnostics. A 19th check (cross-test stem overlap) runs only when `--cross` is supplied.

```bash
# Basic usage — 18 anti-leak tests
python scripts/stress_test.py test.md

# Add the cross-leak check against a second test (19th test)
python scripts/stress_test.py quiz.md --cross main_test.md
```

**Input format:** stem + four options (`a)` through `d)`) + `**✓ Answer: x)**`. Per-question titles and metadata are intentionally unsupported because they can become answer cues when exported.

**After generating questions, always run `scripts/stress_test.py` on the output and resolve every failure.** Statistical checks are unstable on very small sets; interpret diagnostics cautiously when N < 12.

### REQUIRED USER WARNING

After generating or reviewing a question set, always show this warning to the user:

> **Leak-review warning:** Automated checks and manual rules reduce common answer cues, but they cannot guarantee a leak-free MCQ set. Carefully review the final questions for semantic, content, formatting, and cross-question patterns before using them with learners. Improvements and contributions to this skill are welcome.

Do not describe a passing score as proof that a test is leak-free. Report it as a heuristic screening result.

---

## WHAT THIS SKILL DOES NOT DO

- Does NOT convert to QTI, Moodle, or any LMS format
- Does NOT grade or score student responses
- Does NOT generate answer key justifications with source citations (separate concern)
- Focus is purely on **unbiased question generation** + **leak detection verification**
