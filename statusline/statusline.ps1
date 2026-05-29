# Claude Code status line (PowerShell port, targets PS 5.1+)
#   line 1: ctx · model [effort] ·think · 5h · 7d
#   line 2: branch · PR · cwd · cost · lines · ⏱ duration · api
#   line 3: Σ in/cached/wr/out [cost bar]
#   line 4: last in/cached/wr/out [cost bar]
#   line 5: version timestamp

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# --- Read JSON from stdin ---
$raw = [Console]::In.ReadToEnd()
try { $j = $raw | ConvertFrom-Json } catch { $j = $null }
if ($null -eq $j) { exit 0 }

function Get-Prop {
    param($obj, [string]$path, $default = $null)
    $cur = $obj
    foreach ($p in $path -split '\.') {
        if ($null -eq $cur) { return $default }
        $cur = $cur.PSObject.Properties[$p]
        if ($null -eq $cur) { return $default }
        $cur = $cur.Value
    }
    if ($null -eq $cur) { return $default } else { return $cur }
}

$model_id         = [string](Get-Prop $j 'model.id' '')
$display_name     = [string](Get-Prop $j 'model.display_name' '')
$cwd              = [string](Get-Prop $j 'workspace.current_dir' (Get-Prop $j 'cwd' ''))
$cost             = [double](Get-Prop $j 'cost.total_cost_usd' 0)
$session_id       = [string](Get-Prop $j 'session_id' '')
$duration_ms      = [long](Get-Prop $j 'cost.total_duration_ms' 0)
$api_duration_ms  = [long](Get-Prop $j 'cost.total_api_duration_ms' 0)
$pct              = Get-Prop $j 'context_window.used_percentage' -1
$ctx_size         = [long](Get-Prop $j 'context_window.context_window_size' 200000)
$five_h           = Get-Prop $j 'rate_limits.five_hour.used_percentage' ''
$seven_d          = Get-Prop $j 'rate_limits.seven_day.used_percentage' ''
$five_h_reset     = Get-Prop $j 'rate_limits.five_hour.resets_at' ''
$seven_d_reset    = Get-Prop $j 'rate_limits.seven_day.resets_at' ''
$lines_added      = [long](Get-Prop $j 'cost.total_lines_added' 0)
$lines_removed    = [long](Get-Prop $j 'cost.total_lines_removed' 0)
$pr_number        = Get-Prop $j 'pr.number' ''
$pr_state         = [string](Get-Prop $j 'pr.review_state' '')
$transcript_path  = [string](Get-Prop $j 'transcript_path' '')
$last_in          = [long](Get-Prop $j 'context_window.current_usage.input_tokens' 0)
$last_rd          = [long](Get-Prop $j 'context_window.current_usage.cache_read_input_tokens' 0)
$last_wr          = [long](Get-Prop $j 'context_window.current_usage.cache_creation_input_tokens' 0)
$last_out         = [long](Get-Prop $j 'context_window.current_usage.output_tokens' 0)
$effort_level     = [string](Get-Prop $j 'effort.level' '')
$thinking_enabled = [bool](Get-Prop $j 'thinking.enabled' $false)
$exceeds_200k     = [bool](Get-Prop $j 'exceeds_200k_tokens' $false)

# --- Colors (ANSI via ESC = [char]27, PS 5.1 safe) ---
$e       = [char]27
$reset   = "$e[0m"
$dim     = "$e[2m"
$bold    = "$e[1m"
$sep     = "$dim · $reset"
$cyan    = "$e[36m"
$c_in    = "$e[33m"  # yellow  — fresh input
$c_cached= "$e[32m"  # green   — cache hits
$c_wr    = "$e[31m"  # red     — cache write
$c_out   = "$e[35m"  # magenta — output

