---
name: md2docx
version: 1.0.0
description: Build a styled Word document (.docx) from multiple markdown files using pandoc via Docker. Use this skill whenever the user wants to generate, build, rebuild, export, or regenerate a .docx from markdown — including phrases like "build docx", "generate word doc", "export to word", "regenerate", "rebuild document", "run md2docx", or simply "again" when referring to a previous docx build. Also triggers when the user asks to modify the docx pipeline, fix docx output issues, change docx config, or adjust the build script.
---

# md2docx

Convert ordered markdown files into a single styled .docx using pandoc. Uses local pandoc if installed, falls back to Docker.

## How to Build

The project root is the directory containing `README.md`, `Part-*/` folders, and optionally `docx.yaml`. Detect it from the current working directory or from the user's prompt (e.g. "rebuild the docx for labs" means the project root is the `labs/` folder).

**Run the build:**
```bash
powershell.exe -ExecutionPolicy Bypass -File "<SKILL_DIR>/scripts/build-docx.ps1" -ProjectDir "<PROJECT_ROOT>"
```

All intermediate files (staged markdown, metadata, output) are kept inside the project's `.md2docx/` directory. The skill folder remains read-only.

**If the build fails with "permission denied"**, Word has the output file locked. Ask the user before killing Word — never kill it automatically. Only after the user confirms:
```bash
powershell.exe -Command "Get-Process WINWORD -ErrorAction SilentlyContinue | Stop-Process -Force"
```
Then wait 2 seconds and retry the build.

### Path Resolution

- **`<SKILL_DIR>`** is the base directory of this skill, provided in the "Base directory for this skill:" header when the skill loads. It contains `scripts/build-docx.ps1` and `scripts/pagebreak.lua`.
- **`<PROJECT_ROOT>`** is the markdown project root. To find it:
  1. If the user specifies a path (e.g. "for labs"), resolve it relative to the current working directory
  2. Otherwise, use the current working directory
  3. Verify: the project root should contain a `README.md` and at least one subdirectory with `.md` files

### Pandoc Resolution

The script uses local `pandoc` if found on PATH (default). If not available, it falls back to `docker run pandoc/core:latest` with the project and skill dirs mounted as volumes.

## Project Structure

```
project-root/
├── docx.yaml              # Optional config
├── template.docx          # Style source for pandoc
├── README.md              # First file in output
└── <subdir>/              # Subdirectories with .md files
    ├── README.md          # Section intro (H1 headings)
    └── *.md               # Content files (H2 headings in TOC)
```

Files are auto-discovered and sorted by name. No manual file listing needed.

## Config: docx.yaml

Optional. All fields have defaults. See `assets/docx.yaml.example` for template.

| Key | Default | Notes |
|---|---|---|
| `title` | folder name | Document title |
| `subtitle` | empty | Summary table |
| `author` | empty | Summary table |
| `output` | output.docx | Supports absolute paths (OneDrive) |
| `template` | _(none)_ | pandoc --reference-doc (optional) |
| `toc-depth` | 2 | H1=Parts, H2=Labs |
| `summary` | true | Generation info table |
| `folders` | `*` | Glob for subdirectories (e.g. `Part-*`) |
| `files` | `*.md` | Glob for content files inside folders (e.g. `lab-*.md`) |

## Heading Rules

- **`#` (H1)** — Parts + main README. In TOC + Word nav.
- **`##` (H2)** — Lab titles. In TOC + Word nav.
- **`###`+** — Sub-sections. Demoted to bold by lua filter. Not in nav.

## What the Build Does

1. Discovers files in canonical order
2. Rewrites image paths (markdown + HTML `<img>`)
3. Converts `.md` links to internal `#anchor` references
4. Strips navigation arrows and Time Estimate headings
5. Builds manual TOC with clickable links (works in Word Online)
6. Runs pandoc (local or Docker fallback)
7. Triggers OneDrive sync via Word COM open+save

Read `references/pipeline-details.md` for full internals. Read `references/troubleshooting.md` for common issues.

## Modifying the Pipeline

- **Add section**: create a subdirectory with `README.md`
- **Add content**: add `.md` files in a subdirectory (first `##` heading appears in TOC)
- **Change styling**: edit `template.docx` styles, rebuild
- **Change output**: set `output:` in `docx.yaml`
- **Disable summary**: set `summary: false`
