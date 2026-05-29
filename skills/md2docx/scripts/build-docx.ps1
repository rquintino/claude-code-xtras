# Build a .docx from all markdown files using pandoc via Docker.
# Config: reads optional docx.yaml for metadata. Falls back to sensible defaults.
# Requires: Docker Desktop running. No other installs.
#
# Usage: build-docx.ps1 [-ProjectDir <path>]
#   -ProjectDir: root of the markdown project (default: parent of script dir, or CWD)

param(
    [string]$ProjectDir
)

# --- Read skill version from SKILL.md frontmatter ------------------------------------
$skillVersion = 'unknown'
$skillMd = Join-Path $PSScriptRoot "..\SKILL.md"
if (Test-Path $skillMd) {
    $verLine = [System.IO.File]::ReadAllLines($skillMd, [System.Text.Encoding]::UTF8) |
        Where-Object { $_ -match '^\s*version\s*:\s*(.+)$' } | Select-Object -First 1
    if ($verLine -match '^\s*version\s*:\s*(.+)$') {
        $skillVersion = $Matches[1].Trim()
    }
}

$ErrorActionPreference = "Stop"

# Resolve project root: explicit param > parent of script dir > CWD
if ($ProjectDir) {
    $repo = Resolve-Path $ProjectDir
} elseif ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot ".."))) {
    $repo = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $repo = Resolve-Path (Get-Location)
}

# Staged dir lives inside the skill, not the project.
$staged = Join-Path $PSScriptRoot "_staged"

New-Item -ItemType Directory -Force -Path $staged | Out-Null

# --- Load optional docx.yaml config ---------------------------------------------------
$configPath = Join-Path $repo "docx.yaml"
$cfg = @{}
if (Test-Path $configPath) {
    $yamlRe = [regex]'^\s*([a-zA-Z\-]+)\s*:\s*"?(.+?)"?\s*$'
    foreach ($line in [System.IO.File]::ReadAllLines($configPath, [System.Text.Encoding]::UTF8)) {
        $ym = $yamlRe.Match($line)
        if ($ym.Success) {
            $cfg[$ym.Groups[1].Value.Trim()] = $ym.Groups[2].Value.Trim()
        }
    }
    Write-Host "Loaded config: $configPath"
} else {
    Write-Host "No docx.yaml found, using defaults."
}

$docTitle    = if ($cfg.ContainsKey('title'))     { $cfg['title'] }     else { Split-Path -Leaf $repo }
$docSubtitle = if ($cfg.ContainsKey('subtitle'))  { $cfg['subtitle'] }  else { '' }
$docAuthor   = if ($cfg.ContainsKey('author'))    { $cfg['author'] }    else { '' }
$docTemplate = if ($cfg.ContainsKey('template'))  { $cfg['template'] }  else { '' }
$docOutput   = if ($cfg.ContainsKey('output'))    { $cfg['output'] }    else { 'output.docx' }
$tocDepth    = if ($cfg.ContainsKey('toc-depth')) { $cfg['toc-depth'] } else { '2' }
$foldersGlob = if ($cfg.ContainsKey('folders'))  { $cfg['folders'] }   else { '*' }
$filesGlob   = if ($cfg.ContainsKey('files'))    { $cfg['files'] }     else { '*.md' }

# If output is an absolute path, use it directly; otherwise relative to repo.
if ([System.IO.Path]::IsPathRooted($docOutput)) {
    $out = $docOutput
} else {
    $out = Join-Path $repo $docOutput
}
$tmpMd = Join-Path $staged "all.md"

# --- Helper: resolve relative image paths ---------------------------------------------
function Resolve-ImagePath($relDir, $rawPath) {
    if ($relDir -eq '.' -or $relDir -eq '') { return $rawPath }
    $combined = "$relDir/$rawPath" -replace '\\','/' -replace '/\./','/' -replace '//','/'
    while ($combined -match '[^/]+/\.\./') {
        $combined = [regex]::Replace($combined, '[^/]+/\.\./', '')
    }
    return $combined
}

