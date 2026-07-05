#!/usr/bin/env bash
#
# backup-images.sh — download the images you attached to TV Time comments while
# TV Time's servers are still up, and pack them into a zip the archive viewer can
# import. Once imported, the app shows your comment images from local copies, so
# they keep working after the servers go offline.
#
# Why a script and not a button in the app? The image host (CloudFront) sends no
# CORS headers, so a browser is allowed to *display* the images but not to *read*
# their bytes — which is what packing a backup requires. A plain download outside
# the browser sidesteps that.
#
# Usage:
#   ./backup-images.sh [path-to-export-dir-or-meme.csv] [output.zip]
#
#   path   directory containing your unzipped export (or meme.csv itself).
#          Default: ./gdpr-data
#   output zip to write. Default: ./tvt-image-backup.zip
#
# Re-running is safe and resumable: already-downloaded images are skipped.

set -euo pipefail

SRC="${1:-gdpr-data}"
OUT="${2:-tvt-image-backup.zip}"

# Locate meme.csv.
if [[ -d "$SRC" ]]; then
  MEME="$SRC/meme.csv"
elif [[ -f "$SRC" ]]; then
  MEME="$SRC"
else
  echo "error: '$SRC' is not a directory or file" >&2
  exit 1
fi
if [[ ! -f "$MEME" ]]; then
  echo "error: meme.csv not found at '$MEME'" >&2
  echo "Point this script at your unzipped export directory." >&2
  exit 1
fi

command -v python3 >/dev/null || { echo "error: python3 is required" >&2; exit 1; }
command -v curl    >/dev/null || { echo "error: curl is required"    >&2; exit 1; }

WORK="image-backup"
mkdir -p "$WORK"

# Pull (meme id, variant, url) rows out of meme.csv. The app prefers the "clean"
# image (no TV Time watermark) and falls back to the "marked" one, so back up both.
# For GIFs the two are identical, so only one file is written.
MAP="$(python3 - "$MEME" <<'PY'
import csv, sys
with open(sys.argv[1], newline='') as f:
    for row in csv.DictReader(f):
        mid = (row.get('id') or '').strip()
        if not mid: continue
        marked = (row.get('medium_url') or '').strip()
        clean  = (row.get('clean_version_medium_url') or '').strip()
        if marked:               print(f"{mid}\tmarked\t{marked}")
        if clean and clean != marked: print(f"{mid}\tclean\t{clean}")
PY
)"

total=0; ok=0; skip=0; failed=0
declare -a FAILS=()

while IFS=$'\t' read -r id variant url; do
  [[ -z "${id:-}" ]] && continue
  total=$((total+1))
  dest="$WORK/$id-$variant.jpg"
  if [[ -s "$dest" ]]; then
    skip=$((skip+1))
    continue
  fi
  if curl -fsSL --max-time 60 -o "$dest" "$url"; then
    ok=$((ok+1))
  else
    rm -f "$dest"
    failed=$((failed+1))
    FAILS+=("$id-$variant")
  fi
done <<< "$MAP"

echo
echo "files: $total total (clean + marked) · $ok downloaded · $skip already had · $failed failed"
if (( failed > 0 )); then
  echo "failed ids: ${FAILS[*]}" >&2
  echo "(these were probably already removed from the server; re-run to retry.)" >&2
fi

count=$(find "$WORK" -type f -name '*.jpg' | wc -l | tr -d ' ')
if (( count == 0 )); then
  echo "nothing to zip — no images were downloaded." >&2
  exit 1
fi

rm -f "$OUT"
( cd "$WORK" && zip -q -r "../$OUT" . )
echo "wrote $OUT ($count files) — import it via ⚙ → Import image backup in the app."
