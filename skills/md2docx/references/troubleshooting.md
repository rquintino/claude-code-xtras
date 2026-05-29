# md2docx Troubleshooting

## Common Issues

| Issue | Cause | Fix |
|---|---|---|
| Emoji renders as `ðŸ"š` | File not read as UTF-8 | Script uses `[System.IO.File]::ReadAllText` with explicit UTF-8 encoding |
| Lists collapse into one line | `gfm` format without blank line before list | Script uses `markdown+lists_without_preceding_blankline` |
| `##` heading renders in 2-char column | `---` followed by heading without blank line | Script ensures blank line after every `---` |
| No page break between sections | `\newpage` not supported in format | Lua filter converts to OpenXML `<w:br w:type="page"/>` |
| Images missing in docx | HTML `<img>` tags not converted | Script converts `<img src>` to markdown `![]()` |
| TOC not visible in Word Online | Native Word TOC field doesn't render online | Uses manual markdown TOC with anchor links |
| `** **` showing as literal text | Content is inside a fenced code block | Correct behavior — code blocks render literally |
| Navigation arrows in output | `←`/`→` lines not stripped | Script strips any line containing U+2190 or U+2192 |
| Word doesn't update for online viewers | OneDrive sync delay | Script does Word COM open+save to trigger sync |
| Permission denied writing docx | Word has file locked | Kill WINWORD.EXE before building |
| PS 5.1 regex parse error | `[` inside string triggers type resolution | Use precompiled `[regex]` objects, avoid inline patterns |
| `\newpage` shows as literal text | Using `gfm` format (no raw_tex support) | Use `markdown` format which supports raw_tex natively |
| Paragraphs have no spacing | Template "Body Text" style has 0pt after-spacing | Lua filter inserts spacer paragraphs between blocks |
| Sub-headings clutter Word navigation | All heading levels appear in nav pane | Lua filter demotes H3+ to bold paragraphs |

## PowerShell 5.1 Gotchas

These are specific to Windows PowerShell 5.1 (not PowerShell 7):

- **No `GetRelativePath`**: use string replacement instead of `[System.IO.Path]::GetRelativePath()`
- **`[` in strings**: even in single-quoted strings, `[` after `"` can trigger type parsing. Use precompiled `[regex]` objects
- **`|` in strings**: pipe character in double-quoted strings breaks parsing. Use `-f` format operator or string concatenation
- **UTF-8 BOM**: `Set-Content -Encoding UTF8` writes BOM. Use `[System.Text.UTF8Encoding]($false)` for BOM-free output
- **`Get-Content` encoding**: defaults to ANSI, not UTF-8. Use `[System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)`
- **Inline `if` expressions**: `$x = if (...) { } else { }` works but requires `ContainsKey()` for hashtable checks

## Docker Issues

- **Image not found**: run `docker pull pandoc/core:latest` first (requires network)
- **Path mangling in Git Bash**: set `MSYS_NO_PATHCONV=1` or use `cmd.exe /c` for docker commands
- **Permission denied in container**: pandoc writes inside `/data`, copy output after container exits
- **`--network none` prevents image pull**: pull the image before the first build, then all subsequent builds work offline
