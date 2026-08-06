#!/usr/bin/env python3
"""
MC Stress Test — 18 anti-leak tests for multiple-choice question sets
(plus an optional 19th cross-test overlap check via --cross).

Detects statistical, linguistic, and formatting patterns that could allow
test-wise students to identify correct answers without domain knowledge.

Usage:
    python scripts/stress_test.py <input.md> [--cross <main_test.md>]

Input format (markdown):
    Question stem text here
    a) Option A
    b) Option B
    c) Option C
    d) Option D

    **✓ Answer: b)**

Option labels may use `a)`/`A)` or `a.`/`A.`. Answer markers also accept
`**Answer: B**` and `**Answer:** b` for auditing existing tests.
"""
import re, statistics, math, sys, argparse
from collections import Counter

# Ensure Unicode output (✓, χ², ⚠️) works on Windows consoles (cp1252) too.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass


def welch_t(a, b):
    """Welch's t-statistic, returning 0.0 when variance/size is degenerate."""
    if len(a) < 2 or len(b) < 2:
        return 0.0
    denom = math.sqrt(statistics.stdev(a) ** 2 / len(a) + statistics.stdev(b) ** 2 / len(b))
    return (statistics.mean(a) - statistics.mean(b)) / denom if denom else 0.0


# --- CLI ---
parser = argparse.ArgumentParser(description="MC leak-detection stress test")
parser.add_argument("input", help="Markdown file with MC questions")
parser.add_argument("--cross", help="Optional second test file for cross-leak detection")
args = parser.parse_args()

with open(args.input, encoding="utf-8") as f:
    content = f.read()

if re.search(r'^###\s+', content, re.MULTILINE):
    print("ERROR: Per-question titles are unsupported because exported metadata can leak answers.")
    sys.exit(1)

ANSWER_PATTERN = re.compile(
    r'\*\*(?:✓\s*)?Answer:\s*([a-d])\)?\*\*'
    r'|\*\*Answer:\*\*\s*([a-d])\)?',
    re.IGNORECASE,
)


def parse_options_and_stem(body_text):
    """Extract options dict and stem lines from a question body block."""
    opts = {}
    lines = body_text.split('\n')
    first_option = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        om = re.match(r'^([a-d])[\).] (.+)$', stripped, re.IGNORECASE)
        if om:
            if first_option is None:
                first_option = index
            opts[om.group(1).lower()] = om.group(2)

    stem_lines = []
    for line in reversed(lines[:first_option] if first_option is not None else []):
        stripped = line.strip()
        if not stripped:
            if stem_lines:
                break
            continue
        if stripped.startswith(('#', '>', '---', '**')):
            if stem_lines:
                break
            continue
        stem_lines.append(stripped)
    return opts, ' '.join(reversed(stem_lines))


def parse_questions(markdown):
    """Parse title-free question blocks terminated by answer markers."""
    parsed = []
    block_start = 0
    for match in ANSWER_PATTERN.finditer(markdown):
        correct = (match.group(1) or match.group(2)).lower()
        block = markdown[block_start:match.start()].strip()
        opts, q_text = parse_options_and_stem(block)
        if len(opts) == 4 and q_text:
            q_num = len(parsed) + 1
            parsed.append({
                'num': q_num, 'text': q_text,
                'options': opts, 'correct': correct,
                'correct_text': opts[correct],
            })
        block_start = match.end()
    return parsed


def rate_ratio(first, second):
    """Return a symmetric ratio where 1.0 is balanced and infinity is one-sided."""
    if first == 0 and second == 0:
        return 1.0
    if first == 0 or second == 0:
        return math.inf
    return max(first, second) / min(first, second)


def length_rank_weights(question):
    """Distribute tied correct-option lengths across all ranks they occupy."""
    correct_length = len(question['correct_text'])
    lengths = [len(question['options'][letter]) for letter in letters]
    longer = sum(length > correct_length for length in lengths)
    tied = sum(length == correct_length for length in lengths)
    return {rank: 1 / tied for rank in range(longer + 1, longer + tied + 1)}