# --- Git branch ---
if ([string]::IsNullOrEmpty($cwd)) { $cwd = (Get-Location).Path }
$branch = ''
if (Test-Path -LiteralPath $cwd) {
    $env:GIT_OPTIONAL_LOCKS = '0'
    $branch = (& git -C $cwd symbolic-ref --short HEAD 2>$null)
    if ([string]::IsNullOrEmpty($branch)) {
        $branch = (& git -C $cwd rev-parse --short HEAD 2>$null)
    }
    if ($null -eq $branch) { $branch = '' } else { $branch = $branch.Trim() }
}

# --- Collapsed cwd ---
$home_dir = $env:USERPROFILE
$short_cwd = $cwd
if (-not [string]::IsNullOrEmpty($home_dir) -and $cwd.StartsWith($home_dir, [StringComparison]::OrdinalIgnoreCase)) {
    $short_cwd = '~' + $cwd.Substring($home_dir.Length)
}
$short_cwd = $short_cwd -replace '\\', '/'
$leaf = Split-Path -Leaf $short_cwd
if ($short_cwd -match '^~/[^/]+/.+') {
    $short_cwd = "~/.../$leaf"
} elseif ($short_cwd -match '^[A-Za-z]:/[^/]+/[^/]+/.+' -or $short_cwd -match '^/[^/]+/[^/]+/.+') {
    $short_cwd = "/.../$leaf"
}

# --- Context window ---
$pct_int = 0
try { $pct_int = [int][math]::Round([double]$pct) } catch { $pct_int = 0 }
$ctx_part = ''
if ($null -ne $pct -and "$pct" -ne '-1' -and $pct_int -ge 0) {
    $max_k  = [int]($ctx_size / 1000)
    $used_k = [int]($pct_int * $max_k / 100)
    if     ($pct_int -ge 80) { $cc = "$e[31m" }
    elseif ($pct_int -ge 50) { $cc = "$e[33m" }
    else                     { $cc = "$e[32m" }
    $alarm = ''
    if ($exceeds_200k) {
        $alarm = "$e[31m⚠ $reset"
        $cc = "$e[31m"
    }
    $ctx_part = "${alarm}${cc}ctx:  ${pct_int}% [${used_k}k/${max_k}k]${reset}"
} else {
    $ctx_part = "${dim}ctx:  --${reset}"
}

# --- Effort + thinking badges ---
$effort_part = ''
switch ($effort_level) {
    'max'    { $effort_part = "$e[1;31m[max]$reset" }
    'xhigh'  { $effort_part = "$e[31m[xhigh]$reset" }
    'high'   { $effort_part = "$e[33m[high]$reset" }
    'medium' { $effort_part = "${dim}[medium]${reset}" }
    'low'    { $effort_part = "${dim}[low]${reset}" }
}
$thinking_part = ''
if ($thinking_enabled) { $thinking_part = "${dim}·think${reset}" }

# --- Conversation cost ---
$cost_part = ''
if ($cost -gt 0) {
    $cost_part = "cost:`$" + ('{0:N2}' -f $cost)
}

# --- Duration ---
$duration_part = ''
if ($duration_ms -gt 0) {
    $dur_sec = [int]($duration_ms / 1000)
    $mins = [int]($dur_sec / 60); $secs = $dur_sec % 60
    $duration_part = "${dim}⏱ ${mins}m ${secs}s${reset}"
}
$api_part = ''
if ($api_duration_ms -gt 0) {
    $api_sec = [int]($api_duration_ms / 1000)
    $api_mins = [int]($api_sec / 60); $api_secs = $api_sec % 60
    $api_part = "${dim}⚡ ${api_mins}m ${api_secs}s${reset}"
}

