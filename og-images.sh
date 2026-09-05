#!/bin/sh
# Renders viewer/og-image.png and viewer/refract/og-image.png from the SVGs
# beside this script. Chrome does the rendering so the text uses the same web
# fonts the site loads; the sources are 1200x1200 and the OG image is the
# middle 630 band of that square.
set -eu

CHROME=${CHROME:-/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome}
[ -x "$CHROME" ] || { echo "Chrome not found. Set CHROME to its binary." >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/wrap.html" <<'HTML'
<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; }
  #crop { position: absolute; top: 0; left: 0; width: 1200px; height: 630px; overflow: hidden; }
  #crop img { position: absolute; top: -285px; left: 0; width: 1200px; height: 1200px; }
</style>
<div id="crop"><img id="s"></div>
<script>document.getElementById('s').src = new URLSearchParams(location.search).get('svg');</script>
HTML

render() {
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=4000 --screenshot="$here/$2" --window-size=1200,630 \
    "file://$tmp/wrap.html?svg=file://$here/$1" >/dev/null 2>&1
  echo "  $2"
}

echo "Rendering:"
render og-image.svg         viewer/og-image.png
render og-image-refract.svg viewer/refract/og-image.png