questions = parse_questions(content)

N = len(questions)
if N == 0:
    print("ERROR: No questions parsed. Check input format.")
    sys.exit(1)
marker_count = len(list(ANSWER_PATTERN.finditer(content)))
if N != marker_count:
    print(f"ERROR: Parsed {N} of {marker_count} answer-marked questions. "
          "Check option labels and block structure.")
    sys.exit(1)

letters = 'abcd'
results = []


def test(name, passed, detail=""):
    results.append((name, passed, detail))
    icon = "✓" if passed else "⚠️"
    print(f"  {icon} {name}")
    if detail:
        for line in detail.strip().split('\n'):
            print(f"      {line}")


print(f"{'=' * 70}")
print(f"STRESS TEST — {N} MC Questions — 18 Tests")
print(f"{'=' * 70}\n")

# 1. POSITION DISTRIBUTION
answers = [q['correct'] for q in questions]
dist = Counter(answers)
expected = N / 4
chi2 = sum((dist.get(l, 0) - expected) ** 2 / expected for l in letters)
position_counts = [dist.get(letter, 0) for letter in letters]
position_spread = max(position_counts) - min(position_counts)
chi2_ok = chi2 <= 7.815 if N >= 20 else True
test("1. Position distribution (counts differ ≤ 1)", position_spread <= 1 and chi2_ok,
     f"a={dist.get('a', 0)} b={dist.get('b', 0)} c={dist.get('c', 0)} "
     f"d={dist.get('d', 0)} | spread={position_spread} | χ²={chi2:.2f}"
     + ("" if N >= 20 else " (diagnostic only; N < 20)"))

# 2. ANSWER RUNS
max_run = 1
cr = 1
for i in range(1, len(answers)):
    if answers[i] == answers[i - 1]:
        cr += 1
        max_run = max(max_run, cr)
    else:
        cr = 1
test("2. Answer runs (max ≤ 2)", max_run <= 2, f"Max consecutive: {max_run}")

# 3. LENGTH BIAS (chars)
c_lens = [len(q['correct_text']) for q in questions]
i_lens = [len(q['options'][l]) for q in questions for l in letters if l != q['correct']]
t_len = welch_t(c_lens, i_lens)
test("3. Length bias chars (|t| < 2.0)", abs(t_len) < 2.0,
     f"Correct={statistics.mean(c_lens):.0f}ch, Incorrect={statistics.mean(i_lens):.0f}ch, t={t_len:.2f}")

# 4. LENGTH OUTLIERS (per-question)
outliers = []
for q in questions:
    cl = len(q['correct_text'])
    il = statistics.mean([len(q['options'][l]) for l in letters if l != q['correct']])
    r = cl / il if il > 0 else 1
    if r > 1.3 or r < 0.7:
        outliers.append(f"Q{q['num']}: {r:.2f}x")
test("4. Length outliers (all 0.7–1.3x)", len(outliers) == 0,
     '\n'.join(outliers) if outliers else "None")

# 5. WORD COUNT BIAS
c_words = [len(q['correct_text'].split()) for q in questions]
i_words = [len(q['options'][l].split()) for q in questions for l in letters if l != q['correct']]
t_word = welch_t(c_words, i_words)
test("5. Word count bias (|t| < 2.0)", abs(t_word) < 2.0, f"t={t_word:.2f}")

# 6. ABSOLUTE LANGUAGE
absolutes = ['always', 'never', 'only', 'all', 'none', 'every', 'must', 'cannot', 'impossible',
             'guaranteed', 'certainly', 'exclusively', 'purely']
c_abs = sum(1 for q in questions for a in absolutes if re.search(r'\b' + a + r'\b', q['correct_text'].lower()))
i_abs = sum(1 for q in questions for l in letters if l != q['correct']
            for a in absolutes if re.search(r'\b' + a + r'\b', q['options'][l].lower()))