# --- Helpers ---
function Color-Pct([int]$v) {
    if     ($v -ge 80) { return "$e[31m" }
    elseif ($v -ge 50) { return "$e[33m" }
    else               { return "$e[32m" }
}
function Make-PctBar([int]$pct, [int]$w) {
    $filled = [int][math]::Round($pct * $w / 100.0)
    if ($filled -gt $w) { $filled = $w }
    if ($filled -lt 0)  { $filled = 0 }
    return ([string][char]0x2588) * $filled + ([string][char]0x2591) * ($w - $filled)
}
function Fmt-Eta([string]$target) {
    if ([string]::IsNullOrEmpty($target) -or $target -eq 'null') { return '' }
    if ($target -match '^\d+$') {
        try { $t = [DateTimeOffset]::FromUnixTimeSeconds([long]$target) } catch { return '' }
    } else {
        try { $t = [DateTimeOffset]::Parse($target) } catch { return '' }
    }
    $diff = [int]($t.ToUnixTimeSeconds() - [DateTimeOffset]::Now.ToUnixTimeSeconds())
    if ($diff -le 0) { return '' }
    if ($diff -ge 86400) {
        $d = [int]($diff / 86400); $h = [int](($diff % 86400) / 3600)
        return "${d}d${h}h"
    } elseif ($diff -ge 3600) {
        $h = [int]($diff / 3600); $m = [int](($diff % 3600) / 60)
        return "${h}h${m}m"
    } else {
        return "$([int]($diff / 60))m"
    }
}

# --- Rate limits ---
$rate_parts = @()
foreach ($pair in @(@('5h', $five_h, $five_h_reset), @('7d', $seven_d, $seven_d_reset))) {
    $label = $pair[0]; $val = $pair[1]; $reset_at = $pair[2]
    $has_val = ($null -ne $val -and "$val" -ne '' -and "$val" -ne 'null')
    $eta = Fmt-Eta ([string]$reset_at)
    if ($has_val -or $eta) {
        if ($has_val) { $v = [int][math]::Round([double]$val) } else { $v = 0 }
        $c = Color-Pct $v
        $bar = Make-PctBar $v 8
        if ($eta) {
            $rate_parts += "${dim}${label}:${reset}${c}${bar} ${v}%${reset}${dim}·${eta}${reset}"
        } else {
            $rate_parts += "${dim}${label}:${reset}${c}${bar} ${v}%${reset}"
        }
    }
}
$rate_part = if ($rate_parts.Count -gt 0) { $rate_parts -join ' ' } else { '' }

# --- PR badge ---
$pr_part = ''
if ($null -ne $pr_number -and "$pr_number" -ne '' -and "$pr_number" -ne '0' -and "$pr_number" -ne 'null') {
    switch ($pr_state) {
        'approved'          { $pr_color = "$e[32m" }
        'changes_requested' { $pr_color = "$e[31m" }
        'pending'           { $pr_color = "$e[33m" }
        default             { $pr_color = $dim }
    }
    if ($pr_state -and $pr_state -ne 'null') {
        $pr_part = "${pr_color}PR#${pr_number} (${pr_state})${reset}"
    } else {
        $pr_part = "${pr_color}PR#${pr_number}${reset}"
    }
}

# --- Lines diff ---
$lines_part = ''
if ($lines_added -ne 0 -or $lines_removed -ne 0) {
    $lines_part = "$e[32m+${lines_added}${reset}${dim}/${reset}$e[31m-${lines_removed}${reset}"
}

# --- Assemble line 1 ---
$line1_parts = @($ctx_part)
if ($display_name) {
    # Match bash: highlight by family — Opus=magenta, Sonnet=cyan, Haiku=green, other=white.
    switch -Regex ($model_id) {
        'opus'   { $model_color = "$e[1;35m"; break }
        'sonnet' { $model_color = "$e[1;36m"; break }
        'haiku'  { $model_color = "$e[1;32m"; break }
        default  { $model_color = "$e[1;37m" }
    }
    $model_label = "${model_color}${display_name}${reset}"
    if ($effort_part)   { $model_label = "$model_label $effort_part" }
    if ($thinking_part) { $model_label = "$model_label$thinking_part" }
    $line1_parts += $model_label
}
if ($rate_part) { $line1_parts += $rate_part }
$line1 = $line1_parts -join $sep

