#!/usr/bin/env bash
# Parity + regression test for statusline-command.sh (bash) and statusline.ps1 (PowerShell).
#   1. runs the bash script on fixed fixtures and checks the cmp (compaction advisor) numbers
#   2. runs both scripts on the same fixtures and diffs the output (ANSI, clock, version
#      stamp and the OS marker are normalized away — everything else must match)
# Usage: bash statusline/test-parity.sh        (needs jq; step 2 needs powershell or pwsh)
#        PS1_SCRIPT=<path> bash statusline/test-parity.sh   — compare against another copy of the .ps1
# State caches go to a temp HOME/USERPROFILE, never to your real ~/.claude.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home"
winpath() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
fail=0

# Transcript: first request B = 5000 + 25000 = 30k → post-compact estimate S = B + 20k = 50k
cat > "$T/tr.jsonl" <<'J'
{"type":"user","message":{"content":"hi"}}
{"type":"assistant","requestId":"r1","message":{"model":"claude-opus-5-5","usage":{"input_tokens":5000,"cache_read_input_tokens":0,"cache_creation_input_tokens":25000,"cache_creation":{"ephemeral_1h_input_tokens":25000},"output_tokens":500}}}
{"type":"assistant","requestId":"r2","message":{"model":"claude-opus-5-5","usage":{"input_tokens":1000,"cache_read_input_tokens":148000,"cache_creation_input_tokens":1000,"cache_creation":{"ephemeral_1h_input_tokens":1000},"output_tokens":2000}}}
J

# Countdowns are relative to "now", so fixtures are rebuilt right before each run;
# resets sit mid-minute / mid-hour so a few seconds of drift never flips a digit.
# mk <name> <model> <in> <cache_read> <cache_write> <ctx_size> <ttl> <warm> <expires_in_s> <has_usage>
mk() {
  local cu='null' pc='{}'
  [ "${10}" = 1 ] && cu="{\"input_tokens\":$3,\"cache_read_input_tokens\":$4,\"cache_creation_input_tokens\":$5,\"output_tokens\":700}"
  [ -n "$7" ] && pc="{\"ttl\":\"$7\",\"warm\":$8$([ -n "$9" ] && echo ",\"expires_at\":$((now + $9))")}"
  cat > "$T/$1.json" <<J
{"session_id":"s-$1","transcript_path":"$(winpath "$T/tr.jsonl")","cwd":"$(winpath "$here")","model":{"id":"$2","display_name":"$2"},
"cost":{"total_cost_usd":1234.567,"total_duration_ms":90000,"total_api_duration_ms":45000,"total_lines_added":10,"total_lines_removed":2},
"context_window":{"used_percentage":42,"context_window_size":$6,"current_usage":$cu},
"rate_limits":{"five_hour":{"used_percentage":20,"resets_at":$((now + 5400 + 30))},"seven_day":{"used_percentage":35,"resets_at":$((now + 3 * 86400 - 1800))}},
"prompt_cache":$pc}
J
}
make_fixtures() {
  now=$(date +%s)
  mk fresh   claude-opus-5-5  0    0      0    1000000 ""  ""    ""    0
  mk small   claude-opus-5-5  1000 38000  1000 1000000 1h  true  1800  1
  mk warm    claude-opus-5-5  1000 148000 1000 1000000 1h  true  1800  1
  mk coldneg claude-opus-5    1000 148000 1000 1000000 1h  false ""    1
  mk coldpos claude-opus-5-5  1000 298000 1000 1000000 1h  true  -60   1
  mk cold5m  claude-sonnet-5  1000 148000 1000 1000000 5m  false ""    1
  mk near    claude-haiku-4-5 1000 178000 1000 200000  1h  true  1800  1
  mk fable   claude-fable-5-1 2000 500000 8000 1000000 5m  true  1800  1
  mk unknown claude-new-9     1000 148000 1000 1000000 1h  true  1800  1
}

norm() {
  sed 's/\x1b\[[0-9;]*m//g' | tr -d '\r' \
    | sed -E 's/🕐 [0-9:]+/🕐 T/; s/v:[0-9]+ [0-9:]+/v:X/; s/cold in [0-9]+m/cold in Nm/; s/^● .* · 🕐/● OS · 🕐/'
}
run_sh() { make_fixtures; HOME="$T/home" bash "$here/statusline-command.sh" < "$T/$1.json" 2>&1 | norm; }

# --- 1. Expected compaction-advisor lines (hand-computed from the formulas in the scripts) ---
declare -A want=(
  [fresh]='cmp   fresh context'
  [small]='cmp   context small, no benefit'
  [warm]='cmp   warm (cold in Nm) cost $0.35 saves $0.020/req pays back in 18 req 150k->~50k'
  [coldneg]='cmp   cold, compact costs ~$0.14 extra, then saves $0.050/req 150k->~50k'
  [coldpos]='cmp   cold, compact now: ~$0.34 cheaper than resuming then saves $0.050/req 300k->~50k >200k: recall degrades'
  [cold5m]='cmp   cold, compact costs ~$0.21 extra, then saves $0.020/req 150k->~50k'
  [near]='cmp   warm (cold in Nm) cost $0.10 saves $0.013/req pays back in 8 req 180k->~50k auto-compact near'
  [fable]='cmp   warm (cold in Nm) cost $0.78 saves $0.115/req pays back in 7 req 510k->~50k >200k: recall degrades'
  [unknown]='cmp   warm (cold in Nm) cost $0.48 saves $0.050/req pays back in 10 req 150k->~50k'
)
for f in fresh small warm coldneg coldpos cold5m near fable unknown; do
  got=$(run_sh "$f" | grep '^cmp')
  if [ "$got" = "${want[$f]}" ]; then echo "ok    cmp/$f"
  else echo "FAIL  cmp/$f"; echo "      want: ${want[$f]}"; echo "      got:  $got"; fail=1; fi
done

# Session cost uses thousands separators and .NET rounding: 1234.567 → 1,234.57
if run_sh warm | grep -q 'cost:\$1,234.57'; then echo "ok    cost-format"
else echo "FAIL  cost-format"; fail=1; fi

# --- 2. bash vs PowerShell parity ---
ps=$(command -v powershell || command -v pwsh)
if [ -z "$ps" ]; then
  echo "skip  parity (no powershell/pwsh on PATH)"
else
  for f in fresh small warm coldneg coldpos cold5m near fable unknown; do
    run_sh "$f" > "$T/$f.sh"   # rebuilds fixtures, so the ps1 run below sees the same "now"
    USERPROFILE="$(winpath "$T/home")" HOME="$T/home" "$ps" -NoProfile -File "$(winpath "${PS1_SCRIPT:-$here/statusline.ps1}")" < "$T/$f.json" 2>&1 | norm > "$T/$f.ps"
    if diff -q "$T/$f.sh" "$T/$f.ps" > /dev/null; then echo "ok    parity/$f"
    else echo "FAIL  parity/$f (< bash, > ps1)"; diff "$T/$f.sh" "$T/$f.ps" | sed 's/^/      /'; fail=1; fi
  done
fi

[ "$fail" = 0 ] && echo "ALL PASSED" || echo "SOME TESTS FAILED"
exit "$fail"
