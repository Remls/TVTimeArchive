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
it. Some of it is best-effort guesswork (how reactions are encoded, how the data fits
together across many tables). And some things aren't in the export at all — they live
on TV Time's servers behind images and IDs (comment/badge/avatar images, the
characters you voted for, your friends' names) — so they only survive a shutdown if
you capture them first: see [Extended backup](#extended-backup).

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

Three nav tabs are umbrellas that group related views — **Watch** (Shows · Movies ·
Watch history · Lists), **Ratings** (Ratings · Reactions · Character votes), and
**Community** (Comments · Notifications · Friends · Badges). On desktop their items nest
in the sidebar; on mobile, tapping the tab opens a popup menu.

| View | *(Group)* | What it shows |
|------|-----------|---------------|
| **Home** | | Headline totals, most-watched shows, biggest marathons, and episodes/hours/movies per month |
| **Shows** | *Watch* | Followed / watched / archived shows, episode progress, ratings |
| **Movies** | *Watch* | Watched / watchlisted / rated / reacted movies, with watch dates |
| **Watch history** | *Watch* | A chronological watch timeline of episodes and movies |
| **Lists** | *Watch* | Your custom lists and collections, resolved to titles with cover art |
| **Ratings** | *Ratings* | The Bad→Wow star ratings you gave — shows, movies and episodes |
| **Reactions** | *Ratings* | "How did you feel?" reactions, grouped per episode/movie |
| **Character votes** | *Ratings* | Characters you voted for — actor, poster, show/episodes (names & posters from the [extended backup](#extended-backup)) |
| **Comments** | *Community* | Every comment you posted, with attached images, likes, and reply threads |
| **Notifications** | *Community* | Read-only activity feed — likes, replies, mentions, follow requests, badges, airing reminders |
| **Friends** | *Community* | Your friends — real names and avatars (from the [extended backup](#extended-backup)) |
| **Badges** | *Community* | Badges you earned, grouped by type with counts and the shows that earned them |
| **Profile** | | Account details, avatar, and cover image |
| **All data** | | Browse, sort, filter, and export any CSV table in the archive |

Curated views support search, sort, filter, and CSV/JSON export.

## Extended backup

Some of your data lives behind TV Time's servers, not in the export: **images** on
its CDN (comment images, notification avatars, badge art, friends' avatars) and
**names** behind numeric IDs (the **characters** you voted for, and your **friends'**
real names). While TV Time is online the app fills these in live, but when the servers
go offline they're gone — unless you capture them first.

`extended-backup.py` builds one portable zip with everything. It's plain Python 3 (no other
dependencies), runs the same on macOS, Linux and Windows, and **needs no login** — the
names come from TV Time's public API, the images from its CDN.

1. Unzip your export somewhere (so `meme.csv` and friends sit in a folder).
2. Run it while TV Time is still up:

   ```bash
   python3 extended-backup.py path/to/your/export
   # writes tvt-extended-backup.zip
   ```

   It packs everything into one `tvt-extended-backup.zip`, in folders the app understands:
   `comments/`, `avatars/`, `badges/`, `characters/`, `friends/`, plus
   `characters.json` / `friends.json` for the resolved names. Comment memes are saved
   in both a clean and a watermarked "marked" variant. Re-running is safe and resumes
   over already-downloaded images (and keeps previously-resolved names if the API can
   no longer be reached).
3. In the app, open **⚙ → Import extended backup** (or the **Import backup** button at
   the top of the Comments view) and choose that zip.

Imported data is stored in your browser and shown from the local copy, so it keeps
working after TV Time is gone. Missing images fall back to a placeholder.

Character posters come from [TheTVDB](https://thetvdb.com) (which outlives TV Time),
and show posters / episode stills come from the keyless
[TVmaze](https://www.tvmaze.com/api) API (see below) — neither needs backing up.

## Optional metadata

Off by default; toggle in the ⚙ Settings menu. Both cache results locally and send
only a show or movie name to the API when enabled:

- **Show metadata** — episode titles, posters, and thumbnails from the keyless
  [TVmaze](https://www.tvmaze.com/api) API (matched by TheTVDB id).
- **Movie titles** — English titles for localized names via
  [Wikidata](https://www.wikidata.org).

## Notes on the data

- **Ratings vs reactions.** TV Time reused numeric IDs across many versioned "sets"
  over the years, and the export dropped the set name — so IDs are decoded by *source*.
  The `ratings-*` files (+ `tv_show_rate`) are the 5-level star scale (Bad/Meh/Okay/
  Good/Wow) shown under **Ratings** across shows, movies and episodes; the `emotions-*`
  files (+ the feelings hidden in `episode_emotion`) drive **Reactions** — the 12 "how
  did you feel?" feelings plus older emoji-grid reactions.
- **Comments.** Your comments are gathered from several tables (`episode_comment`,
  `show_comment`, `profile_comment`, and the newer `comments-prod-comments`), with
  images joined from `meme.csv`. Replies keep their parent's text only when the
  parent is also one of your comments — other people's comments aren't in the export.
- **Notifications & badges.** Your activity feed (`notifications-prod-notifications`)
  and earned badges (`user_badge`) each get a view; badge art and per-badge shows are
  reconstructed by joining IDs across tables, and follow-request notifications even
  recover a few usernames.
- **Friends & characters.** `friend.csv` and `show_character_episode_vote.csv` hold
  only numeric IDs — no names in the export. Their real names/avatars/posters are
  resolved from TV Time's public API by the extended-backup step above (before shutdown). Likes
  you *gave* have no dedicated view, but every table stays browsable under **All data**.

## Run your own copy

Static site, no build step. `netlify.toml` publishes the `viewer/` folder as-is;
any static host works. Keep your own export out of the published folder and out of
git.

## License

[MIT](LICENSE).
