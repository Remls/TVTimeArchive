import { slugify } from '../../../app/core/util.js';

/* -------------------------------------------------------------------
   Pieces both format builders produce identically. They live here rather
   than in model.js so neither builder has to import its own dispatcher.
   ------------------------------------------------------------------- */

/* Detail-route slugs: a year suffix disambiguates duplicate titles. */
export function assignSlugs(list) {
  const bySlug = new Map();
  for (const m of list) {
    const s = slugify(m.title) || 'untitled';
    if (!bySlug.has(s)) bySlug.set(s, []);
    bySlug.get(s).push(m);
  }
  for (const [s, group] of bySlug) {
    if (group.length === 1) { group[0].slug = s; continue; }
    group.forEach((m, i) => { m.slug = s + '-' + (m.year || 'v' + (i + 1)); });
  }
  // Same title and same year still collides. v1 merged those rows into one
  // entry; v3 keeps them apart on their ids, so the year suffix is not always
  // enough. The first claimant keeps the bare slug, later ones get a counter.
  const used = new Set();
  for (const m of list) {
    let s = m.slug;
    for (let n = 2; used.has(s); n++) s = m.slug + '-' + n;
    used.add(s);
    m.slug = s;
  }
}

/* Home-view rollups. v3 carries no anime flag, so its shows all land under
   tvShows and anime comes out zero. */
export function buildStats({ shows, movies, history, lists, reviews, ratings, reactions }) {
  const epByMonth = new Map(), moviesByYear = new Map(), ratingHist = new Map(), moodCounts = new Map();
  let firstWatch = null, lastWatch = null;
  for (const h of history) {
    if (!h.date) continue;
    if (!firstWatch || h.date < firstWatch) firstWatch = h.date;
    if (!lastWatch || h.date > lastWatch) lastWatch = h.date;
    if (h.type === 'episode') {
      const mk = h.date.getFullYear() + '-' + String(h.date.getMonth() + 1).padStart(2, '0');
      epByMonth.set(mk, (epByMonth.get(mk) || 0) + 1);
    } else {
      const yk = String(h.date.getFullYear());
      moviesByYear.set(yk, (moviesByYear.get(yk) || 0) + 1);
    }
  }
  // Every watch of an episode Refract knows a runtime for. v1 carries no
  // runtimes at all, so it comes out zero and the Home card stays hidden.
  let seriesRuntime = 0;
  for (const s of shows) for (const ep of s.episodes?.values() || []) seriesRuntime += ep.runtime * ep.count * 60;
  for (const r of ratings) ratingHist.set(r.rating, (ratingHist.get(r.rating) || 0) + 1);
  for (const r of reactions) for (const m of r.moodTags) moodCounts.set(m, (moodCounts.get(m) || 0) + 1);
  return {
    tvShows: shows.filter(s => !s.isAnime).length,
    anime: shows.filter(s => s.isAnime).length,
    movies: movies.length,
    episodesWatched: history.filter(h => h.type === 'episode').length,
    moviesWatched: movies.filter(m => m.status === 'completed' || m.watchedDate).length,
    lists: lists.length,
    reviews: reviews.length,
    ratings: ratings.length,
    seriesRuntime,
    epByMonth, moviesByYear, ratingHist,
    topMoods: [...moodCounts.entries()].sort((a, b) => b[1] - a[1]),
    firstWatch, lastWatch,
  };
}
