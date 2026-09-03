import { parseDate } from '../../../app/core/util.js';
import { assignSlugs, buildStats } from './shared.js';

/* -------------------------------------------------------------------
   Refract backup format 3.0. One .jsonl section per file, reaching the
   builder unflattened as tables[section].raw. library.jsonl is the spine
   and every media reference carries mediaItemId, so nothing joins on a
   title. The export has no country and no anime/TV distinction.
   ------------------------------------------------------------------- */

const rawOf = (tables, section) => (tables[section] || {}).raw || [];

/* Timestamps come two ways. A bare ISO string (lastWatchedAt, createdAt) is
   a real instant. A { local, tz } pair is the wall clock the user recorded,
   so `local` is read as a local calendar time: parseDate would treat a naive
   timestamp as UTC and shift the day for anyone outside that zone. */
function stampOf(v) {
  if (!v) return null;
  if (typeof v === 'string') return parseDate(v);
  if (!v.local) return null;
  const m = String(v.local).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : parseDate(v.local);
}

const numOr = (v) => (typeof v === 'number' && v > 0 ? v : null);   // 0 and null both mean unknown

/* episodes.jsonl keeps one row per episode with a rewatchCount, so the dates
   of the repeats live in the diary: every rewatch entry stashes a JSON
   payload in its notes naming the media, the season/episode and when it was
   rewatched. An episode's own watchedAt is its first watch and every snapshot
   sits after it, so the two never describe the same viewing. */
const REWATCH_PREFIX = '__rewatch_snapshot_v1__:';

function rewatchDates(tables) {
  const byEpisode = new Map();   // "mediaItemId|season|episode" -> [Date]
  const byMovie = new Map();     // mediaItemId -> [Date]
  for (const r of rawOf(tables, 'diary')) {
    const notes = r.notes || '';
    if (!notes.startsWith(REWATCH_PREFIX)) continue;
    let p;
    try { p = JSON.parse(notes.slice(REWATCH_PREFIX.length)); } catch { continue; }
    const date = parseDate(p.watchedDate);
    if (!date || !p.mediaItemId) continue;
    const c = p.episodeComposite;
    const into = (c && c.seasonNumber != null && c.episodeNumber != null)
      ? [byEpisode, `${p.mediaItemId}|${c.seasonNumber}|${c.episodeNumber}`]
      : [byMovie, p.mediaItemId];
    if (!into[0].has(into[1])) into[0].set(into[1], []);
    into[0].get(into[1]).push(date);
  }
  return { byEpisode, byMovie };
}

/* One library/media entry. `title` is the English one when Refract has it:
   item.title is a localized snapshot that changes between exports, while
   englishTitle is stable (though blank on some rows, hence the fallback). */
function entryOf(item) {
  return {
    mediaItemId: item.mediaItemId || '',
    tmdbId: numOr(item.tmdbId), imdbId: item.imdbId || '', tvdbId: numOr(item.tvdbId),
    title: item.englishTitle || item.title || '',
    originalTitle: item.title || '',
    titleWasExplicit: !!item.englishTitle,
    year: numOr(item.year),
    type: item.mediaType || 'tv',
    isAnime: false,          // v3 dropped the distinction; nothing in the export restores it
    isMovie: item.mediaType === 'movie',
    countries: [],           // v3 dropped the country column
    status: '',
    rating: null,
    watchedDate: null,
    review: '',
    sources: [],
    reviews: [],
    ambiguous: false,        // ids, not titles: never ambiguous
  };
}

export function buildV3Model(tables) {
  /* ---- library.jsonl: one entry per row, keyed by mediaItemId ---- */
  const media = [];
  const byId = new Map();
  for (const r of rawOf(tables, 'library')) {
    const item = r.item;
    if (!item || !item.mediaItemId || byId.has(item.mediaItemId)) continue;
    const entry = entryOf(item);
    entry.status = r.status || '';
    entry.rating = numOr(r.rating);
    entry.watchedDate = stampOf(r.lastWatchedAt);
    entry.sources = r.source ? [r.source] : [];
    byId.set(entry.mediaItemId, entry);
    media.push(entry);
  }

  const shows = media.filter(m => !m.isMovie);
  const movies = media.filter(m => m.isMovie);
  for (const s of shows) { s.episodes = new Map(); s.epWatched = 0; s.watches = 0; s.firstWatched = null; s.lastWatched = null; }

  /* ---- episodes.jsonl: one row per episode, not per watch. count comes from
     Refract's own rewatchCount; the dates come from watchedAt plus the diary's
     rewatch snapshots, which cover all but a handful of the repeats. ---- */
  const rewatch = rewatchDates(tables);
  for (const r of rawOf(tables, 'episodes')) {
    const item = r.item;
    if (!item || !item.mediaItemId) continue;
    let show = byId.get(item.mediaItemId);
    if (!show) {   // an episode whose show is missing from library: keep the watch visible
      show = entryOf(item);
      show.synthetic = true;
      show.episodes = new Map(); show.epWatched = 0; show.watches = 0; show.firstWatched = null; show.lastWatched = null;
      byId.set(show.mediaItemId, show); media.push(show); shows.push(show);
    }
    const season = r.seasonNumber ?? 0, episode = r.episodeNumber ?? 0;
    const epKey = season + '|' + episode;
    let ep = show.episodes.get(epKey);
    if (!ep) { ep = { season, episode, count: 0, dates: [], rating: null }; show.episodes.set(epKey, ep); show.epWatched++; }
    ep.count += 1 + (r.rewatchCount || 0);
    ep.rating = numOr(r.rating) || ep.rating;
    const first = stampOf(r.watchedAt);   // null on an episode marked watched without a date
    if (first) ep.dates.push(first);
    for (const d of rewatch.byEpisode.get(`${item.mediaItemId}|${season}|${episode}`) || []) ep.dates.push(d);
    ep.dates.sort((a, b) => a - b);
    show.watches += 1 + (r.rewatchCount || 0);
  }

  /* ---- watch history: one event per dated watch, the earliest being the
     original and the rest rewatches. An episode marked watched with no date
     still gets an event, so it shows up under an unknown date rather than
     vanishing. ---- */
  const history = [];
  for (const s of shows) {
    for (const ep of s.episodes.values()) {
      const base = { type: 'episode', title: s.title, ref: s, season: ep.season, episode: ep.episode, rating: ep.rating };
      if (!ep.dates.length) { history.push({ ...base, rewatch: false, date: null, ts: 0 }); continue; }
      ep.dates.forEach((date, i) => {
        if (!s.firstWatched || date < s.firstWatched) s.firstWatched = date;
        if (!s.lastWatched || date > s.lastWatched) s.lastWatched = date;
        history.push({ ...base, rewatch: i > 0, date, ts: date.getTime() });
      });
    }
  }
  for (const m of movies) {
    const dates = (m.watchedDate ? [m.watchedDate] : []).concat(rewatch.byMovie.get(m.mediaItemId) || []).sort((a, b) => a - b);
    dates.forEach((date, i) => history.push({ type: 'movie', title: m.title, ref: m, rewatch: i > 0, date, ts: date.getTime(), rating: m.rating }));
  }
  history.sort((a, b) => b.ts - a.ts);

  /* ---- slugs for detail routes ---- */
  assignSlugs(shows);
  assignSlugs(movies);

  const lists = [], reviews = [], ratings = [];

  /* ---- stats for the home view ---- */
  const stats = buildStats({ shows, movies, history, lists, reviews, ratings });

  return { media, shows, movies, history, lists, reviews, ratings, stats };
}
