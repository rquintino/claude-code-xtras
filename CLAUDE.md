# claude-code-xtras — PUBLIC REPO
# Everything committed here is world-readable forever. Treat every write as a publish.

## INVARIANT
require("every tracked file be safe to publish on the open internet")
deny("commit, stage, or push personal or sensitive content")
deny("'I'll remove it later' — git history persists after `git rm`")

## DO NOT WRITE INTO TRACKED FILES
- real emails, phone numbers, postal addresses, gov IDs
- absolute home paths revealing usernames (/home/<user>/..., C:\Users\<user>\...)
- machine hostnames, internal IPs, internal URLs, VPN/employer/client names
- API keys, tokens, passwords, JWTs, .env contents, connection strings, private keys
- screenshots showing personal inboxes, calendars, bookmarks, IDE windows with home paths
# encoding ≠ redaction — base64/hex/url-encoded forms are equally banned

## SANITIZE
- emails        → user@example.com
- paths         → ./… or $PROJECT/… or <project>/…
- secrets       → $ENV_VAR placeholders
- example data  → Alice/Bob, example.com, 555-0100

## PRE-COMMIT
1. `git diff --staged` — eyeball every line
2. scan for the items above + filenames like .env, *.key, *.pem, credentials.*
3. on match: HALT, warn user, do not prepare the commit command
4. on clean: prepare commit message — no personal info, no internal refs

## REDACTING IMAGES (when a screenshot leaks a path/username/etc.)
# This box has no ImageMagick and no Pillow, but ffmpeg/ffprobe are installed.
# Workflow (all writes go to $TMPDIR — /tmp is read-only in the sandbox):
#   1. ffprobe -v error -show_entries stream=width,height -of csv=p=0 img.png
#   2. crop progressively to locate the offending pixels:
#        ffmpeg -y -v error -i img.png -vf "crop=W:H:X:Y" "$TMPDIR/crop.png"
#      then Read the crop to verify the box bounds the sensitive text
#   3. back up original outside the repo: cp img.png "$TMPDIR/img.original.png"
#   4. overlay a solid box (black, filled):
#        ffmpeg -y -v error -i img.png \
#          -vf "drawbox=x=X:y=Y:w=W:h=H:color=black:t=fill" \
#          "$TMPDIR/img.redacted.png"
#   5. Read the redacted PNG, then replace: cp "$TMPDIR/img.redacted.png" img.png
# Do NOT propose installing ImageMagick/Pillow — installs require explicit user approval.

## PUSH
- never execute `git push` — prepare the command for the user
- never force-push to main

## SKILLS & TEMPLATES PUBLISHED FROM THIS REPO
# Others will copy these into their own repos.
require("rules and examples be portable — no hardcoded user paths or hostnames")
prefer("placeholders + a one-line comment on what to substitute")
