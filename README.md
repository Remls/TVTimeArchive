# TV Time Archive Viewer

A fully client-side web app that reads a TV Time GDPR data export (a `.zip` of CSV
tables) and displays your movie & TV data in a browsable, exportable format. All
parsing happens in your browser; the archive is never uploaded.

The app is in [`viewer/`](viewer/).

## Run locally

The app pulls a few libraries from CDNs, so serve it over HTTP rather than opening
the file directly:

```bash
cd viewer
python3 -m http.server 8777
# open http://localhost:8777/
```

Drop your export `.zip` on the page (or tap to choose it). It's remembered in the
browser (IndexedDB) and reloads automatically next time; "Change source .zip file"
in the ⚙ menu removes it.

Get your export from [TV Time's GDPR self-service](https://gdpr.tvtime.com/gdpr/self-service).

## Deploy

Static site, no build step. `netlify.toml` publishes the `viewer/` folder.
The repo root holds your own `gdpr-data.zip` / `gdpr-data/` — those are not part of
the published folder, and are git-ignored locally. Don't commit them to a public repo.

## Views

Mobile-first, responsive to desktop (bottom tab bar becomes a left sidebar on wide screens).

| View | What it is | Source CSV(s) |
|------|------------|---------------|
| **Overview** | Headline stats & recent activity | `tracking-prod-records-v2` (tracking-stats row) + counts |
| **Stats** | Biggest marathons, episodes/hours/movies per month | `stats-prod-cache` |
| **Shows** | Followed / watched / archived shows, episode counts, ratings | `followed_tv_show`, `tracking-prod-records-v2`, `tv_show_rate`, `tv_show_user_emotion_count`, `show_addiction_score`, `seen_episode_source` |
| **Movies** | Watched / watchlisted / reacted movies, with watch dates | `tracking-prod-records` (entity_type=movie) |
| **History** | Chronological watch timeline (episodes + movies) | `tracking-prod-records-v2`, `tracking-prod-records` |
| **Ratings** | 1–5 star ratings you gave shows | `tv_show_rate` |
| **Reactions** | Finish-episode / finish-movie reactions | `ratings-*` & `emotions-*` votes, `episode_emotion` |
| **Lists** | Custom lists & collections (items resolved to titles, with cover art) | `lists-prod-lists` (+ id/uuid → title lookups) |
| **Profile** | Account details | `user`, `user_personal_data`, `routing-prod-users` |
| **All data** | Browse / sort / filter / export any CSV in the archive | every `.csv` |

Curated views support search, sort, filter, and CSV/JSON export.

## Show / movie metadata (optional)

Off by default; toggle in the ⚙ Settings menu:

- **Auto-load show metadata** — episode titles, posters, and thumbnails from the
  keyless [TVmaze](https://www.tvmaze.com/api) API (matched by TheTVDB id). Show
  detail views also list per-episode watch dates.
- **Auto-load movie titles** — English titles for localized movie names via
  [Wikidata](https://www.wikidata.org) (no posters exist there for films).

Both cache results locally and send only a show/movie name to the respective API
when enabled.

## Notes on the data

- **Ratings vs reactions.** TV Time's `ratings-*`/`emotions-*` vote files encode a
  reaction id in the `vote_key` (`<entityId>-<userId>-<reactionId>`), not a star
  score. The only genuine 1–5 star rating is `tv_show_rate.csv`, shown under
  **Ratings**; the vote files are shown under **Reactions** (the 12 "how did you
  feel?" feelings, ids 28–39, are decoded).
- The social parts of the export (comments, likes, followers, notifications, memes)
  are skipped in curated views but remain browsable under **All data**.
