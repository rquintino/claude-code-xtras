#!/usr/bin/env bash
# Claude Code status line:
#   line 1: ctx · model [effort] ·think · 5h · 7d
#   line 2: branch · PR · cwd · cost · lines · ⏱ duration · api
#   line 3: Σ in/cached/wr/out [cost bar]
#   line 4: last in/cached/wr/out [cost bar]
#   line 5: cmp  compaction advisor (cost / saving per request / payback, cold-cache signal)
#   line 6: os · time · version timestamp

input=$(cat)

# Windows jq builds emit CRLF — strip CR so mapfile fields and $(( )) math work under Git Bash
jq() { command jq "$@" | tr -d '\r'; }

# fmt_num <x> <decimals> [group] — rounds half away from zero on 15 significant digits,
# like .NET '{0:F2}' / '{0:N0}' in statusline.ps1 (awk printf alone rounds 0.475 -> 0.47).
# group=1 adds thousands separators (N format).
fmt_num() {
  awk -v x="$1" -v d="$2" -v g="${3:-0}" 'BEGIN {
    neg = (x < 0); if (neg) x = -x
    m = 10 ^ d; v = int(sprintf("%.15g", x * m) + 0.5) / m
    s = sprintf("%." d "f", v)
    if (g) { i = index(s, "."); ip = i ? substr(s, 1, i - 1) : s; fp = i ? substr(s, i) : ""
             o = ""; while (length(ip) > 3) { o = "," substr(ip, length(ip) - 2) o; ip = substr(ip, 1, length(ip) - 3) }
             s = ip o fp }
    if (neg && s + 0 != 0) s = "-" s
    print s }'
}

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
  (.exceeds_200k_tokens  // false),
  (if .context_window.current_usage == null then "" else "1" end),
  (.prompt_cache.ttl        // ""),
  (.prompt_cache.warm       | if . == null then "" else tostring end),
  (.prompt_cache.expires_at // "")
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
has_cur_usage="${F[25]}"
pc_ttl="${F[26]}"
pc_warm="${F[27]}"
pc_expires="${F[28]}"

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
short_cwd="${short_cwd//\\//}"   # Windows cwd (Git Bash) arrives as D:\a\b — same as the .ps1
leaf=$(basename "$short_cwd")
if [[ "$short_cwd" == "~/"*"/"* ]]; then
  short_cwd="~/.../${leaf}"
elif [[ "$short_cwd" == /*/*/* || "$short_cwd" == [A-Za-z]:/*/*/* ]]; then
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
  conv_cost=$(fmt_num "$cost" 2 1)
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
# Linear projection of usage% at window end, from current% and elapsed fraction of the
# window. Args: pct, reset_at (epoch or ISO8601), window_days. Empty output if too early.
predict_eow() {
  local pct="$1" reset_at="$2" window_days="$3" now target
  { [ -z "$reset_at" ] || [ "$reset_at" = "null" ]; } && return
  if [[ "$reset_at" =~ ^[0-9]+$ ]]; then
    target="$reset_at"
  else
    # GNU date (-d) on Linux/WSL2; fall back to BSD date (-j -f) on macOS.
    target=$(date -d "$reset_at" +%s 2>/dev/null \
      || date -j -f "%Y-%m-%dT%H:%M:%S" "${reset_at%%[.+Z]*}" +%s 2>/dev/null)
  fi
  [ -z "$target" ] && return
  now=$(date +%s)
  awk -v p="$pct" -v t="$target" -v now="$now" -v wd="$window_days" '
    BEGIN {
      remaining = t - now
      if (remaining <= 0) exit 1
      window_sec = wd * 86400.0
      elapsed = window_sec - remaining
      if (elapsed <= window_sec * 0.05) exit 1
      printf "%.0f", p / (elapsed / window_sec)
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
  part="${dim}5h:${reset}${c}${bar} ${v}%${reset}"
  [ -n "$eta" ] && part="${part}${dim}·${eta}${reset}"
  rate_parts+=("$part")
fi
if [ -n "$seven_d" ] && [ "$seven_d" != "null" ]; then
  v=$(printf '%.0f' "$seven_d")
  c=$(color_for_pct "$v")
  bar=$(make_pct_bar "$v" 8)
  eta=$(fmt_eta "$seven_d_reset")
  part="${dim}7d:${reset}${c}${bar} ${v}%${reset}"
  [ -n "$eta" ] && part="${part}${dim}·${eta}${reset}"
  # Linear end-of-window projection: red ≥115%, green ≥85% (on pace), cyan otherwise.
  pred=$(predict_eow "$v" "$seven_d_reset" 7)
  if [ -n "$pred" ]; then
    if   [ "$pred" -ge 115 ]; then pcol="\033[31m"
    elif [ "$pred" -ge 85 ];  then pcol="\033[32m"
    else                           pcol="\033[36m"; fi
    part="${part} ${dim}proj:${reset}${pcol}${pred}%${reset}"
  fi
  rate_parts+=("$part")
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
  model_label="\033[1;96m${display_name}${reset}"
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
# Cache format v3: includes per-category cost (in token·$/MTok units).
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
  if [ -n "$tmtime" ] && [ "$tmtime" = "$cached_mtime" ] && [ "$cached_version" = "3" ]; then
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
      # $/MTok — source: platform.claude.com/docs/en/about-claude/pricing (checked 2026-09-26)
      # Cache reads: 0.1x input, except Fable/Mythos 5.1 (0.025x) and Opus 5.5 (0.05x).
      # Fast mode (Opus 5.5 / Opus 5 / Opus 4.8) = 2x on every category.
      def price(m; speed):
        (if   (m | test("opus-5-5"))            then {i:4,    w5:5,     w1:8,    r:0.20, o:20}
         elif (m | test("(fable|mythos)-5-1"))  then {i:10,   w5:12.50, w1:20,   r:0.25, o:50}
         elif (m | test("(fable|mythos)-5"))    then {i:10,   w5:12.50, w1:20,   r:1.00, o:50}
         elif (m | test("opus-5|opus-4-[5-9]")) then {i:5,    w5:6.25,  w1:10,   r:0.50, o:25}
         elif (m | test("opus-4"))              then {i:15,   w5:18.75, w1:30,   r:1.50, o:75}
         elif (m | test("sonnet-5"))            then {i:2,    w5:2.50,  w1:4,    r:0.20, o:10}
         elif (m | test("sonnet-4"))            then {i:3,    w5:3.75,  w1:6,    r:0.30, o:15}
         elif (m | test("haiku-4"))             then {i:1,    w5:1.25,  w1:2,    r:0.10, o:5}
         elif (m | test("haiku-3-5"))           then {i:0.80, w5:1,     w1:1.60, r:0.08, o:4}
         else                                        {i:5,    w5:6.25,  w1:10,   r:0.50, o:25}
         end) as $p
        | if speed == "fast" and (m | test("opus-5|opus-4-8")) then $p | map_values(. * 2) else $p end;
      map(select(.type == "assistant"))
      | group_by(.requestId)
      | map(.[0] | {u: (.message.usage // {}), p: price(.message.model // ""; .message.usage.speed // "")})
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
    printf 'v=3\nmtime=%s\nin=%s\nrd=%s\nw5=%s\nw1=%s\nout=%s\nci=%s\ncr=%s\ncw5=%s\ncw1=%s\nco=%s\n' \
      "$tmtime" "$sum_in" "$sum_rd" "$sum_w5" "$sum_w1" "$sum_out" \
      "$cost_in_raw" "$cost_rd_raw" "$cost_w5_raw" "$cost_w1_raw" "$cost_out_raw" > "$tcache"
  fi
fi
sum_wr=$(( sum_w5 + sum_w1 ))

# Estimated $ at published API rates, summed per-turn with each turn's model price.
# Format as right-padded to 7 chars: "$  0.01", "$ 15.19", etc.
est_cost=$(printf '$%6s' "$(fmt_num "$(awk "BEGIN { print ($cost_in_raw + $cost_rd_raw + $cost_w5_raw + $cost_w1_raw + $cost_out_raw) / 1000000 }")" 2)")

# Compact human token formatter: 1234 → "1.2k", 1234567 → "1.2M"
# Optional second arg: right-pad to width (e.g., fmt_tok 10 6 → "    10")
fmt_tok() {
  local n="${1:-0}" width="${2:-0}"
  local result
  if [ "$n" -ge 1000000 ]; then
    result="$(fmt_num "${n}e-6" 1)M"
  elif [ "$n" -ge 1000 ]; then
    result="$(fmt_num "${n}e-3" 1)k"
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

# $/MTok for one model id — sets p_i p_w5 p_w1 p_r p_o. Same table as the jq price() above.
# Order matters: more specific ids first ('opus-5-5' before 'opus-5', 'fable-5-1' before 'fable-5').
price_of() {
  case "$1" in
    *opus-5-5*)                     set -- 4    5     8    0.20 20 ;;
    *fable-5-1*|*mythos-5-1*)       set -- 10   12.50 20   0.25 50 ;;
    *fable-5*|*mythos-5*)           set -- 10   12.50 20   1.00 50 ;;
    *opus-5*|*opus-4-[5-9]*)        set -- 5    6.25  10   0.50 25 ;;
    *opus-4*)                       set -- 15   18.75 30   1.50 75 ;;
    *sonnet-5*)                     set -- 2    2.50  4    0.20 10 ;;
    *sonnet-4*)                     set -- 3    3.75  6    0.30 15 ;;
    *haiku-4*)                      set -- 1    1.25  2    0.10 5  ;;
    *haiku-3-5*)                    set -- 0.80 1     1.60 0.08 4  ;;
    *)                              set -- 5    6.25  10   0.50 25 ;;
  esac
  p_i=$1; p_w5=$2; p_w1=$3; p_r=$4; p_o=$5
}

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
  price_of "$model_id"
  lp_in=$p_i; lp_w=$p_w1; lp_rd=$p_r; lp_out=$p_o
  # The input JSON doesn't split cache_creation by 5m vs 1h — use the 1h rate as upper bound.
  l_cost_in=$(awk  "BEGIN { printf \"%.6f\", $last_in  * $lp_in  / 1000000 }")
  l_cost_rd=$(awk  "BEGIN { printf \"%.6f\", $last_rd  * $lp_rd  / 1000000 }")
  l_cost_wr=$(awk  "BEGIN { printf \"%.6f\", $last_wr  * $lp_w   / 1000000 }")
  l_cost_out=$(awk "BEGIN { printf \"%.6f\", $last_out * $lp_out / 1000000 }")
  last_est=$(printf '$%6s' "$(fmt_num "$(awk "BEGIN { print $l_cost_in + $l_cost_rd + $l_cost_wr + $l_cost_out }")" 2)")
  last_bar=$(make_cost_bar 20 "$l_cost_in" "$l_cost_rd" "$l_cost_wr" "$l_cost_out")
  last_part="${dim}last ${reset} ${c_in}in:$(fmt_tok $last_in 6)${reset} ${c_cached}cached:$(fmt_tok $last_rd 6)${reset} ${c_wr}wr:$(fmt_tok $last_wr 6)${reset} ${c_out}out:$(fmt_tok $last_out 6)${reset} ${dim}≈${reset}${last_est} ${last_bar}"