c_rate = c_abs / N
i_rate = i_abs / (N * 3)
abs_ratio = rate_ratio(c_rate, i_rate)
test("6. Absolute language balance (ratio ≤ 1.5x)", abs_ratio <= 1.5,
     f"Correct: {c_abs} ({c_rate:.2f}/q), Incorrect: {i_abs} ({i_rate:.2f}/q), ratio={abs_ratio:.2f}x")

# 7. HEDGING BALANCE
hedges = ['often', 'usually', 'typically', 'generally', 'may', 'might', 'can', 'sometimes',
          'tends to', 'in most cases', 'primarily']
c_hedge = sum(1 for q in questions for h in hedges
              if re.search(r'\b' + re.escape(h) + r'\b', q['correct_text'].lower()))
i_hedge = sum(1 for q in questions for l in letters if l != q['correct']
              for h in hedges if re.search(r'\b' + re.escape(h) + r'\b', q['options'][l].lower()))
c_hedge_rate = c_hedge / N
i_hedge_rate = i_hedge / (N * 3)
hedge_ratio = rate_ratio(c_hedge_rate, i_hedge_rate)
test("7. Hedging balance (ratio ≤ 2.0x)", hedge_ratio <= 2.0,
     f"Correct: {c_hedge}, Incorrect: {i_hedge}, ratio={hedge_ratio:.2f}x")

# 8. GRAMMATICAL CUES
gram = [q['num'] for q in questions if q['text'].lower().rstrip('?').endswith((' a', ' an'))]
test("8. Grammatical cues (article leaks)", len(gram) == 0,
     f"Flagged: Q{gram}" if gram else "None")

# 9. WORD OVERLAP
stop = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'not',
        'it', 'its', 'that', 'this', 'with', 'from', 'by', 'as', 'be', 'has', 'have', 'had', 'do', 'does',
        'did', 'what', 'which', 'how', 'why', 'when', 'where', 'who', 'can', 'could', 'would', 'should',
        'will', 'following', 'between', 'than', 'each', 'other', 'more', 'most', 'one'}
c_ov = []
i_ov = []
for q in questions:
    sw = set(re.findall(r'\w+', q['text'].lower())) - stop
    for l in letters:
        ow = set(re.findall(r'\w+', q['options'][l].lower())) - stop
        ov = len(sw & ow) / len(sw) if sw else 0
        (c_ov if l == q['correct'] else i_ov).append(ov)
t_ov = welch_t(c_ov, i_ov)
test("9. Word overlap stem→options (|t| < 2.0)", abs(t_ov) < 2.0, f"t={t_ov:.2f}")

# 10. SPECIFICITY BIAS
def spec(text):
    return (len(re.findall(r'\d+', text)) + len(re.findall(r'\(.*?\)', text)) +
            len(re.findall(r'—|–', text)) + len(re.findall(r'/', text)))


c_spec = [spec(q['correct_text']) for q in questions]
i_spec = [spec(q['options'][l]) for q in questions for l in letters if l != q['correct']]
ratio_spec = rate_ratio(statistics.mean(c_spec), statistics.mean(i_spec))
test("10. Specificity balance (ratio ≤ 1.5x)", ratio_spec <= 1.5,
     f"Correct={statistics.mean(c_spec):.2f}, Incorrect={statistics.mean(i_spec):.2f}, ratio={ratio_spec:.2f}x")

# 11. POSITION-SPECIFIC LENGTH
pos_lens = {l: [len(q['options'][l]) for q in questions] for l in letters}
pos_avgs = {l: statistics.mean(pos_lens[l]) for l in letters}
spread = max(pos_avgs.values()) - min(pos_avgs.values())
test("11. Position-specific length (spread < 15ch)", spread < 15,
     ' | '.join(f"{l})={pos_avgs[l]:.0f}ch" for l in letters) + f" | spread={spread:.1f}")