# --- Regex patterns (compiled once, avoids PS string-parsing issues) -------------------
$reImgMd   = [regex]'!\[([^\]]*)\]\(([^)]+)\)'
$reImgHtml = [regex]'<p[^>]*>\s*<img[^>]*?src="([^"]+)"[^>]*>\s*</p>'
$reImgBare = [regex]'<img[^>]*?src="([^"]+)"[^>]*>'
$reMdLink  = [regex]'(?i)\[([^\]]+)\]\(([^)]*\.md[^)]*)\)'
$reArrowL  = [regex]'(?m)^[^\n]*\u2190[^\n]*$'
$reArrowR  = [regex]'(?m)^[^\n]*\u2192[^\n]*$'
$reTimeEst = [regex]'(?m)^#{1,4}\s+Time Estimate\s*\n+[^\n#]*$'
$reHrNoBlank = [regex]'(?m)^---\r?\n(?!\r?\n)'

# --- 1. Discover input files in canonical order ----------------------------------------
$files = @()
$rootReadme = Join-Path $repo "README.md"
if (Test-Path $rootReadme) { $files += $rootReadme }

Get-ChildItem $repo -Directory -Filter $foldersGlob |
    Sort-Object Name |
    ForEach-Object {
        $part = $_.FullName
        $readme = Join-Path $part "README.md"
        if (Test-Path $readme) { $files += $readme }
        Get-ChildItem $part -Filter $filesGlob |
            Sort-Object Name |
            ForEach-Object {
                if ($_.Name -ne 'README.md') { $files += $_.FullName }
            }
    }

Write-Host "Found $($files.Count) markdown files."

# --- 2. Get pandoc version for the info table ------------------------------------------
$pandocVersion = (docker run --rm --network none pandoc/core:latest --version 2>&1 |
    Select-String '^pandoc\s+(.+)' | ForEach-Object { $_.Matches[0].Groups[1].Value })
if (-not $pandocVersion) { $pandocVersion = 'unknown' }

# --- 3. Build generation info table (first page after cover) ---------------------------
$genDate = Get-Date -Format "yyyy-MM-dd HH:mm"
$showSummary = if ($cfg.ContainsKey('summary')) { $cfg['summary'] -ne 'false' } else { $true }
$sb = New-Object System.Text.StringBuilder

if ($showSummary) {
    [void]$sb.AppendLine('# Document Info')
    [void]$sb.AppendLine()

    $tbl = @(
        '| | |'
        '|:---|:---|'
    )
    $tbl += '| Title | ' + $docTitle + ' |'
    if ($docSubtitle) { $tbl += '| Subtitle | ' + $docSubtitle + ' |' }
    if ($docAuthor)   { $tbl += '| Author | ' + $docAuthor + ' |' }
    $tbl += '| Generated | ' + $genDate + ' |'
    $tbl += '| Engine | md2docx ' + $skillVersion + ' / Pandoc ' + $pandocVersion + ' |'
    $tbl += '| Sources | ' + $files.Count + ' markdown files |'
    $tbl += '| Template | ' + $docTemplate + ' |'
    foreach ($row in $tbl) { [void]$sb.AppendLine($row) }
    [void]$sb.AppendLine()
}

# --- 3b. Build manual TOC: H1 from READMEs, H2 from content files --------------------
[void]$sb.AppendLine('# Table of Contents')
[void]$sb.AppendLine()
$reH1 = [regex]'(?m)^#\s+(.+)$'
$reH2 = [regex]'(?m)^##\s+(.+)$'
foreach ($f in $files) {
    $fname = Split-Path -Leaf $f
    $isContent = $fname -ne 'README.md'
    $raw = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)

    # H1: include from all files (section titles + main README title).
    foreach ($hm in $reH1.Matches($raw)) {
        $text = $hm.Groups[1].Value.Trim()
        if ($text -match '\u2190|\u2192|Time Estimate') { continue }
        $slug = $text.ToLower() -replace '[^\w\s\-]','' -replace '\s+','-'
        [void]$sb.AppendLine(('- [{0}](#{1})' -f $text, $slug))
    }

    # H2: include only from content files (non-README).
    if ($isContent) {
        $firstH2 = $reH2.Match($raw)
        if ($firstH2.Success) {
            $text = $firstH2.Groups[1].Value.Trim()
            $slug = $text.ToLower() -replace '[^\w\s\-]','' -replace '\s+','-'
            [void]$sb.AppendLine(('    - [{0}](#{1})' -f $text, $slug))
        }
    }
}
[void]$sb.AppendLine()