fi

# --- Compaction advisor: what /compact would cost and save, at API list prices ---
# Counted per API REQUEST (an agentic prompt fans out into many, each re-reading the full context).
#   C = current context, B = prefix that stays cached across compaction (system prompt + tools,
#   ~= first request of the session), S = estimated post-compact context = B + summary + re-attached files/skills
#   Warm: upfront U = C*r (summarize call reads cache) + O*o (summary + thinking) + (S-B)*w (re-cache)
#         saving per later request D = (C-S)*r   ->  pays back after N = U/D requests
#   Cold: the next request re-writes C at w anyway; compacting instead costs C*w5 + O*o + S*w
#         net now = C*w - (C*w5 + O*o + S*w)  -> positive = compact before continuing
# Sources: code.claude.com/docs/en/prompt-caching (#compacting-the-conversation, #cache-lifetime),
#          code.claude.com/docs/en/context-window (what survives compaction).
CMP_SUMMARY_OUT=8000    # assumption: summary + thinking output tokens of the compaction call
CMP_REATTACH=20000      # assumption: re-read files (<=5 x <=5k) + skill bodies (<=25k) + summary text
CMP_BASE_DEF=20000      # B when the transcript can't tell us
CMP_MIN_CTX=60000       # below this, compaction isn't worth discussing