# 12. SECTION REFERENCE LEAKS
# Detects patterns like S1/S2/S3, Section 1, Module 1, etc.
section_ref_pattern = r'\b(?:S[1-9]\d*|Section\s+\d+|Module\s+\d+|Part\s+\d+)\b'
sess_leaks = []
for q in questions:
    refs_by_option = {
        letter: len(re.findall(section_ref_pattern, q['options'][letter], re.IGNORECASE))
        for letter in letters
    }
    marked_options = [letter for letter, count in refs_by_option.items() if count]
    if len(marked_options) == 1:
        sole = marked_options[0]
        role = "correct" if sole == q['correct'] else "incorrect"
        sess_leaks.append(f"Q{q['num']}: only {sole}) ({role}) has a section reference")
test("12. Section reference leaks", len(sess_leaks) == 0,
     '\n'.join(sess_leaks) if sess_leaks else "No leaks")

# 13. MARKER WORDS
all_c_words = Counter()
all_i_words = Counter()
for q in questions:
    for w in re.findall(r'\w+', q['correct_text'].lower()):
        if w not in stop and len(w) > 3:
            all_c_words[w] += 1
    for l in letters:
        if l != q['correct']:
            for w in re.findall(r'\w+', q['options'][l].lower()):
                if w not in stop and len(w) > 3:
                    all_i_words[w] += 1

marker_words = []
for word, count in all_c_words.items():
    i_count = all_i_words.get(word, 0)
    if count >= 3 and i_count == 0:
        marker_words.append(f"'{word}' appears {count}x in correct, 0x in incorrect")
    elif count >= 4 and count / (count + i_count) > 0.6:
        marker_words.append(
            f"'{word}' appears {count}/{count + i_count} times in correct ({count / (count + i_count) * 100:.0f}%)")
test("13. Marker words (no word uniquely flags correct)", len(marker_words) == 0,
     '\n'.join(marker_words) if marker_words else "No markers")

# 14. EM-DASH PATTERN
c_has_dash = sum(1 for q in questions if '—' in q['correct_text'] or '–' in q['correct_text'])
i_has_dash = sum(1 for q in questions for l in letters if l != q['correct'] and (
        '—' in q['options'][l] or '–' in q['options'][l]))
c_dash_rate = c_has_dash / N
i_dash_rate = i_has_dash / (N * 3)
dash_ratio = rate_ratio(c_dash_rate, i_dash_rate)
test("14. Em-dash pattern balance (ratio ≤ 2.0x)", dash_ratio <= 2.0,
     f"Correct: {c_has_dash}/{N} ({c_dash_rate:.0%}), Incorrect: {i_has_dash}/{N * 3} ({i_dash_rate:.0%}), ratio={dash_ratio:.1f}x")

# 15. PARENTHETICAL PATTERN
c_has_paren = sum(1 for q in questions if '(' in q['correct_text'])
i_has_paren = sum(1 for q in questions for l in letters if l != q['correct'] and '(' in q['options'][l])
c_p_rate = c_has_paren / N
i_p_rate = i_has_paren / (N * 3)
p_ratio = rate_ratio(c_p_rate, i_p_rate)
test("15. Parenthetical pattern balance (ratio ≤ 2.0x)", p_ratio <= 2.0,
     f"Correct: {c_has_paren}/{N} ({c_p_rate:.0%}), Incorrect: {i_has_paren}/{N * 3} ({i_p_rate:.0%}), ratio={p_ratio:.1f}x")

# 16. NEGATION DISTRIBUTION
def is_negative_stem(text):
    normalized = re.sub(r'\bleast privilege\b', '', text.lower())
    return bool(
        re.search(r'\b(?:not|except)\b', normalized)
        or re.search(r'\b(?:which|what)\b.*\bleast\b', normalized)
    )


neg_qs = [(q['num'], q['correct']) for q in questions if is_negative_stem(q['text'])]
neg_positions = Counter(c for _, c in neg_qs)
test("16. Negation questions — position spread",
     len(set(c for _, c in neg_qs)) > 1 if len(neg_qs) > 1 else True,
     f"{len(neg_qs)} negation Qs, answers: {dict(neg_positions)}")

