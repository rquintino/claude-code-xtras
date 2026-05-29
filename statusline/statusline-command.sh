#!/usr/bin/env bash
# Claude Code status line:
#   line 1: ctx · model [effort] ·think · 5h · 7d
#   line 2: branch · PR · cwd · cost · lines · ⏱ duration · api
#   line 3: Σ in/cached/wr/out [cost bar]
#   line 4: last in/cached/wr/out [cost bar]
#   line 5: version timestamp

input=$(cat)

# --- Pull all fields in one jq call ---
# jq emits one field per line; mapfile preserves empty fields (unlike IFS-tab read,
# which treats tab as whitespace and collapses empties).
mapfile -t F < <(echo "$input" | jq -r '
  (.model.id            // ""),
  (.model.display_name  // ""),
  (.workspace.current_dir // .cwd // ""),
  (.cost.total_cost_usd // 0),
  (.session_id          // ""),
  (.cost.total_duration_ms     // 0),
  (.cost.total_api_duration_ms // 0),
  (.context_window.used_percentage    // -1),
  (.context_window.context_window_size // 200000),
  (.rate_limits.five_hour.used_percentage // ""),
  (.rate_limits.seven_day.used_percentage // ""),
  (.rate_limits.five_hour.resets_at       // ""),
  (.rate_limits.seven_day.resets_at       // ""),
  (.cost.total_lines_added   // 0),
  (.cost.total_lines_removed // 0),
  (.pr.number       // ""),
  (.pr.review_state // ""),
  (.transcript_path // ""),
  (.context_window.current_usage.input_tokens               // 0),
  (.context_window.current_usage.cache_read_input_tokens    // 0),
  (.context_window.current_usage.cache_creation_input_tokens // 0),
  (.context_window.current_usage.output_tokens              // 0),
  (.effort.level         // ""),
  (.thinking.enabled     // false),
  (.exceeds_200k_tokens  // false)
')
model_id="${F[0]}"
display_name="${F[1]}"
cwd="${F[2]}"
cost="${F[3]}"
session_id="${F[4]}"
duration_ms="${F[5]}"
api_duration_ms="${F[6]}"
pct="${F[7]}"
ctx_size="${F[8]}"
five_h="${F[9]}"
seven_d="${F[10]}"
five_h_reset="${F[11]}"
seven_d_reset="${F[12]}"
lines_added="${F[13]}"
lines_removed="${F[14]}"
pr_number="${F[15]}"
pr_state="${F[16]}"
transcript_path="${F[17]}"
last_in="${F[18]}"
last_rd="${F[19]}"
last_wr="${F[20]}"
last_out="${F[21]}"
effort_level="${F[22]}"
thinking_enabled="${F[23]}"
exceeds_200k="${F[24]}"

# --- Colors ---
reset="\033[0m"
dim="\033[2m"
bold="\033[1m"
sep="${dim} · ${reset}"

# --- Git branch ---
cwd="${cwd:-$(pwd)}"
branch=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null)
[ -z "$branch" ] && branch=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" rev-parse --short HEAD 2>/dev/null)

# --- Working directory (collapsed to ~/.../<leaf>) ---
short_cwd="${cwd/#$HOME/\~}"
leaf=$(basename "$short_cwd")
if [[ "$short_cwd" == "~/"*"/"* ]]; then
  short_cwd="~/.../${leaf}"
elif [[ "$short_cwd" == /*/*/* ]]; then
  short_cwd="/.../${leaf}"
fi

# --- Context window ---
pct_int=$(printf '%.0f' "${pct:-0}" 2>/dev/null)
if [ -n "$pct" ] && [ "$pct" != "-1" ] && [ "${pct_int:-0}" -ge 0 ] 2>/dev/null; then
  max_k=$(( ${ctx_size:-200000} / 1000 ))
  used_k=$(( pct_int * max_k / 100 ))
  if   [ "$pct_int" -ge 80 ]; then cc="\033[31m"
  elif [ "$pct_int" -ge 50 ]; then cc="\033[33m"
  else                              cc="\033[32m"; fi
  # 200k cliff alarm: standard-tier threshold crossed (1M-context users care)
  alarm=""
  if [ "$exceeds_200k" = "true" ]; then
    alarm="\033[31m⚠ \033[0m"
    cc="\033[31m"
  fi
  ctx_part="${alarm}${cc}ctx:  ${pct_int}% [${used_k}k/${max_k}k]${reset}"
else
  ctx_part="${dim}ctx:  --${reset}"
fi

# --- Effort + thinking badges (only when meaningful) ---
effort_part=""
case "$effort_level" in
  max)    effort_part="\033[1;31m[max]${reset}" ;;     # bold red
  xhigh)  effort_part="\033[31m[xhigh]${reset}" ;;     # red
  high)   effort_part="\033[33m[high]${reset}" ;;      # yellow
  medium|low) effort_part="${dim}[${effort_level}]${reset}" ;;
esac
thinking_part=""
[ "$thinking_enabled" = "true" ] && thinking_part="${dim}·think${reset}"

# --- Conversation cost (Claude Code's own counter; resets on /clear and resume) ---
cost_part=""
if [ -n "$cost" ] && [ "$cost" != "0" ] && [ "$cost" != "null" ]; then
  conv_cost=$(awk "BEGIN { printf \"%.2f\", $cost }")
  cost_part="cost:\$${conv_cost}"
fi

# --- Duration (total wall time) ---
duration_part=""
if [ -n "$duration_ms" ] && [ "$duration_ms" != "0" ] && [ "$duration_ms" != "null" ]; then
  dur_sec=$((duration_ms / 1000))
  mins=$((dur_sec / 60))
  secs=$((dur_sec % 60))
  duration_part="${dim}⏱ ${mins}m ${secs}s${reset}"
fi

# --- API time (time spent waiting on Claude's API) ---
api_part=""
if [ -n "$api_duration_ms" ] && [ "$api_duration_ms" != "0" ] && [ "$api_duration_ms" != "null" ]; then
  api_sec=$((api_duration_ms / 1000))
  api_mins=$((api_sec / 60))
  api_secs=$((api_sec % 60))
  api_part="${dim}⚡ ${api_mins}m ${api_secs}s${reset}"
fi

# --- Rate limits (Pro/Max only; absent silently). Color by % used. ---
color_for_pct() {
  local v="$1"
  if   [ "$v" -ge 80 ]; then echo "\033[31m"   # red
  elif [ "$v" -ge 50 ]; then echo "\033[33m"   # yellow
  else                       echo "\033[32m"   # green
  fi
}
# Small filled/empty bar for a percentage. Args: pct, width.
make_pct_bar() {
  local pct="$1" w="$2"
  awk -v p="$pct" -v w="$w" '
    BEGIN {
      filled = int(p * w / 100 + 0.5)
      if (filled > w) filled = w
      if (filled < 0) filled = 0
      for (i = 0; i < filled; i++) printf "█"
      for (i = filled; i < w; i++) printf "░"
    }'
}
# Compact countdown from now to a target epoch: "3h12m", "45m", "2d3h"
fmt_eta() {
  local target="$1" now diff d h m
  [ -z "$target" ] || [ "$target" = "null" ] && return
  now=$(date +%s)
  diff=$(( target - now ))
  [ "$diff" -le 0 ] && return
  if [ "$diff" -ge 86400 ]; then
    d=$(( diff / 86400 )); h=$(( (diff % 86400) / 3600 ))
    printf '%dd%dh' "$d" "$h"
  elif [ "$diff" -ge 3600 ]; then
    h=$(( diff / 3600 )); m=$(( (diff % 3600) / 60 ))
    printf '%dh%dm' "$h" "$m"
  else
    m=$(( diff / 60 ))
    printf '%dm' "$m"
  fi
}

rate_parts=()
if [ -n "$five_h" ] && [ "$five_h" != "null" ]; then
  v=$(printf '%.0f' "$five_h")
  c=$(color_for_pct "$v")
  bar=$(make_pct_bar "$v" 8)
  eta=$(fmt_eta "$five_h_reset")
  if [ -n "$eta" ]; then
    rate_parts+=("${dim}5h:${reset}${c}${bar} ${v}%${reset}${dim}·${eta}${reset}")
  else
    rate_parts+=("${dim}5h:${reset}${c}${bar} ${v}%${reset}")
  fi
fi
if [ -n "$seven_d" ] && [ "$seven_d" != "null" ]; then
  v=$(printf '%.0f' "$seven_d")
  c=$(color_for_pct "$v")
  bar=$(make_pct_bar "$v" 8)
  eta=$(fmt_eta "$seven_d_reset")
  if [ -n "$eta" ]; then
    rate_parts+=("${dim}7d:${reset}${c}${bar} ${v}%${reset}${dim}·${eta}${reset}")
  else
    rate_parts+=("${dim}7d:${reset}${c}${bar} ${v}%${reset}")
  fi
fi
rate_part=""
if [ "${#rate_parts[@]}" -gt 0 ]; then
  rate_part="$(IFS=' '; echo "${rate_parts[*]}")"
fi

# --- PR badge (only if branch has an open PR) ---
pr_part=""
if [ -n "$pr_number" ] && [ "$pr_number" != "null" ] && [ "$pr_number" != "0" ]; then
  case "$pr_state" in
    approved)          pr_color="\033[32m" ;;  # green
    changes_requested) pr_color="\033[31m" ;;  # red
    pending)           pr_color="\033[33m" ;;  # yellow
    draft|*)           pr_color="${dim}"   ;;
  esac
  if [ -n "$pr_state" ] && [ "$pr_state" != "null" ]; then
    pr_part="${pr_color}PR#${pr_number} (${pr_state})${reset}"
  else
    pr_part="${pr_color}PR#${pr_number}${reset}"
  fi
fi

# --- Lines diff (only if non-zero) ---
lines_part=""
if [ "${lines_added:-0}" != "0" ] || [ "${lines_removed:-0}" != "0" ]; then
  lines_part="\033[32m+${lines_added:-0}${reset}${dim}/${reset}\033[31m-${lines_removed:-0}${reset}"
fi

# --- Assemble line 1: ctx · model [effort] ·think · 5h · 7d ---
line1_parts=()
line1_parts+=("$ctx_part")
if [ -n "$display_name" ]; then
  # Highlight by family: Opus=magenta, Sonnet=cyan, Haiku=green, other=white.
  case "$model_id" in
    *opus*)   model_color="\033[1;35m" ;;
    *sonnet*) model_color="\033[1;36m" ;;
    *haiku*)  model_color="\033[1;32m" ;;
    *)        model_color="\033[1;37m" ;;
  esac
  model_label="${model_color}${display_name}${reset}"
  [ -n "$effort_part" ]   && model_label="${model_label} ${effort_part}"
  [ -n "$thinking_part" ] && model_label="${model_label}${thinking_part}"
  line1_parts+=("$model_label")
fi
[ -n "$rate_part" ] && line1_parts+=("$rate_part")

line1=""
for p in "${line1_parts[@]}"; do
  [ -z "$line1" ] && line1="$p" || line1="${line1}${sep}${p}"
done

# --- Cumulative token breakdown + per-turn priced cost ---
# Pricing applied per-turn using each message's .message.model field, since the
# user may switch models mid-session. Breakdown: in=fresh input, cached=cache hits,
# wr=cache writes, out=output. Source: docs.claude.com/en/about-claude/pricing
# Cache format v2: includes per-category cost (in token·$/MTok units).
sum_in=0; sum_rd=0; sum_w5=0; sum_w1=0; sum_out=0
cost_in_raw=0; cost_rd_raw=0; cost_w5_raw=0; cost_w1_raw=0; cost_out_raw=0
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ] && [ -n "$session_id" ]; then
  state_dir="${state_dir:-$HOME/.claude/statusline-state}"
  mkdir -p "$state_dir" 2>/dev/null
  tcache="${state_dir}/transcript-${session_id}.cache"
  tmtime=$(stat -c %Y "$transcript_path" 2>/dev/null || stat -f %m "$transcript_path" 2>/dev/null)
  cached_mtime=""
  cached_version=""
  [ -f "$tcache" ] && cached_mtime=$(awk -F= '/^mtime=/{print $2}' "$tcache")
  [ -f "$tcache" ] && cached_version=$(awk -F= '/^v=/{print $2}' "$tcache")
  if [ -n "$tmtime" ] && [ "$tmtime" = "$cached_mtime" ] && [ "$cached_version" = "2" ]; then
    sum_in=$(awk -F= '/^in=/{print $2}'  "$tcache")
    sum_rd=$(awk -F= '/^rd=/{print $2}'  "$tcache")
    sum_w5=$(awk -F= '/^w5=/{print $2}'  "$tcache")
    sum_w1=$(awk -F= '/^w1=/{print $2}'  "$tcache")
    sum_out=$(awk -F= '/^out=/{print $2}' "$tcache")
    cost_in_raw=$(awk -F= '/^ci=/{print $2}'  "$tcache")
    cost_rd_raw=$(awk -F= '/^cr=/{print $2}'  "$tcache")
    cost_w5_raw=$(awk -F= '/^cw5=/{print $2}' "$tcache")
    cost_w1_raw=$(awk -F= '/^cw1=/{print $2}' "$tcache")
    cost_out_raw=$(awk -F= '/^co=/{print $2}' "$tcache")
  else
    mapfile -t TS < <(jq -s '
      def price(m):
        if   (m | test("opus-4-[567]"))  then {i:5,  w5:6.25, w1:10, r:0.50, o:25}
        elif (m | test("opus-4"))        then {i:15, w5:18.75,w1:30, r:1.50, o:75}
        elif (m | test("sonnet-4"))      then {i:3,  w5:3.75, w1:6,  r:0.30, o:15}
        elif (m | test("haiku-4"))       then {i:1,  w5:1.25, w1:2,  r:0.10, o:5}
        else                                  {i:5,  w5:6.25, w1:10, r:0.50, o:25}
        end;
      map(select(.type == "assistant"))
      | group_by(.requestId)
      | map(.[0] | {u: (.message.usage // {}), p: price(.message.model // "")})
      | reduce .[] as $x ({in:0, cached:0, w5:0, w1:0, out:0, ci:0, cr:0, cw5:0, cw1:0, co:0};
          ($x.u.input_tokens                             // 0) as $ti |
          ($x.u.cache_read_input_tokens                  // 0) as $tr |
          ($x.u.cache_creation.ephemeral_5m_input_tokens // 0) as $t5 |
          ($x.u.cache_creation.ephemeral_1h_input_tokens // 0) as $t1 |
          ($x.u.output_tokens                            // 0) as $to |
          .in  += $ti |
          .rd  += $tr |
          .w5  += $t5 |
          .w1  += $t1 |
          .out += $to |
          .ci  += ($ti * $x.p.i)  |
          .cr  += ($tr * $x.p.r)  |
          .cw5 += ($t5 * $x.p.w5) |
          .cw1 += ($t1 * $x.p.w1) |
          .co  += ($to * $x.p.o))
      | .in, .rd, .w5, .w1, .out, .ci, .cr, .cw5, .cw1, .co
    ' "$transcript_path" 2>/dev/null)
    sum_in="${TS[0]:-0}"
    sum_rd="${TS[1]:-0}"
    sum_w5="${TS[2]:-0}"
    sum_w1="${TS[3]:-0}"
    sum_out="${TS[4]:-0}"
    cost_in_raw="${TS[5]:-0}"
    cost_rd_raw="${TS[6]:-0}"
    cost_w5_raw="${TS[7]:-0}"
    cost_w1_raw="${TS[8]:-0}"
    cost_out_raw="${TS[9]:-0}"
    printf 'v=2\nmtime=%s\nin=%s\nrd=%s\nw5=%s\nw1=%s\nout=%s\nci=%s\ncr=%s\ncw5=%s\ncw1=%s\nco=%s\n' \
      "$tmtime" "$sum_in" "$sum_rd" "$sum_w5" "$sum_w1" "$sum_out" \
      "$cost_in_raw" "$cost_rd_raw" "$cost_w5_raw" "$cost_w1_raw" "$cost_out_raw" > "$tcache"
  fi
fi
sum_wr=$(( sum_w5 + sum_w1 ))

# Estimated $ at published API rates, summed per-turn with each turn's model price.
# Format as right-padded to 7 chars: "$  0.01", "$ 15.19", etc.
est_cost=$(awk "BEGIN { v = ($cost_in_raw + $cost_rd_raw + $cost_w5_raw + $cost_w1_raw + $cost_out_raw) / 1000000; printf \"\$%6.2f\", v }")

# Compact human token formatter: 1234 → "1.2k", 1234567 → "1.2M"
# Optional second arg: right-pad to width (e.g., fmt_tok 10 6 → "    10")
fmt_tok() {
  local n="${1:-0}" width="${2:-0}"
  local result
  if [ "$n" -ge 1000000 ]; then
    result=$(awk "BEGIN { printf \"%.1fM\", $n / 1000000 }")
  elif [ "$n" -ge 1000 ]; then
    result=$(awk "BEGIN { printf \"%.1fk\", $n / 1000 }")
  else
    result="$n"
  fi
  if [ "$width" -gt 0 ]; then
    printf "%${width}s" "$result"
  else
    echo "$result"
  fi
}

# --- Color scheme matching the bar segments (labels & bar use same color per category) ---
c_in="\033[33m"      # yellow  — fresh input
c_cached="\033[32m"  # green   — cache hits (cheap)
c_wr="\033[31m"    # red     — cache write (expensive)
c_out="\033[35m"   # magenta — output
cyan="\033[36m"

# Stacked cost-share bar of width W. Segments ∝ each component's $ contribution.
# Non-zero segments get ≥1 char. Colors: yellow=in, green=cached, red=wr, magenta=out.
make_cost_bar() {
  local w="$1" c_in_v="$2" c_rd_v="$3" c_wr_v="$4" c_out_v="$5"
  awk -v w="$w" -v ci="$c_in_v" -v cr="$c_rd_v" -v cw="$c_wr_v" -v co="$c_out_v" \
      -v esc_in="$c_in" -v esc_rd="$c_cached" -v esc_wr="$c_wr" -v esc_out="$c_out" \
      -v esc_reset="$reset" -v esc_dim="$dim" '
  BEGIN {
    tot = ci + cr + cw + co
    if (tot <= 0) { exit }
    # Real-valued widths
    rw_i = ci / tot * w; rw_r = cr / tot * w; rw_w = cw / tot * w; rw_o = co / tot * w
    # Floor, then enforce min=1 for any non-zero component, then distribute remainder by frac.
    ni = (ci > 0 ? (int(rw_i) > 0 ? int(rw_i) : 1) : 0)
    nr = (cr > 0 ? (int(rw_r) > 0 ? int(rw_r) : 1) : 0)
    nw = (cw > 0 ? (int(rw_w) > 0 ? int(rw_w) : 1) : 0)
    no = (co > 0 ? (int(rw_o) > 0 ? int(rw_o) : 1) : 0)
    used = ni + nr + nw + no
    # If under-allocated, give remaining chars to the largest fractional parts.
    while (used < w) {
      max_f = -1; pick = ""
      f_i = rw_i - int(rw_i); f_r = rw_r - int(rw_r); f_w = rw_w - int(rw_w); f_o = rw_o - int(rw_o)
      if (ci > 0 && f_i > max_f) { max_f = f_i; pick = "i" }
      if (cr > 0 && f_r > max_f) { max_f = f_r; pick = "r" }
      if (cw > 0 && f_w > max_f) { max_f = f_w; pick = "w" }
      if (co > 0 && f_o > max_f) { max_f = f_o; pick = "o" }
      if      (pick == "i") { ni++; rw_i = int(rw_i) }
      else if (pick == "r") { nr++; rw_r = int(rw_r) }
      else if (pick == "w") { nw++; rw_w = int(rw_w) }
      else if (pick == "o") { no++; rw_o = int(rw_o) }
      else break
      used++
    }
    # If over-allocated, trim from smallest segments.
    while (used > w) {
      if      (no > 1) { no--; used-- }
      else if (nw > 1) { nw--; used-- }
      else if (nr > 1) { nr--; used-- }
      else if (ni > 1) { ni--; used-- }
      else break
    }
    bar = ""
    if (ni > 0) { bar = bar esc_in;  for (i=0; i<ni; i++) bar = bar "█" }
    if (nr > 0) { bar = bar esc_rd;  for (i=0; i<nr; i++) bar = bar "█" }
    if (nw > 0) { bar = bar esc_wr;  for (i=0; i<nw; i++) bar = bar "█" }
    if (no > 0) { bar = bar esc_out; for (i=0; i<no; i++) bar = bar "█" }
    bar = bar esc_reset
    printf "%s", bar
  }'
}

# --- Cumulative breakdown (Σ) and last-call breakdown (last) ---
tokens_part=""
if [ "$sum_out" != "0" ] || [ "$sum_in" != "0" ] || [ "$sum_rd" != "0" ] || [ "$sum_wr" != "0" ]; then
  # Per-category $ — accumulated per-turn at each turn's actual model rate.
  cost_in=$(awk "BEGIN { printf \"%.6f\", $cost_in_raw / 1000000 }")
  cost_rd=$(awk "BEGIN { printf \"%.6f\", $cost_rd_raw / 1000000 }")
  cost_wr=$(awk "BEGIN { printf \"%.6f\", ($cost_w5_raw + $cost_w1_raw) / 1000000 }")
  cost_out=$(awk "BEGIN { printf \"%.6f\", $cost_out_raw / 1000000 }")
  bar=$(make_cost_bar 20 "$cost_in" "$cost_rd" "$cost_wr" "$cost_out")
  tokens_part="${cyan}Σ    ${reset} ${c_in}in:$(fmt_tok $sum_in 6)${reset} ${c_cached}cached:$(fmt_tok $sum_rd 6)${reset} ${c_wr}wr:$(fmt_tok $sum_wr 6)${reset} ${c_out}out:$(fmt_tok $sum_out 6)${reset} ${dim}≈${reset}${est_cost} ${bar}"
fi
last_part=""
if [ "$last_out" != "0" ] || [ "$last_in" != "0" ] || [ "$last_rd" != "0" ] || [ "$last_wr" != "0" ]; then
  # Current model's pricing for the most recent call (single turn → current model).
  case "$model_id" in
    *opus-4-7*|*opus-4-6*|*opus-4-5*)        lp_in=5;  lp_w=10; lp_rd=0.50; lp_out=25 ;;
    *opus-4-1*|*opus-4-0*|*opus-4*)          lp_in=15; lp_w=30; lp_rd=1.50; lp_out=75 ;;
    *sonnet-4-6*|*sonnet-4-5*|*sonnet-4*)    lp_in=3;  lp_w=6;  lp_rd=0.30; lp_out=15 ;;
    *haiku-4-5*|*haiku-4*)                   lp_in=1;  lp_w=2;  lp_rd=0.10; lp_out=5  ;;
    *)                                       lp_in=5;  lp_w=10; lp_rd=0.50; lp_out=25 ;;
  esac
  # The input JSON doesn't split cache_creation by 5m vs 1h — use the 1h rate as upper bound.
  l_cost_in=$(awk  "BEGIN { printf \"%.6f\", $last_in  * $lp_in  / 1000000 }")
  l_cost_rd=$(awk  "BEGIN { printf \"%.6f\", $last_rd  * $lp_rd  / 1000000 }")
  l_cost_wr=$(awk  "BEGIN { printf \"%.6f\", $last_wr  * $lp_w   / 1000000 }")
  l_cost_out=$(awk "BEGIN { printf \"%.6f\", $last_out * $lp_out / 1000000 }")
  last_est=$(awk   "BEGIN { v = $l_cost_in + $l_cost_rd + $l_cost_wr + $l_cost_out; printf \"\$%6.2f\", v }")
  last_bar=$(make_cost_bar 20 "$l_cost_in" "$l_cost_rd" "$l_cost_wr" "$l_cost_out")
  last_part="${dim}last ${reset} ${c_in}in:$(fmt_tok $last_in 6)${reset} ${c_cached}cached:$(fmt_tok $last_rd 6)${reset} ${c_wr}wr:$(fmt_tok $last_wr 6)${reset} ${c_out}out:$(fmt_tok $last_out 6)${reset} ${dim}≈${reset}${last_est} ${last_bar}"
fi

# --- Runtime env marker (WSL2 / native Windows / Linux / macOS) ---
# Distinguishes WSL2 (bash on Linux kernel with microsoft tag) from native Windows
# bash (Git Bash / MSYS / Cygwin) so it's obvious which shell Claude Code is using.
env_marker=""
if [ -r /proc/version ] && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
  env_marker="\033[1;32m● WSL2\033[0m"        # bold green — the safe one on Windows hosts
elif [ -n "$WSL_DISTRO_NAME" ] || [ -n "$WSL_INTEROP" ]; then
  env_marker="\033[1;32m● WSL2\033[0m"
elif [ -n "$WINDIR" ] || [ -n "$SYSTEMROOT" ] || [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* || "$OSTYPE" == win32* ]]; then
  env_marker="\033[1;33m● WIN (native)\033[0m" # bold yellow — Windows-native bash, sandbox limited
elif [[ "$OSTYPE" == darwin* ]]; then
  env_marker="${dim}● macOS${reset}"
else
  env_marker="${dim}● Linux${reset}"
fi
version_part="$env_marker"

# --- Clock (local wall time, refreshed each statusline render) ---
clock_part="\033[36m🕐 $(date '+%H:%M:%S')\033[0m"
version_part="${version_part}${sep}${clock_part}"

# --- Version stamp: script's own mtime, so you can see when edits take effect ---
script_mtime=$(stat -c %Y "${BASH_SOURCE[0]}" 2>/dev/null || stat -f %m "${BASH_SOURCE[0]}" 2>/dev/null)
if [ -n "$script_mtime" ]; then
  vstamp="${dim}v:$(date -d "@$script_mtime" '+%Y%m%d %H:%M:%S' 2>/dev/null || date -r "$script_mtime" '+%Y%m%d %H:%M:%S' 2>/dev/null)${reset}"
  version_part="${version_part}${sep}${vstamp}"
fi


# --- Assemble line 2: sess: branch · PR · cwd · cost · lines · duration · api ---
# "sess:" is kept as a column-header prefix to align with "Σ    " and "last " below.
line2_parts=()
[ -n "$branch" ]        && line2_parts+=("${bold}${branch}${reset}")
[ -n "$pr_part" ]       && line2_parts+=("$pr_part")
[ -n "$short_cwd" ]     && line2_parts+=("${dim}${short_cwd}${reset}")
[ -n "$cost_part" ]     && line2_parts+=("$cost_part")
[ -n "$lines_part" ]    && line2_parts+=("$lines_part")
[ -n "$duration_part" ] && line2_parts+=("$duration_part")
[ -n "$api_part" ]      && line2_parts+=("$api_part")

line2=""
for p in "${line2_parts[@]}"; do
  [ -z "$line2" ] && line2="$p" || line2="${line2}${sep}${p}"
done
# Prepend the "sess: " column-header (aligned with "Σ     " and "last  ")
line2="${cyan}sess:${reset} ${line2}"

# --- Output ---
# line 3 = cumulative breakdown (Σ), line 4 = last-call breakdown
echo -e "$line1"
[ -n "$line2" ]        && echo -e "$line2"
[ -n "$tokens_part" ]  && echo -e "$tokens_part"
[ -n "$last_part" ]    && echo -e "$last_part"
[ -n "$version_part" ] && echo -e "$version_part"