c_green="\033[32m"; c_yellow="\033[33m"; c_red="\033[31m"
# 1234567 -> "1,235k" (PowerShell '{0:N0}k')
fmt_k() { echo "$(fmt_num "${1}e-3" 0 1)k"; }

cmp_part=""
if [ -z "$has_cur_usage" ]; then
  # null before the first request and right after /compact
  cmp_part="${cyan}cmp  ${reset} ${dim}fresh context${reset}"
else
  C=$(( last_in + last_rd + last_wr ))
  B=$CMP_BASE_DEF
  if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    # first() stops reading at the first assistant request that carries usage
    b_first=$(jq -rn 'first(inputs | select(.type == "assistant") | .message.usage | select(. != null)
      | ((.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0)))' \
      "$transcript_path" 2>/dev/null)
    [ -n "$b_first" ] && B=$b_first
  fi
  S=$(( B + CMP_REATTACH ))

  if [ "$C" -ge "$CMP_MIN_CTX" ] && [ "$C" -gt "$S" ]; then
    price_of "$model_id"
    [ "$pc_ttl" = "5m" ] && w=$p_w5 || w=$p_w1
    now=$(date +%s)
    cold=0
    [ "$pc_warm" = "false" ] && cold=1
    [ -n "$pc_expires" ] && [ "${pc_expires%.*}" -le "$now" ] 2>/dev/null && cold=1

    delta=$(awk "BEGIN { print ($C - $S) * $p_r / 1000000 }")
    delta_s=$(fmt_num "$delta" 3)
    shrink="${dim}$(fmt_k $C)->~$(fmt_k $S)${reset}"

    if [ "$cold" = 1 ]; then
      net=$(awk "BEGIN { print ($C * $w - ($C * $p_w5 + $CMP_SUMMARY_OUT * $p_o + $S * $w)) / 1000000 }")
      if awk "BEGIN { exit !($net > 0) }"; then
        cmp_part="${cyan}cmp  ${reset} ${c_green}cold, compact now: ~\$$(fmt_num "$net" 2) cheaper than resuming${reset} ${dim}then saves \$${delta_s}/req${reset} $shrink"
      else
        cmp_part="${cyan}cmp  ${reset} ${c_yellow}cold, compact costs ~\$$(fmt_num "$(awk "BEGIN { print -($net) }")" 2) extra, then saves \$${delta_s}/req${reset} $shrink"
      fi
    else
      U=$(awk "BEGIN { print ($C * $p_r + $CMP_SUMMARY_OUT * $p_o + ($S - $B) * $w) / 1000000 }")
      N=$(awk "BEGIN { q = $U / $delta; n = int(q); if (n < q) n++; print n }")
      if   [ "$N" -le 10 ]; then nc=$c_green
      elif [ "$N" -le 30 ]; then nc=$c_yellow
      else                       nc=$dim
      fi
      ttl_left=""
      if [ -n "$pc_expires" ]; then
        # PowerShell's [int] cast rounds half to even — so does awk %.0f
        ttl_left=" ${dim}(cold in $(awk "BEGIN { printf \"%.0f\", (${pc_expires} - $now) / 60 }")m)${reset}"
      fi
      cmp_part="${cyan}cmp  ${reset} ${dim}warm${reset}${ttl_left} ${dim}cost${reset} \$$(fmt_num "$U" 2) ${dim}saves${reset} \$${delta_s}/req ${nc}pays back in $N req${reset} $shrink"
    fi

    [ "$C" -gt 200000 ] && cmp_part="${cmp_part} ${c_red}>200k: recall degrades${reset}"
    if [ "$ctx_size" -gt 0 ] 2>/dev/null && awk "BEGIN { exit !($C / $ctx_size >= 0.85) }"; then
      cmp_part="${cmp_part} ${c_yellow}auto-compact near${reset}"
    fi
  else
    cmp_part="${cyan}cmp  ${reset} ${dim}context small, no benefit${reset}"
  fi