# 17. LENGTH RANK DISTRIBUTION
rank_dist = Counter()
for q in questions:
    rank_dist.update(length_rank_weights(q))
rank_chi2 = sum((rank_dist.get(r, 0) - N / 4) ** 2 / (N / 4) for r in range(1, 5))
max_rank_pct = max(rank_dist.get(r, 0) for r in range(1, 5)) / N
rank_chi2_ok = rank_chi2 <= 7.815 if N >= 20 else True
attainable_max = max(0.36, math.ceil(N / 4) / N)
test("17. Length rank distribution (max rank share bounded)",
     rank_chi2_ok and max_rank_pct <= attainable_max,
     f"rank1={rank_dist.get(1, 0):.1f} rank2={rank_dist.get(2, 0):.1f} "
     f"rank3={rank_dist.get(3, 0):.1f} rank4={rank_dist.get(4, 0):.1f} "
     f"| χ²={rank_chi2:.2f}"
     + ("" if N >= 20 else " (diagnostic only; N < 20)")
     + f" | max={max_rank_pct:.0%} | limit={attainable_max:.0%}")

# 18. ANSWER-KEY PERIODICITY
periodic = []
for width in range(2, min(5, N // 2 + 1)):
    repeats_required = 3 if width == 2 else 2
    span = width * repeats_required
    for start in range(N - span + 1):
        block = answers[start:start + width]
        if answers[start:start + span] == block * repeats_required:
            periodic.append(
                f"Q{start + 1}-Q{start + span}: repeated {' '.join(block)} cycle")
test("18. Answer-key periodicity (no repeated cycles)", len(periodic) == 0,
     '\n'.join(periodic) if periodic else "No repeated cycles")

# 19. CROSS-LEAK CHECK (optional)
if args.cross:
    import os
    if os.path.exists(args.cross):
        with open(args.cross, encoding="utf-8") as f:
            main_content = f.read()
        main_qs = [q['text'].lower() for q in parse_questions(main_content)]

        quiz_stems = [q['text'].lower() for q in questions]
        leaks = []
        for qi, qt in enumerate(quiz_stems):
            qw = set(re.findall(r'\w+', qt)) - stop
            for mi, mt in enumerate(main_qs):
                mw = set(re.findall(r'\w+', mt)) - stop
                if qw and mw:
                    overlap = len(qw & mw) / min(len(qw), len(mw))
                    if overlap > 0.6:
                        leaks.append(f"Q{qi + 1} ↔ Cross-Q{mi + 1}: {overlap:.0%} stem overlap")
        test("19. Cross-leak with reference test (stem overlap ≤ 60%)", len(leaks) == 0,
             '\n'.join(leaks) if leaks else "No cross-leaks detected")
    else:
        test("19. Cross-leak with reference test", False,
             f"Reference file not found: {args.cross}")

# --- SUMMARY ---
print(f"\n{'=' * 70}")
print(f"SCORECARD")
print(f"{'=' * 70}")
passed = sum(1 for _, p, _ in results if p)
for name, p, _ in results:
    print(f"  {'✓' if p else '⚠️'} {name}")
print(f"\n  SCORE: {passed}/{len(results)} passed")

# --- DIAGNOSTICS ---
print(f"\n{'=' * 70}")
print(f"DIAGNOSTICS")
print(f"{'=' * 70}")
print(f"\nAnswer sequence: {' '.join(answers)}")
print(f"\nPer-question lengths:")
for q in questions:
    lens = {l: len(q['options'][l]) for l in letters}
    ranks = list(length_rank_weights(q))
    rank_label = str(ranks[0]) if len(ranks) == 1 else f"{ranks[0]}-{ranks[-1]}"
    print(f"  Q{q['num']:2d} ({q['correct']}) rank={rank_label}  "
          f"a={lens['a']:3d} b={lens['b']:3d} c={lens['c']:3d} d={lens['d']:3d}")

sys.exit(0 if passed == len(results) else 1)