# --- Transcript aggregation (cumulative tokens + per-turn priced cost) ---
function Price-Of([string]$m) {
    if     ($m -match 'opus-4-[567]') { return @{i=5;  w5=6.25;  w1=10; r=0.50; o=25} }
    elseif ($m -match 'opus-4')       { return @{i=15; w5=18.75; w1=30; r=1.50; o=75} }
    elseif ($m -match 'sonnet-4')     { return @{i=3;  w5=3.75;  w1=6;  r=0.30; o=15} }
    elseif ($m -match 'haiku-4')      { return @{i=1;  w5=1.25;  w1=2;  r=0.10; o=5} }
    else                              { return @{i=5;  w5=6.25;  w1=10; r=0.50; o=25} }
}

$sum_in = 0L; $sum_rd = 0L; $sum_w5 = 0L; $sum_w1 = 0L; $sum_out = 0L
$cost_in_raw = 0.0; $cost_rd_raw = 0.0; $cost_w5_raw = 0.0; $cost_w1_raw = 0.0; $cost_out_raw = 0.0

if ($transcript_path -and (Test-Path -LiteralPath $transcript_path) -and $session_id) {
    $state_dir = Join-Path $env:USERPROFILE '.claude\statusline-state'
    if (-not (Test-Path -LiteralPath $state_dir)) {
        New-Item -ItemType Directory -Path $state_dir -Force | Out-Null
    }
    $tcache = Join-Path $state_dir "transcript-$session_id.cache"
    $tmtime = (Get-Item -LiteralPath $transcript_path).LastWriteTimeUtc.Ticks.ToString()

    $use_cache = $false
    if (Test-Path -LiteralPath $tcache) {
        $kv = @{}
        foreach ($ln in Get-Content -LiteralPath $tcache) {
            if ($ln -match '^([^=]+)=(.*)$') { $kv[$matches[1]] = $matches[2] }
        }
        if ($kv['v'] -eq '2' -and $kv['mtime'] -eq $tmtime) {
            $sum_in       = [long]$kv['in']
            $sum_rd       = [long]$kv['rd']
            $sum_w5       = [long]$kv['w5']
            $sum_w1       = [long]$kv['w1']
            $sum_out      = [long]$kv['out']
            $cost_in_raw  = [double]$kv['ci']
            $cost_rd_raw  = [double]$kv['cr']
            $cost_w5_raw  = [double]$kv['cw5']
            $cost_w1_raw  = [double]$kv['cw1']
            $cost_out_raw = [double]$kv['co']
            $use_cache    = $true
        }
    }

    if (-not $use_cache) {
        $seen = @{}
        foreach ($ln in [System.IO.File]::ReadLines($transcript_path)) {
            if ([string]::IsNullOrWhiteSpace($ln)) { continue }
            try { $obj = $ln | ConvertFrom-Json } catch { continue }
            if ($obj.type -ne 'assistant') { continue }
            $rid = [string]$obj.requestId
            if ($rid -and $seen.ContainsKey($rid)) { continue }
            if ($rid) { $seen[$rid] = $true }
            $u = $obj.message.usage
            if ($null -eq $u) { continue }
            $p = Price-Of ([string]$obj.message.model)
            $ti = [long](Get-Prop $u 'input_tokens' 0)
            $tr = [long](Get-Prop $u 'cache_read_input_tokens' 0)
            $t5 = [long](Get-Prop $u 'cache_creation.ephemeral_5m_input_tokens' 0)
            $t1 = [long](Get-Prop $u 'cache_creation.ephemeral_1h_input_tokens' 0)
            $to = [long](Get-Prop $u 'output_tokens' 0)
            $sum_in       += $ti
            $sum_rd       += $tr
            $sum_w5       += $t5
            $sum_w1       += $t1
            $sum_out      += $to
            $cost_in_raw  += ($ti * $p.i)
            $cost_rd_raw  += ($tr * $p.r)
            $cost_w5_raw  += ($t5 * $p.w5)
            $cost_w1_raw  += ($t1 * $p.w1)
            $cost_out_raw += ($to * $p.o)
        }
        $cache_lines = @(
            "v=2",
            "mtime=$tmtime",
            "in=$sum_in", "rd=$sum_rd", "w5=$sum_w5", "w1=$sum_w1", "out=$sum_out",
            "ci=$cost_in_raw", "cr=$cost_rd_raw", "cw5=$cost_w5_raw", "cw1=$cost_w1_raw", "co=$cost_out_raw"
        )
        Set-Content -LiteralPath $tcache -Value $cache_lines -Encoding UTF8
    }
}
$sum_wr = $sum_w5 + $sum_w1
$est_cost_val = ($cost_in_raw + $cost_rd_raw + $cost_w5_raw + $cost_w1_raw + $cost_out_raw) / 1000000.0
$est_cost = '$' + ('{0,6:F2}' -f $est_cost_val)

