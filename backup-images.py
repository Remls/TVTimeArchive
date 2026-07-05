#!/usr/bin/env python3
"""backup-images.py — download the images the archive viewer shows from TV Time's
CDN, while the servers are still up, and pack them into a zip the app can import.
Once imported, the app shows these from local copies, so they keep working after
the servers go offline.

It grabs, into folders the app understands:
    comments/  your comment images & GIFs   (meme.csv — clean + marked variants)
    avatars/   profile pictures             (your own + everyone in your notifications)
    badges/    badge artwork                (badge-unlocked notifications)

Why a script and not a button? The image host (CloudFront) sends no CORS headers,
so a browser may display these images but not read their bytes to save them.

Pure standard library — needs only Python 3 (no bash, curl, or zip), so it runs the
same on macOS, Linux, and Windows.

Usage:
    python3 backup-images.py [path-to-export-dir] [output.zip]

    path    directory containing your unzipped export.  Default: gdpr-data
    output  zip to write.                                Default: tvt-image-backup.zip

Re-running is safe and resumable: already-downloaded images are skipped.
"""

import csv
import os
import re
import ssl
import sys
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.error import URLError

WORK = "image-backup"
UA = "tvt-image-backup"
IMG_EXTS = ("jpg", "jpeg", "png", "gif", "webp")

_ctx = ssl.create_default_context()
_insecure_warned = False


def ext_of(url):
    e = url.split("?", 1)[0].rsplit(".", 1)[-1].lower()
    return e if e in IMG_EXTS else "jpg"


def rows(export_dir, filename):
    path = os.path.join(export_dir, filename)
    if not os.path.exists(path):
        return
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            yield row


def build_map(export_dir):
    """Return [(folder, name, ext, url)]. `folder/name` must match what app.js keys
    local images by (notifImageRef / avatarEl / comment candidates)."""
    items = []

    def add(folder, name, url):
        name, url = (name or "").strip(), (url or "").strip()
        if name and url:
            items.append((folder, name, ext_of(url), url))

    # comments/ — meme images (clean + the watermarked "marked" version)
    for r in rows(export_dir, "meme.csv"):
        mid = (r.get("id") or "").strip()
        if not mid:
            continue
        marked = (r.get("medium_url") or "").strip()
        clean = (r.get("clean_version_medium_url") or "").strip()
        if marked:
            add("comments", mid + "-marked", marked)
        if clean and clean != marked:
            add("comments", mid + "-clean", clean)

    # avatars/ — your own profile picture
    for r in rows(export_dir, "routing-prod-users.csv"):
        add("avatars", (r.get("user_id") or "").strip(), r.get("image_url"))

    # avatars/ + badges/ — everyone/everything in your notifications
    for r in rows(export_dir, "notifications-prod-notifications.csv"):
        img = (r.get("image") or "").strip()
        if not img:
            continue
        m = re.search(r"/user/(\d+)/profile_picture", img)
        if m:
            add("avatars", m.group(1), img)
        elif r.get("type") == "badge-unlocked":
            b = re.search(r"badge_id=([^&]+)", r.get("url") or "")
            if b:
                add("badges", b.group(1), img)

    # Dedup by destination (avatars recur across notifications).
    seen, uniq = set(), []
    for it in items:
        k = (it[0], it[1])
        if k not in seen:
            seen.add(k)
            uniq.append(it)
    return uniq


def _open(url):
    global _ctx, _insecure_warned
    req = Request(url, headers={"User-Agent": UA})
    try:
        return urlopen(req, timeout=60, context=_ctx)
    except URLError as e:
        # macOS/python.org builds often lack CA roots — fall back to unverified TLS
        # (these are public images, nothing sensitive) so the backup still works.
        if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
            if not _insecure_warned:
                print("warning: TLS verification failed; continuing without it (public images).", file=sys.stderr)
                _insecure_warned = True
            _ctx = ssl._create_unverified_context()
            return urlopen(req, timeout=60, context=_ctx)
        raise


def fetch(item):
    folder, name, ext, url = item
    dest = os.path.join(WORK, folder, name + "." + ext)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return "skip"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        with _open(url) as r:
            data = r.read()
        if not data:
            raise ValueError("empty response")
        with open(dest, "wb") as f:
            f.write(data)
        return "ok"
    except Exception:
        try:
            os.remove(dest)
        except OSError:
            pass
        return "fail"


def main(argv):
    args = [a for a in argv[1:] if a not in ("-h", "--help")]
    if len(argv) > 1 and argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0

    export_dir = args[0] if len(args) > 0 else "gdpr-data"
    out = args[1] if len(args) > 1 else "tvt-image-backup.zip"

    if os.path.isfile(export_dir):
        export_dir = os.path.dirname(export_dir) or "."
    if not os.path.isdir(export_dir):
        print(f"error: '{export_dir}' is not a directory. Point this at your unzipped export.", file=sys.stderr)
        return 1
    if not (os.path.exists(os.path.join(export_dir, "meme.csv"))
            or os.path.exists(os.path.join(export_dir, "notifications-prod-notifications.csv"))):
        print(f"error: no recognizable export CSVs found in '{export_dir}'.", file=sys.stderr)
        return 1

    items = build_map(export_dir)
    if not items:
        print("nothing to download — no image URLs found in the export.", file=sys.stderr)
        return 1

    print(f"downloading {len(items)} images into {WORK}/ …")
    results = Counter()
    done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(fetch, it) for it in items]
        for fu in as_completed(futures):
            results[fu.result()] += 1
            done += 1
            if done % 50 == 0 or done == len(items):
                print(f"\r  {done}/{len(items)}", end="", file=sys.stderr)
    print(file=sys.stderr)

    print(f"images: {len(items)} referenced · {results['ok']} downloaded · "
          f"{results['skip']} already had · {results['fail']} failed")
    for folder in ("comments", "avatars", "badges"):
        d = os.path.join(WORK, folder)
        if os.path.isdir(d):
            n = sum(len(fs) for _, _, fs in os.walk(d))
            if n:
                print(f"  {folder}/: {n} files")
    if results["fail"]:
        print(f"note: {results['fail']} failed (usually deleted accounts / removed images). Re-run to retry.", file=sys.stderr)

    # Collect and zip (forward-slash arcnames so the zip is valid on Windows too).
    files = []
    for root, _, names in os.walk(WORK):
        for fn in names:
            p = os.path.join(root, fn)
            files.append((p, os.path.relpath(p, WORK).replace(os.sep, "/")))
    if not files:
        print("nothing to zip — no images downloaded.", file=sys.stderr)
        return 1

    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path, arc in sorted(files, key=lambda x: x[1]):
            z.write(path, arc)
    print(f"wrote {out} ({len(files)} files) — import it via ⚙ → Import image backup in the app.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