# --- 4. Rewrite image paths, fix links, concatenate with page breaks -------------------
foreach ($f in $files) {
    $srcDir = Split-Path -Parent $f
    $relDir = $srcDir.Replace($repo.Path, '').TrimStart('\').Replace('\','/')

    # Read as UTF-8 explicitly (PS 5.1 defaults to ANSI).
    $content = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)

    # Rewrite ![alt](relative-path) markdown images.
    $content = $reImgMd.Replace($content, {
        param($m)
        $alt  = $m.Groups[1].Value
        $path = $m.Groups[2].Value.Trim()
        if ($path -match '^(https?:|/|#|data:)') { return $m.Value }
        $newPath = Resolve-ImagePath $relDir $path
        return ('![{0}]({1})' -f $alt, $newPath)
    })

    # Convert <img src="..."> HTML tags to markdown images.
    foreach ($im in $reImgHtml.Matches($content)) {
        $imgPath = $im.Groups[1].Value.Trim()
        if ($imgPath -match '^(https?:|/|#|data:)') { $np = $imgPath }
        else { $np = Resolve-ImagePath $relDir $imgPath }
        $content = $content.Replace($im.Value, ('![]({0})' -f $np))
    }
    foreach ($im in $reImgBare.Matches($content)) {
        $imgPath = $im.Groups[1].Value.Trim()
        if ($imgPath -match '^(https?:|/|#|data:)') { $np = $imgPath }
        else { $np = Resolve-ImagePath $relDir $imgPath }
        $content = $content.Replace($im.Value, ('![]({0})' -f $np))
    }

    # Convert .md file links to internal anchor links.
    $content = $reMdLink.Replace($content, {
        param($m)
        $text    = $m.Groups[1].Value
        $rawHref = $m.Groups[2].Value.Trim()
        $filePart = ($rawHref -split '#')[0]
        if (-not $filePart) { return ('**{0}**' -f $text) }
        $targetPath = Join-Path $srcDir $filePart
        if (-not (Test-Path $targetPath)) { $targetPath = Join-Path $repo $filePart }
        if (Test-Path $targetPath) {
            $firstLine = [System.IO.File]::ReadAllLines($targetPath, [System.Text.Encoding]::UTF8) |
                Where-Object { $_ -match '^\s*#{1,6}\s+' } | Select-Object -First 1
            if ($firstLine) {
                $heading = ($firstLine -replace '^\s*#+\s*', '').Trim()
                $slug = $heading.ToLower() -replace '[^\w\s\-]','' -replace '\s+','-'
                return ('[{0}](#{1})' -f $text, $slug)
            }
        }
        return ('**{0}**' -f $text)
    })

    # Strip navigation lines, time estimates, fix horizontal rules.
    $content = $reArrowL.Replace($content, '')
    $content = $reArrowR.Replace($content, '')
    $content = $reTimeEst.Replace($content, '')
    $content = $reHrNoBlank.Replace($content, "---`n`n")

    # Page break before every file.
    [void]$sb.AppendLine()
    [void]$sb.AppendLine('\newpage')
    [void]$sb.AppendLine()
    [void]$sb.AppendLine($content)
}

# --- 5. Write staged markdown ----------------------------------------------------------
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmpMd, $sb.ToString(), $utf8NoBom)
Write-Host "Staged: $tmpMd"