function Fmt-Tok {
    param([long]$n, [int]$width = 0)
    if     ($n -ge 1000000) { $r = ('{0:F1}M' -f ($n / 1000000.0)) }
    elseif ($n -ge 1000)    { $r = ('{0:F1}k' -f ($n / 1000.0)) }
    else                    { $r = "$n" }
    if ($width -gt 0) { return ('{0,' + $width + '}') -f $r } else { return $r }
}

function Make-CostBar {
    param([int]$w, [double]$ci, [double]$cr, [double]$cw, [double]$co)
    $tot = $ci + $cr + $cw + $co
    if ($tot -le 0) { return '' }
    $rw = @{ i = $ci/$tot*$w; r = $cr/$tot*$w; w = $cw/$tot*$w; o = $co/$tot*$w }
    $vals = @{ i = $ci; r = $cr; w = $cw; o = $co }
    $n = @{ i = 0; r = 0; w = 0; o = 0 }
    foreach ($k in 'i','r','w','o') {
        if ($vals[$k] -gt 0) {
            $f = [int][math]::Floor($rw[$k])
            $n[$k] = [math]::Max(1, $f)
        }
    }
    $used = $n.i + $n.r + $n.w + $n.o
    while ($used -lt $w) {
        $max_f = -1.0; $pick = $null
        foreach ($k in 'i','r','w','o') {
            if ($vals[$k] -gt 0) {
                $frac = $rw[$k] - [math]::Floor($rw[$k])
                if ($frac -gt $max_f) { $max_f = $frac; $pick = $k }
            }
        }
        if ($null -eq $pick) { break }
        $n[$pick]++
        $rw[$pick] = [math]::Floor($rw[$pick])
        $used++
    }
    while ($used -gt $w) {
        $trimmed = $false
        foreach ($k in 'o','w','r','i') {
            if ($n[$k] -gt 1) { $n[$k]--; $used--; $trimmed = $true; break }
        }
        if (-not $trimmed) { break }
    }
    $block = [string][char]0x2588
    $bar = ''
    if ($n.i -gt 0) { $bar += $c_in     + ($block * $n.i) }
    if ($n.r -gt 0) { $bar += $c_cached + ($block * $n.r) }
    if ($n.w -gt 0) { $bar += $c_wr     + ($block * $n.w) }
    if ($n.o -gt 0) { $bar += $c_out    + ($block * $n.o) }
    return $bar + $reset
}

# --- Cumulative breakdown (Σ) ---
$tokens_part = ''
if ($sum_out -ne 0 -or $sum_in -ne 0 -or $sum_rd -ne 0 -or $sum_wr -ne 0) {
    $ci = $cost_in_raw  / 1000000.0
    $cr = $cost_rd_raw  / 1000000.0
    $cw = ($cost_w5_raw + $cost_w1_raw) / 1000000.0
    $co = $cost_out_raw / 1000000.0
    $bar = Make-CostBar 20 $ci $cr $cw $co
    $tokens_part = "${cyan}Σ    ${reset} ${c_in}in:$(Fmt-Tok $sum_in 6)${reset} ${c_cached}cached:$(Fmt-Tok $sum_rd 6)${reset} ${c_wr}wr:$(Fmt-Tok $sum_wr 6)${reset} ${c_out}out:$(Fmt-Tok $sum_out 6)${reset} ${dim}≈${reset}${est_cost} ${bar}"
}

