#!/usr/bin/env python3
"""extended-backup.py — build a single portable archive of the TV Time data that lives
behind ids/URLs the GDPR export doesn't spell out, while the servers are still up.
Import the resulting zip into the archive viewer and it keeps working offline.

Everything goes into ONE zip (default: tvt-extended-backup.zip), in folders the app
understands:
    comments/       your comment images & GIFs      (meme.csv)
    avatars/        profile pictures                 (you + everyone in your notifications)
    badges/         badge artwork                    (badge-unlocked notifications)
    characters/     characters you voted for         (poster images)
    friends/        your friends' avatars
    characters.json name/actor/poster + which episodes you voted in
    friends.json    your friends' real names

Images come from TV Time's CDN (no CORS, so a browser can't save them itself). The
character/friend names come from TV Time's *public* API (api2.tozelabs.com — no login
required), so this needs no credentials. Character posters are TheTVDB URLs, which
outlive TV Time; friend avatars are on TV Time's CDN, so they're downloaded here.

Pure standard library — needs only Python 3 (no bash, curl, or zip); runs the same on
macOS, Linux, and Windows.

Usage:
    python3 extended-backup.py [path-to-export-dir] [output.zip]

    path    directory containing your unzipped export.  Default: gdpr-data
    output  zip to write.                                Default: tvt-extended-backup.zip

Re-running is safe and resumable: already-downloaded images are skipped, and names
already resolved are kept if the API can no longer be reached.
"""

import csv
import json
import os
import re
import ssl
import sys
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.error import URLError

WORK = "tvt-extended-backup"
UA = "tvt-extended-backup"
API = "https://api2.tozelabs.com/v2"
IMG_EXTS = ("jpg", "jpeg", "png", "gif", "webp")

_ctx = ssl.create_default_context()
_insecure_warned = False


def ext_of(url):
    e = url.split("?", 1)[0].rsplit(".", 1)[-1].lower()
    return e if e in IMG_EXTS else "jpg"


def read_csv(export_dir, filename):
    path = os.path.join(export_dir, filename)
    if not os.path.exists(path):
        return
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        yield from csv.DictReader(f)


# ---------------------------------------------------------------- images (existing)
def build_map(export_dir):
    """[(folder, name, ext, url)] for comment/avatar/badge images."""
    items = []

    def add(folder, name, url):
        name, url = (name or "").strip(), (url or "").strip()
        if name and url:
            items.append((folder, str(name), ext_of(url), url))

    for r in read_csv(export_dir, "meme.csv"):
        mid = (r.get("id") or "").strip()
        if not mid:
            continue
        marked = (r.get("medium_url") or "").strip()
        clean = (r.get("clean_version_medium_url") or "").strip()
        if marked:
            add("comments", mid + "-marked", marked)
        if clean and clean != marked:
            add("comments", mid + "-clean", clean)

    for r in read_csv(export_dir, "routing-prod-users.csv"):
        add("avatars", (r.get("user_id") or "").strip(), r.get("image_url"))

    for r in read_csv(export_dir, "notifications-prod-notifications.csv"):
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

    seen, uniq = set(), []
    for it in items:
        k = (it[0], it[1])
        if k not in seen:
            seen.add(k)
            uniq.append(it)
    return uniq


# ---------------------------------------------------------------- networking
def _open(url):
    global _ctx, _insecure_warned
    req = Request(url, headers={"User-Agent": UA})
    try:
        return urlopen(req, timeout=60, context=_ctx)
    except URLError as e:
        if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
            if not _insecure_warned:
                print("warning: TLS verification failed; continuing without it (public data).", file=sys.stderr)
                _insecure_warned = True
            _ctx = ssl._create_unverified_context()
            return urlopen(req, timeout=60, context=_ctx)
        raise


def get_json(url):
    try:
        with _open(url) as r:
            return json.load(r)
    except Exception:
        return None


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


# ------------------------------------------------- extended: characters + friends
def poster_url(obj):
    p = obj.get("poster") if isinstance(obj, dict) else None
    if isinstance(p, dict):
        return (p.get("url") or "").strip() or None
    return None


def harvest_characters(export_dir):
    """Resolve show_character_id -> name/actor/poster via the public episode endpoint.
    Returns {char_id: {...}}. One fetch per voted episode."""
    votes = {}   # episode_id -> [(char_id, show, season, episode, date)]
    for r in read_csv(export_dir, "show_character_episode_vote.csv"):
        eid = (r.get("episode_id") or "").strip()
        cid = (r.get("show_character_id") or "").strip()
        if not eid or not cid:
            continue
        votes.setdefault(eid, []).append(
            (cid, r.get("tv_show_name", ""), r.get("episode_season_number", ""), r.get("episode_number", ""), r.get("created_at", "")))
    if not votes:
        return {}

    chars = {}

    def resolve(eid):
        d = get_json(f"{API}/episode/{eid}?fields=id,characters.fields(id,name,actor_name,poster)")
        by = {}
        if d and isinstance(d.get("characters"), list):
            for c in d["characters"]:
                by[str(c.get("id"))] = c
        return eid, by

    print(f"resolving {sum(len(v) for v in votes.values())} character votes ({len(votes)} episodes) via public API …", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=8) as ex:
        for eid, by in ex.map(resolve, list(votes)):
            for cid, show, season, episode, date in votes[eid]:
                entry = chars.setdefault(cid, {"id": cid, "name": None, "actor_name": None, "poster": None, "votes": []})
                c = by.get(str(cid))
                if c:
                    entry["name"] = c.get("name") or entry["name"]
                    entry["actor_name"] = c.get("actor_name") or entry["actor_name"]
                    entry["poster"] = poster_url(c) or entry["poster"]
                entry["votes"].append({"episode_id": eid, "show": show, "season": season, "episode": episode, "date": date})
    return chars


