# md2docx Pipeline Details

## Pipeline Steps (what build-docx.ps1 does)

1. **Load config** — reads `docx.yaml` if present, falls back to defaults
2. **Discover files** — `README.md` first, then `Part-*/README.md` + `Part-*/lab-*.md` sorted
3. **Get pandoc version** — from Docker image for the summary table
4. **Build summary table** — Document Summary with title, author, generated date, engine, sources
5. **Build manual TOC** — H1 from all files (Parts), H2 first-only from lab files (lab titles), all as clickable `#anchor` links
6. **Process each file:**
   - Read as UTF-8 (PS 5.1 defaults to ANSI — must use `[System.IO.File]::ReadAllText`)
   - Rewrite `![alt](path)` markdown image paths to repo-relative
   - Convert `<img src="...">` HTML tags to markdown `![]()` images
   - Convert `.md` file links to internal `#anchor` links (resolves target file's H1 heading to slug)
   - Strip navigation lines containing `←` (U+2190) or `→` (U+2192) arrows
   - Strip "Time Estimate" headings and their content line
   - Ensure blank line after `---` horizontal rules (prevents pandoc setext heading misparse)
   - Insert `\newpage` page break before each file
7. **Write staged markdown** — UTF-8 without BOM to `.md2docx/all.md` (in project root)
8. **Generate pandoc metadata** — filters out build-config keys (output, template, toc-depth, subtitle, author, summary), writes only pandoc-compatible fields to `.md2docx/metadata.yaml`
9. **Run pandoc via Docker:**
   ```
   docker run --rm --network none
     -v "repo:/data" -w /data
     pandoc/core:latest
     --reference-doc=template.docx
     --from=markdown+lists_without_preceding_blankline+pipe_tables+strikeout+task_lists+autolink_bare_uris
     --lua-filter=/skill/pagebreak.lua
     --metadata-file=.md2docx/metadata.yaml
     -o .md2docx/output.docx
     .md2docx/all.md
   ```
10. **Copy output** — delete-then-copy (2s delay) for OneDrive sync detection; supports absolute paths
11. **Word COM sync** — headless open+save via Word COM automation to trigger OneDrive upload

## Lua Filter (pagebreak.lua)

Four responsibilities:

| Function | What it does |
|---|---|
| `RawBlock` | Converts `\newpage` raw tex to OpenXML `<w:br w:type="page"/>` |
| `Pandoc` | Inserts spacer paragraphs between consecutive blocks (template may have 0pt spacing) |
| `Header` | Converts H3+ to bold paragraphs — only H1/H2 appear in Word navigation |
| `BulletList/OrderedList` | Converts tight (Plain) to loose (Para) lists for proper spacing |

## Heading Hierarchy

| Level | Used by | Appears in TOC/Nav |
|---|---|---|
| `#` (H1) | Part READMEs, main README | Yes |
| `##` (H2) | Lab titles (first heading in lab files) | Yes |
| `###` (H3) | Sub-sections within labs | No (demoted to bold) |
| `####` (H4) | Actions within labs | No (demoted to bold) |

Lab files use H2 as top-level. When adding a new lab with `#` as title, shift all its headings down one level.

## Regex Patterns

All compiled once as `[regex]` objects to avoid PS 5.1 string-parsing issues with `[` inside quoted strings:

- `$reImgMd` — markdown images `![alt](path)`
- `$reImgHtml` — wrapped HTML images `<p><img src="..."></p>`
- `$reImgBare` — bare HTML images `<img src="...">`
- `$reMdLink` — markdown links to `.md` files
- `$reArrowL/R` — lines with ← or → navigation arrows
- `$reTimeEst` — Time Estimate headings + value
- `$reHrNoBlank` — horizontal rules without trailing blank line

## Config Keys

| Key | Pandoc metadata | Build config | Default |
|---|---|---|---|
| `title` | Yes | Yes (summary table) | folder name |
| `subtitle` | No | Yes (summary table) | empty |
| `author` | No | Yes (summary table) | empty |
| `subject` | Yes | No | empty |
| `lang` | Yes | No | en |
| `output` | No | Yes (output path) | labs.docx |
| `template` | No | Yes (--reference-doc) | template.docx |
| `toc-depth` | No | Yes (TOC heading levels) | 2 |
| `summary` | No | Yes (show/hide summary) | true |