# --- Last-call breakdown ---
$last_part = ''
if ($last_out -ne 0 -or $last_in -ne 0 -or $last_rd -ne 0 -or $last_wr -ne 0) {
    # switch -Regex falls through all matching cases — break is required, otherwise
    # 'opus-4-7' matches 'opus-4-[567]' AND 'opus-4' and the legacy price wins.
    switch -Regex ($model_id) {
        'opus-4-[567]' { $lp_in=5;  $lp_w=10; $lp_rd=0.50; $lp_out=25; break }
        'opus-4'       { $lp_in=15; $lp_w=30; $lp_rd=1.50; $lp_out=75; break }
        'sonnet-4'     { $lp_in=3;  $lp_w=6;  $lp_rd=0.30; $lp_out=15; break }
        'haiku-4'      { $lp_in=1;  $lp_w=2;  $lp_rd=0.10; $lp_out=5;  break }
        default        { $lp_in=5;  $lp_w=10; $lp_rd=0.50; $lp_out=25 }
    }
    $l_ci = $last_in  * $lp_in  / 1000000.0
    $l_cr = $last_rd  * $lp_rd  / 1000000.0
    $l_cw = $last_wr  * $lp_w   / 1000000.0
    $l_co = $last_out * $lp_out / 1000000.0
    $last_est = '$' + ('{0,6:F2}' -f ($l_ci + $l_cr + $l_cw + $l_co))
    $last_bar = Make-CostBar 20 $l_ci $l_cr $l_cw $l_co
    $last_part = "${dim}last ${reset} ${c_in}in:$(Fmt-Tok $last_in 6)${reset} ${c_cached}cached:$(Fmt-Tok $last_rd 6)${reset} ${c_wr}wr:$(Fmt-Tok $last_wr 6)${reset} ${c_out}out:$(Fmt-Tok $last_out 6)${reset} ${dim}≈${reset}${last_est} ${last_bar}"
}

# --- OS detection — match bash: bold green WSL2, bold yellow native Windows, dim others ---
if ($env:WSL_DISTRO_NAME) {
    $os_part = "$e[1;32m● WSL2$reset"
} elseif ($IsLinux) {
    $os_part = "${dim}● Linux${reset}"
} elseif ($IsMacOS) {
    $os_part = "${dim}● macOS${reset}"
} else {
    $os_part = "$e[1;33m● WIN (native)$reset"
}

# --- Current time (cyan, matches bash) ---
$now_part = "$e[36m🕐 $(Get-Date -Format 'HH:mm:ss')$reset"

# --- Version stamp (script's own mtime) ---
$version_part = ''
try {
    $script_mtime = (Get-Item -LiteralPath $PSCommandPath).LastWriteTime
    $version_stamp = "${dim}v:$($script_mtime.ToString('yyyyMMdd HH:mm:ss'))${reset}"
} catch { $version_stamp = '' }

$footer_parts = @($os_part, $now_part)
if ($version_stamp) { $footer_parts += $version_stamp }
$version_part = $footer_parts -join $sep

# --- Assemble line 2 ---
$line2_parts = @()
if ($branch)        { $line2_parts += "${bold}${branch}${reset}" }
if ($pr_part)       { $line2_parts += $pr_part }
if ($short_cwd)     { $line2_parts += "${dim}${short_cwd}${reset}" }
if ($cost_part)     { $line2_parts += $cost_part }
if ($lines_part)    { $line2_parts += $lines_part }
if ($duration_part) { $line2_parts += $duration_part }
if ($api_part)      { $line2_parts += $api_part }
$line2 = $line2_parts -join $sep
if ($line2) { $line2 = "${cyan}sess:${reset} $line2" }

# --- Output ---
Write-Host $line1
if ($line2)        { Write-Host $line2 }
if ($tokens_part)  { Write-Host $tokens_part }
if ($last_part)    { Write-Host $last_part }
if ($version_part) { Write-Host $version_part }
