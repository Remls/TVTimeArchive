# TV Time Archive Viewer

A client-side web app that reads your [TV Time](https://www.tvtime.com/) GDPR data
export — a `.zip` of CSV tables — and turns it into a browsable, searchable archive
of the shows and movies you've watched, rated, and reacted to.

Everything runs in your browser. The export is parsed locally and never uploaded;
it's kept in the browser's own storage (IndexedDB) so it reloads automatically on
your next visit.

Not affiliated with TV Time / Whip Media.

## Disclaimer

This is a **reader** for the data backup TV Time gives you — *not* a replacement for
it. Some of it is best-effort guesswork (how reactions are encoded, how the data
fits together across many tables), and some things simply can't be recovered from
the export they provide — your friends list, for example. Images that live on TV
Time's servers (comment memes, avatars, badge art) only survive a shutdown if you
back them up first — see [Backing up images](#backing-up-images).

I have no intention of running a server to hold this data centrally or to fill in
the gaps by crowdsourcing — managing other people's data is a can of worms I want no
part in. The app is provided as-is, and whether anything more gets added to it is
entirely at my discretion. You're of course free to
[fork it](https://github.com/Remls/TVTimeArchive/fork).

If you're looking for a replacement rather than an archive: I moved to
[Trakt](https://trakt.tv) (note that it has no social features); other options include [Sofa Time](https://www.sofatime.app/)
and [Refract](https://getrefract.app/).

## Get your export

Request your data from [TV Time's GDPR self-service](https://gdpr.tvtime.com/gdpr/self-service).
You'll receive a `.zip` by email. That file is all this app needs.

The export contains personal information (name, email, IP history, and more). Treat
it as private — don't commit it to a public repository or host it anywhere.

## Use it

Either open the hosted app at https://tvt.remls.io and drop your `.zip` on the page, or run it yourself.

The app loads a few libraries from a CDN, so serve it over HTTP rather than opening
the file directly:

```bash
cd viewer
python3 -m http.server 8777
# open http://localhost:8777/
```

Drop the export `.zip` on the page (or tap to choose it). It's remembered between
visits; "Change source .zip file" in the ⚙ menu forgets it and clears local storage.

## Views

| View | What it shows |
|------|---------------|
| **Overview** | Headline totals and recent activity |
| **Stats** | Biggest marathons; episodes, hours, and movies per month |
| **Shows** | Followed / watched / archived shows, episode progress, ratings |
| **Movies** | Watched / watchlisted / reacted movies, with watch dates |
| **History** | A chronological watch timeline of episodes and movies |
| **Ratings** | The 1–5 star ratings you gave shows |
| **Reactions** | Finish-episode / finish-movie reactions |
| **Lists** | Your custom lists and collections, resolved to titles with cover art |
| **Comments** | Every comment you posted, with attached images, likes, and reply threads |
| **Notifications** | Read-only activity feed — likes, replies, mentions, follow requests, badges, and airing reminders, with avatars |
| **Badges** | Badges you earned, grouped by type with counts and the shows that earned them |
| **Profile** | Account details, avatar, and cover image |
| **All data** | Browse, sort, filter, and export any CSV table in the archive |

Curated views support search, sort, filter, and CSV/JSON export.

## Backing up images

Some images come from TV Time's own CDN: your **comment images**, the **avatars** in
your Notifications feed, and **badge artwork**. While TV Time is online they load
straight from its servers — nothing extra needed. But when the servers go offline
those links break.

The browser can *display* those images but can't *read* their bytes to save them
(the CDN sends no CORS headers), so the backup is made with a small script rather
than a button in the app. It's plain Python 3 (no other dependencies) and runs the
same on macOS, Linux, and Windows:

1. Unzip your export somewhere (so `meme.csv` and friends sit in a folder).
2. Run the script against it while TV Time is still up:

   ```bash
   python3 backup-images.py path/to/your/export
   # writes tvt-image-backup.zip
   ```

   It downloads the images into folders — `comments/`, `avatars/`, `badges/` — and
   packs them into `tvt-image-backup.zip`. Comment memes are saved in both a clean
   and a watermarked "marked" variant; the app shows the clean one when it can and
   falls back to the marked one. Re-running is safe and resumes where it left off.
3. In the app, open **⚙ → Import image backup** (or the **Import backup** button at
   the top of the Comments view) and choose that zip.

Imported images are stored in your browser and shown from the local copy, so they
keep working after TV Time is gone. Missing images fall back to a placeholder.

Not all images need backing up — show posters and episode stills come from the
keyless [TVmaze](https://www.tvmaze.com/api) API (see below), which is unaffected by
TV Time shutting down.

## Optional metadata

Off by default; toggle in the ⚙ Settings menu. Both cache results locally and send
only a show or movie name to the API when enabled:

- **Show metadata** — episode titles, posters, and thumbnails from the keyless
  [TVmaze](https://www.tvmaze.com/api) API (matched by TheTVDB id).
- **Movie titles** — English titles for localized names via
  [Wikidata](https://www.wikidata.org).

## Notes on the data

- **Ratings vs reactions.** TV Time's `ratings-*` / `emotions-*` vote files encode a
  reaction id in the `vote_key` (`<entityId>-<userId>-<reactionId>`), not a star
  score. The only genuine 1–5 star rating is `tv_show_rate.csv`, shown under
  **Ratings**; the vote files drive **Reactions** (the 12 "how did you feel?"
  feelings, ids 28–39, are decoded).
- **Comments.** Your comments are gathered from several tables (`episode_comment`,
  `show_comment`, `profile_comment`, and the newer `comments-prod-comments`), with
  images joined from `meme.csv`. Replies keep their parent's text only when the
  parent is also one of your comments — other people's comments aren't in the export.
- **Notifications & badges.** Your activity feed (`notifications-prod-notifications`)
  and earned badges (`user_badge`) each get a view; badge art and per-badge shows are
  reconstructed by joining ids across tables, and follow-request notifications even
  recover a few usernames.
- **Friends** (`friend.csv`) are only opaque numeric ids — no usernames anywhere in
  the export — so there's no friends view. Likes you *gave* also have no dedicated
  view, but every table stays browsable under **All data**.

## Run your own copy

Static site, no build step. `netlify.toml` publishes the `viewer/` folder as-is;
any static host works. Keep your own export out of the published folder and out of
git.

## License

[MIT](LICENSE).