def harvest_friends(export_dir):
    """Resolve friend_id -> real name + avatar via the public user endpoint."""
    ids = []
    meta = {}
    for r in read_csv(export_dir, "friend.csv"):
        fid = (r.get("friend_id") or "").strip()
        if not fid:
            continue
        ids.append(fid)
        meta[fid] = {"since": r.get("created_at", ""), "affinity": r.get("affinity", "")}
    if not ids:
        return []

    def resolve(fid):
        d = get_json(f"{API}/user/{fid}?fields=id,name,username,avatar") or {}
        av = d.get("avatar") if isinstance(d.get("avatar"), dict) else {}
        return {"id": fid, "name": d.get("name"), "username": d.get("username"),
                "avatar": (av.get("url") or "").strip() or None,
                "since": meta[fid]["since"], "affinity": meta[fid]["affinity"]}

    print(f"resolving {len(ids)} friends via public API …", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=8) as ex:
        return list(ex.map(resolve, ids))


def merge_prev(new_list, filename, keep_if_missing="name"):
    """Keep previously-resolved names if a re-run can't reach the API (post-shutdown)."""
    prev_path = os.path.join(WORK, filename)
    if not os.path.exists(prev_path):
        return new_list
    try:
        prev = {str(x.get("id")): x for x in json.load(open(prev_path, encoding="utf-8"))}
    except Exception:
        return new_list
    for x in new_list:
        old = prev.get(str(x.get("id")))
        if old and not x.get(keep_if_missing):
            for k in ("name", "actor_name", "poster", "avatar", "username"):
                if not x.get(k) and old.get(k):
                    x[k] = old[k]
    return new_list


# ---------------------------------------------------------------- main
def main(argv):
    if len(argv) > 1 and argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0
    args = [a for a in argv[1:] if a not in ("-h", "--help")]
    export_dir = args[0] if len(args) > 0 else "gdpr-data"
    out = args[1] if len(args) > 1 else "tvt-extended-backup.zip"

    if os.path.isfile(export_dir):
        export_dir = os.path.dirname(export_dir) or "."
    if not os.path.isdir(export_dir):
        print(f"error: '{export_dir}' is not a directory. Point this at your unzipped export.", file=sys.stderr)
        return 1
    if not any(os.path.exists(os.path.join(export_dir, f)) for f in
               ("meme.csv", "notifications-prod-notifications.csv", "friend.csv", "show_character_episode_vote.csv")):
        print(f"error: no recognizable export CSVs found in '{export_dir}'.", file=sys.stderr)
        return 1

    os.makedirs(WORK, exist_ok=True)

    # 1) Resolve characters + friends via the public API (names + image URLs).
    characters = harvest_characters(export_dir)
    friends = harvest_friends(export_dir)

    # 2) Everything to download: comment/avatar/badge images + character posters + friend avatars.
    items = list(build_map(export_dir))
    for c in characters.values():
        if c.get("poster"):
            items.append(("characters", c["id"], ext_of(c["poster"]), c["poster"]))
    for f in friends:
        if f.get("avatar"):
            items.append(("friends", f["id"], ext_of(f["avatar"]), f["avatar"]))

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

    # 3) Write the resolved names (keeping any previously-resolved ones on failure).
    if characters:
        clist = merge_prev(list(characters.values()), "characters.json")
        json.dump(clist, open(os.path.join(WORK, "characters.json"), "w", encoding="utf-8"), ensure_ascii=False)
    if friends:
        flist = merge_prev(friends, "friends.json")
        json.dump(flist, open(os.path.join(WORK, "friends.json"), "w", encoding="utf-8"), ensure_ascii=False)

    named_c = sum(1 for c in characters.values() if c.get("name"))
    named_f = sum(1 for f in friends if f.get("name"))
    print(f"images: {len(items)} referenced · {results['ok']} downloaded · {results['skip']} already had · {results['fail']} failed")
    for folder in ("comments", "avatars", "badges", "characters", "friends"):
        d = os.path.join(WORK, folder)
        if os.path.isdir(d):
            n = sum(len(fs) for _, _, fs in os.walk(d))
            if n:
                print(f"  {folder}/: {n} files")
    if characters:
        print(f"  characters resolved: {named_c}/{len(characters)}")
    if friends:
        print(f"  friends resolved:    {named_f}/{len(friends)}")
    if results["fail"]:
        print(f"note: {results['fail']} images failed (deleted accounts / removed media). Re-run to retry.", file=sys.stderr)

    # 4) Pack the whole working folder into one zip (forward-slash arcnames for Windows).
    files = []
    for root, _, names in os.walk(WORK):
        for fn in names:
            p = os.path.join(root, fn)
            files.append((p, os.path.relpath(p, WORK).replace(os.sep, "/")))
    if not files:
        print("nothing to pack.", file=sys.stderr)
        return 1

    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path, arc in sorted(files, key=lambda x: x[1]):
            z.write(path, arc)
    print(f"wrote {out} ({len(files)} files) — import it via ⚙ → Import extended backup in the app.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