# --- 6. Run pandoc via Docker ----------------------------------------------------------
$mount = $repo.Path.Replace('\','/')
# Generate a pandoc-only metadata file (exclude build-config keys).
$metaArg = @()
if (Test-Path $configPath) {
    $buildKeys = @('output','template','toc-depth','subtitle','author','summary','folders','files')
    $metaPath = Join-Path $staged "metadata.yaml"
    $metaLines = @()
    foreach ($k in $cfg.Keys) {
        if ($buildKeys -notcontains $k) {
            $metaLines += ('{0}: "{1}"' -f $k, $cfg[$k])
        }
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($metaPath, ($metaLines -join "`n"), $utf8NoBom)
    $metaArg = @('--metadata-file=scripts/_staged/metadata.yaml')
}

$stagedDocx = Join-Path $staged "output.docx"
$pandocFrom = 'markdown+lists_without_preceding_blankline+pipe_tables+strikeout+task_lists+autolink_bare_uris'
$luaFilter  = Join-Path $PSScriptRoot "pagebreak.lua"
$inputMd    = Join-Path $staged "all.md"

# Use local pandoc (default), fall back to Docker.
$localPandoc = Get-Command pandoc -ErrorAction SilentlyContinue
if ($localPandoc) {
    Write-Host "Using local pandoc: $($localPandoc.Source)"
    $pandocArgs = @(
        "--from=$pandocFrom"
        "--lua-filter=$luaFilter"
        "-o", $stagedDocx
    )
    if ($docTemplate) { $pandocArgs += "--reference-doc=$docTemplate" }
    if ($metaArg) {
        $metaFile = Join-Path $staged "metadata.yaml"
        $pandocArgs += "--metadata-file=$metaFile"
    }
    $pandocArgs += $inputMd

    Push-Location $repo
    & pandoc @pandocArgs
    Pop-Location
} else {
    Write-Host "Local pandoc not found, falling back to Docker"
    $skillMount = $PSScriptRoot.Replace('\','/')
    $dockerArgs = @(
        'run', '--rm', '--network', 'none'
        '-v', "${mount}:/data"
        '-v', "${skillMount}:/skill:ro"
        '-w', '/data'
        'pandoc/core:latest'
        "--from=$pandocFrom"
        '--lua-filter=/skill/pagebreak.lua'
    )
    if ($docTemplate) { $dockerArgs += "--reference-doc=$docTemplate" }
    $dockerArgs += @($metaArg)
    $dockerArgs += @('-o', '/skill/_staged/output.docx', '/skill/_staged/all.md')
    & docker @dockerArgs
}

if ($LASTEXITCODE -ne 0) { throw "pandoc failed (exit $LASTEXITCODE)" }

# --- 7. Post-process: inject table cell margins into docx for row spacing ----------------
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    $zip = [System.IO.Compression.ZipFile]::Open($stagedDocx, 'Update')
    $entry = $zip.GetEntry('word/document.xml')
    $stream = $entry.Open()
    $reader = New-Object System.IO.StreamReader($stream)
    $xml = $reader.ReadToEnd()
    $reader.Close()
    $stream.Close()

    # Inject tblCellMar after every <w:tblPr> opening (add top/bottom padding of 60 twips)
    $cellMarXml = '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar>'
    # Insert before </w:tblPr> closing tag
    $xml = $xml -replace '</w:tblPr>', "$cellMarXml</w:tblPr>"

    $stream = $entry.Open()
    $stream.SetLength(0)
    $writer = New-Object System.IO.StreamWriter($stream)
    $writer.Write($xml)
    $writer.Flush()
    $writer.Close()
    $stream.Close()
    $zip.Dispose()
    Write-Host "Table cell margins injected."
} catch {
    Write-Host "Table margin post-processing skipped: $($_.Exception.Message)"
    if ($zip) { $zip.Dispose() }
}

# Copy to final output path. Overwrite in place to preserve OneDrive file ID and share links.
Copy-Item -Path $stagedDocx -Destination $out -Force
Write-Host "Wrote: $out"

# Trigger OneDrive sync by opening and saving via Word COM automation.
try {
    Write-Host "Triggering sync via Word..."
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $doc = $word.Documents.Open($out)
    $doc.Save()
    $doc.Close()
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    Write-Host "Sync triggered."
} catch {
    Write-Host "Word automation skipped: $($_.Exception.Message)"
}