fi

# --- Runtime env marker: green dot + dim OS name (WSL2 tagged with distro) ---
# Distinguishes WSL2 (bash on Linux kernel with microsoft tag) from native Windows
# bash (Git Bash / MSYS / Cygwin) so it's obvious which shell Claude Code is using.
os_name=""
if { [ -r /proc/version ] && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; } \
   || [ -n "$WSL_DISTRO_NAME" ] || [ -n "$WSL_INTEROP" ]; then
  os_name="WSL2${WSL_DISTRO_NAME:+ ($WSL_DISTRO_NAME)}"
elif [[ "$OSTYPE" == darwin* ]]; then
  os_name="macOS $(sw_vers -productVersion 2>/dev/null)"
elif [ -n "$WINDIR" ] || [ -n "$SYSTEMROOT" ] || [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* || "$OSTYPE" == win32* ]]; then
  # uname on Git Bash/MSYS/Cygwin embeds the build, e.g. MINGW64_NT-10.0-22631.
  # Win11 keeps major 10.0, so map by build (>=22000 → 11), like the .ps1. Cheap, no cmd spawn.
  # Match the "-<build>" suffix specifically: forms like MINGW32_NT-6.1 or MINGW64_NT-10.0
  # (no dash-build) must yield empty, not a stray trailing digit (e.g. 6.1 → "1", 10.0 → "0").
  win_build=$(uname -s 2>/dev/null | grep -oE '[-][0-9]+$' | tr -d '-')
  if [ -n "$win_build" ] && [ "$win_build" -ge 22000 ] 2>/dev/null; then
    os_name="Windows 11 (build $win_build) [native]"
  elif [ -n "$win_build" ]; then
    os_name="Windows 10 (build $win_build) [native]"
  else
    os_name="Windows (native)"
  fi
elif [ -r /etc/os-release ]; then
  os_name=$( . /etc/os-release 2>/dev/null; echo "$PRETTY_NAME" )
fi
[ -z "$os_name" ] && os_name="Linux"
env_marker="\033[32m●${reset} ${dim}${os_name}${reset}"
version_part="$env_marker"

# --- Clock (local wall time, refreshed each statusline render) ---
clock_part="${dim}🕐 $(date '+%H:%M:%S')${reset}"
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
[ -n "$cmp_part" ]     && echo -e "$cmp_part"
[ -n "$version_part" ] && echo -e "$version_part"
