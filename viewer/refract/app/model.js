import { norm, parseDate, slugify, toNum } from '../../app/core/util.js';

/* -------------------------------------------------------------------
   Refract export model. Four CSVs, no numeric ids anywhere: everything
   joins on (OriginalTitle|Title, Type). media.csv is the spine; episodes,
   lists and reviews resolve against it by title.
   ------------------------------------------------------------------- */

const SEP = '\u0001';   // key separator that can never appear in a title
const rowsOf = (tables, name) => (tables[name] || { rows: [] }).rows;
const val = (v) => (v == null ? '' : String(v).trim());
const yearOf = (v) => { const n = parseInt(v, 10); return n > 0 ? n : null; };   // Refract writes 0 for unknown
const ratingOf = (v) => { const n = toNum(v); return n > 0 ? n : null; };        // 1-10
const semiList = (v) => val(v) ? val(v).split(';').map(s => s.trim()).filter(Boolean) : [];

const kindOf = (type) => (type === 'Movie' ? 'movie' : 'tv');

export function buildRefractModel(tables) {
  if (!tables['media.csv']) {
    throw new Error('this doesn’t look like a Refract export (no media.csv). TV Time exports load at the site root instead.');
  }

  /* ---- media.csv: one entry per row, exact duplicates merged ---- */
  const media = [];
  const byExact = new Map();   // norm(origTitle|title) + type + year -> entry, to merge duplicate rows
  for (const r of rowsOf(tables, 'media.csv')) {
    const originalTitle = val(r.OriginalTitle);
    const title = val(r.Title) || originalTitle;
    if (!title) continue;
    const type = val(r.Type);
    const year = yearOf(r.Year);
    const exactKey = norm(originalTitle || title) + SEP + type + SEP + (year || '');
    const prev = byExact.get(exactKey);
    if (prev) {   // same title, type and year twice (seen in real exports): merge, prefer filled fields
      if (!prev.titleWasExplicit && val(r.Title)) { prev.title = val(r.Title); prev.titleWasExplicit = true; }
      if (!prev.countries.length) prev.countries = semiList(r.Country);
      if (!prev.rating) prev.rating = ratingOf(r.Rating);
      if (!prev.watchedDate) prev.watchedDate = parseDate(val(r.WatchedDate));
      if (val(r.Source) && !prev.sources.includes(val(r.Source))) prev.sources.push(val(r.Source));
      continue;
    }
    const entry = {
      title, originalTitle, year, type,
      isAnime: type === 'Anime',
      isMovie: type === 'Movie',
      titleWasExplicit: !!val(r.Title),
      countries: semiList(r.Country),
      status: val(r.Status),
      rating: ratingOf(r.Rating),
      watchedDate: parseDate(val(r.WatchedDate)),
      review: val(r.Review),
      sources: val(r.Source) ? [val(r.Source)] : [],
      reviews: [],
      ambiguous: false,
    };
    byExact.set(exactKey, entry);
    media.push(entry);
  }

  /* ---- title indexes: both title fields point at the entry ---- */
  const byTypeTitle = new Map();   // norm(title) + exact Type      -> [entry]
  const byKindTitle = new Map();   // norm(title) + 'tv'|'movie'    -> [entry]
  const indexEntry = (m) => {
    const keys = new Set([norm(m.originalTitle || m.title), norm(m.title)]);
    keys.delete('');
    for (const k of keys) {
      const tk = k + SEP + m.type, kk = k + SEP + kindOf(m.type);
      if (!byTypeTitle.has(tk)) byTypeTitle.set(tk, []);
      if (!byTypeTitle.get(tk).includes(m)) byTypeTitle.get(tk).push(m);
      if (!byKindTitle.has(kk)) byKindTitle.set(kk, []);
      if (!byKindTitle.get(kk).includes(m)) byKindTitle.get(kk).push(m);
    }
  };
  for (const m of media) indexEntry(m);

  const shows = media.filter(m => !m.isMovie);
  const movies = media.filter(m => m.isMovie);
  for (const s of shows) { s.episodes = new Map(); s.epWatched = 0; s.watches = 0; s.firstWatched = null; s.lastWatched = null; }

  /* ---- episodes.csv: attach each watch to a show ----
     Duplicate titles are real (Doctor Who 2005/2024 …) and episode rows carry
     no year, so attribution is a heuristic per watch: a show released after the
     watch can't be it; 'planned' entries had no watches; otherwise the show
     whose activity (last watched date, else release year) sits closest to the
     watch year wins, oldest on a tie. */
  const pickShow = (cands, wy) => {
    if (cands.length === 1) return cands[0];
    const score = (s) => [
      (s.year && wy && s.year > wy) ? 1 : 0,
      s.status === 'planned' ? 1 : 0,
      (wy && (s.watchedDate || s.year)) ? Math.abs(wy - (s.watchedDate ? s.watchedDate.getFullYear() : s.year)) : 99,
      s.year || 9999,
    ];
    return [...cands].sort((a, b) => {
      const sa = score(a), sb = score(b);
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
      return 0;
    })[0];
  };

  const history = [];
  for (const r of rowsOf(tables, 'episodes.csv')) {
    const t = val(r.ShowOriginalTitle) || val(r.ShowTitle);
    if (!t) continue;
    const type = val(r.ShowType);
    let cands = byTypeTitle.get(norm(t) + SEP + type) || byTypeTitle.get(norm(val(r.ShowTitle) || t) + SEP + type);
    if (!cands) {   // never seen in the sample export, but keep the row visible instead of dropping it
      const synth = {
        title: val(r.ShowTitle) || t, originalTitle: val(r.ShowOriginalTitle), year: null, type,
        isAnime: type === 'Anime', isMovie: false, countries: semiList(r.ShowCountry),
        status: '', rating: null, watchedDate: null, review: '', sources: [], reviews: [],
        ambiguous: false, synthetic: true,
        episodes: new Map(), epWatched: 0, watches: 0, firstWatched: null, lastWatched: null,
      };
      media.push(synth); shows.push(synth); indexEntry(synth);
      cands = [synth];
    }
    const date = parseDate(val(r.WatchedAt));
    const show = pickShow(cands, date && date.getFullYear());
    if (cands.length > 1) for (const c of cands) c.ambiguous = true;

    const season = toNum(r.Season), episode = toNum(r.Episode);
    const epKey = season + '|' + episode;
    let ep = show.episodes.get(epKey);
    if (!ep) { ep = { season, episode, count: 0, dates: [], rating: null }; show.episodes.set(epKey, ep); show.epWatched++; }
    ep.count++;
    if (date) ep.dates.push(date);
    if (ratingOf(r.Rating)) ep.rating = ratingOf(r.Rating);
    show.watches++;
    if (date) {
      if (!show.firstWatched || date < show.firstWatched) show.firstWatched = date;
      if (!show.lastWatched || date > show.lastWatched) show.lastWatched = date;
    }
    history.push({ type: 'episode', title: show.title, ref: show, season, episode, rewatch: ep.count > 1, date, ts: date ? date.getTime() : 0, rating: ep.rating });
  }
  for (const m of movies) {
    if (m.watchedDate) history.push({ type: 'movie', title: m.title, ref: m, date: m.watchedDate, ts: m.watchedDate.getTime(), rating: m.rating });
  }
  history.sort((a, b) => b.ts - a.ts);

  /* ---- slugs for detail routes: year suffix disambiguates duplicate titles ---- */
  const assignSlugs = (list) => {
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
  };
  assignSlugs(shows);
  assignSlugs(movies);

  /* ---- reviews.csv ---- */
  const reviews = [];
  for (const r of rowsOf(tables, 'reviews.csv')) {
    const t = val(r.OriginalTitle) || val(r.Title);
    if (!t) continue;
    const targetType = val(r.TargetType);
    const kind = targetType === 'Movie' ? 'movie' : targetType === 'Episode' ? 'episode' : 'show';
    let cands = byKindTitle.get(norm(t) + SEP + (kind === 'movie' ? 'movie' : 'tv'))
             || byKindTitle.get(norm(val(r.Title) || t) + SEP + (kind === 'movie' ? 'movie' : 'tv'))
             || [];
    const year = yearOf(r.Year);
    const target = (year && cands.find(c => c.year === year)) || cands[0] || null;
    const entry = {
      title: target ? target.title : (val(r.Title) || t),
      target, kind, targetType,
      season: val(r.Season) === '' ? null : toNum(r.Season),
      episode: val(r.Episode) === '' ? null : toNum(r.Episode),
      rating: ratingOf(r.Rating),
      text: val(r.Review),
      moodTags: semiList(r.MoodTags),
      watchContext: semiList(r.WatchContext),
      isSpoiler: val(r.IsSpoiler) === 'true',
      visibility: val(r.Visibility),
      completedOn: parseDate(val(r.CompletedOn)),
      date: parseDate(val(r.CreatedAt)) || parseDate(val(r.CompletedOn)),
    };
    reviews.push(entry);
    if (target) target.reviews.push(entry);
  }
  reviews.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));

  /* ---- lists.csv: one row per item, grouped by list name ---- */
  const listsByName = new Map();
  for (const r of rowsOf(tables, 'lists.csv')) {
    const name = val(r.ListName);
    if (!name) continue;
    if (!listsByName.has(name)) {
      listsByName.set(name, { name, description: val(r.Description), isPublic: val(r.IsPublic) === 'true', items: [] });
    }
    const list = listsByName.get(name);
    if (!list.description && val(r.Description)) list.description = val(r.Description);
    const t = val(r.OriginalTitle) || val(r.Title);
    const type = val(r.Type);
    const year = yearOf(r.Year);
    const cands = byTypeTitle.get(norm(t) + SEP + type) || byTypeTitle.get(norm(val(r.Title) || t) + SEP + type) || [];
    list.items.push({
      title: val(r.Title) || t, year, type, note: val(r.Note),
      position: toNum(r.Position),
      media: (year && cands.find(c => c.year === year)) || cands[0] || null,
    });
  }
  const lists = [...listsByName.values()];
  for (const l of lists) l.items.sort((a, b) => a.position - b.position);

  /* ---- stats for the home view ---- */
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
  for (const r of reviews) {
    if (r.rating) ratingHist.set(r.rating, (ratingHist.get(r.rating) || 0) + 1);
    for (const m of r.moodTags) moodCounts.set(m, (moodCounts.get(m) || 0) + 1);
  }
  const stats = {
    tvShows: shows.filter(s => !s.isAnime).length,
    anime: shows.filter(s => s.isAnime).length,
    movies: movies.length,
    episodesWatched: history.filter(h => h.type === 'episode').length,
    moviesWatched: movies.filter(m => m.status === 'completed' || m.watchedDate).length,
    lists: lists.length,
    reviews: reviews.length,
    epByMonth, moviesByYear, ratingHist,
    topMoods: [...moodCounts.entries()].sort((a, b) => b[1] - a[1]),
    firstWatch, lastWatch,
  };

  return { media, shows, movies, history, lists, reviews, stats };
}

// Detail-route lookup: disambiguated slug first, then the plain title slug
// (kit's entityNav only knows plain slugs; it lands on the first duplicate).
export const findBySlug = (list, slug) => list.find(m => m.slug === slug) || list.find(m => slugify(m.title) === slug);
