import { parseDate } from '../../../app/core/util.js';
import { assignSlugs, buildStats } from './shared.js';

/* -------------------------------------------------------------------
   Refract backup format 3.0. One .jsonl section per file, reaching the
   builder as parsed rows on tables[section]. library.jsonl is the spine
   and every media reference carries mediaItemId, so nothing joins on a
   title. The export has no country and no anime/TV distinction.
   ------------------------------------------------------------------- */

const rawOf = (tables, section) => (tables[section] || {}).rows || [];

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

// v3 target types, mapped to the model's own vocabulary and to display labels.
const KIND = { tv: 'show', movie: 'movie', episode: 'episode' };
const TARGET_LABEL = { tv: 'TV Show', movie: 'Movie', episode: 'Episode' };

/* A few episode ratings name an episode that is nowhere else in the export:
   no mediaItemId, and an episodeTmdbId the episode table doesn't have. The
   rating is real, so it is kept and labelled rather than dropped. */
const UNKNOWN = 'Unknown title';

// diary.jsonl action types, as sentences rather than tokens.
const DIARY_LABEL = { completed: 'Completed', rewatch: 'Rewatched', episode: 'Watched', rated: 'Rated', added: 'Added' };

/* episodes.jsonl keeps one row per episode with a rewatchCount, so the dates
   of the repeats live in the diary: every rewatch entry stashes a JSON
   payload in its notes naming the media, the season/episode and when it was
   rewatched. An episode's own watchedAt is its first watch and every snapshot
   sits after it, so the two never describe the same viewing. */
const REWATCH_PREFIX = '__rewatch_snapshot_v1__:';

const rewatchPayload = (notes) => {
  if (!notes || !notes.startsWith(REWATCH_PREFIX)) return null;
  try { return JSON.parse(notes.slice(REWATCH_PREFIX.length)); } catch { return null; }
};

function rewatchDates(tables) {
  const byEpisode = new Map();   // "mediaItemId|season|episode" -> [{ at, userSet }]
  const byMovie = new Map();     // mediaItemId -> [{ at, userSet }]
  for (const r of rawOf(tables, 'diary')) {
    const p = rewatchPayload(r.notes);
    if (!p) continue;
    const date = parseDate(p.watchedDate);
    if (!date || !p.mediaItemId) continue;
    const c = p.episodeComposite;
    const into = (c && c.seasonNumber != null && c.episodeNumber != null)
      ? [byEpisode, `${p.mediaItemId}|${c.seasonNumber}|${c.episodeNumber}`]
      : [byMovie, p.mediaItemId];
    if (!into[0].has(into[1])) into[0].set(into[1], []);
    // The diary row says whether its date was picked by hand; the watch it
    // describes inherits that, so the accordion and history can mark it.
    into[0].get(into[1]).push({ at: date, userSet: r.userSetDate === true });
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
    comments: [],
    ambiguous: false,        // ids, not titles: never ambiguous
  };
}

export function buildV3Model(tables, manifest) {
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
  const epByTmdbSE = new Map();   // "showTmdbId|season|episode" -> { show, ep }
  const epByEpTmdb = new Map();   // episodeTmdbId -> { show, ep }
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
    if (!ep) { ep = { season, episode, count: 0, dates: [], handSet: new Set(), rating: null, comments: [] }; show.episodes.set(epKey, ep); show.epWatched++; }
    ep.count += 1 + (r.rewatchCount || 0);
    ep.rating = numOr(r.rating) || ep.rating;
    const first = stampOf(r.watchedAt);   // null on an episode marked watched without a date
    if (first) ep.dates.push(first);
    for (const d of rewatch.byEpisode.get(`${item.mediaItemId}|${season}|${episode}`) || []) {
      ep.dates.push(d.at);
      if (d.userSet) ep.handSet.add(d.at.getTime());
    }
    ep.dates.sort((a, b) => a - b);
    show.watches += 1 + (r.rewatchCount || 0);
    epByTmdbSE.set(`${item.tmdbId}|${season}|${episode}`, { show, ep });
    if (r.episodeTmdbId != null) epByEpTmdb.set(String(r.episodeTmdbId), { show, ep });
  }

  /* ---- ratings.jsonl: the authoritative rating list, one row per target.
     tv and movie rows put the mediaItemId in targetId. Episode rows carry no
     mediaItemId at all, so they resolve through the episode table by
     (show tmdbId, season, episode), else by episodeTmdbId. ---- */
  const resolveTarget = (r) => {
    if (r.targetType === 'episode') {
      return epByTmdbSE.get(`${r.mediaTmdbId}|${r.seasonNumber}|${r.episodeNumber}`)
          || epByEpTmdb.get(String(r.episodeTmdbId))
          || null;
    }
    const show = byId.get(r.targetId);
    return show ? { show, ep: null } : null;
  };

  const rated = new Map();          // dedupe key -> surviving rating entry
  const byTargetKey = new Map();    // "targetType|targetId" -> entry, every row including deduped ones,
                                    // so a mood tag keyed on a dropped id still finds its title
  const allRatings = [];
  const moodByRating = new Map();   // "targetType|targetId" -> mood tags, the pre-vibes home for them
  for (const r of rawOf(tables, 'ratings')) {
    const hit = resolveTarget(r);
    const target = hit && hit.show;
    if (r.moodTags && r.moodTags.length) moodByRating.set(`${r.targetType}|${r.targetId}`, r.moodTags);
    const entry = {
      title: target ? target.title : UNKNOWN,
      target, kind: KIND[r.targetType] || 'show', targetType: TARGET_LABEL[r.targetType] || r.targetType,
      targetKey: `${r.targetType}|${r.targetId}`,
      season: hit && hit.ep ? hit.ep.season : (r.seasonNumber ?? null),
      episode: hit && hit.ep ? hit.ep.episode : (r.episodeNumber ?? null),
      rating: numOr(r.value),
      date: parseDate(r.createdAt) || stampOf(r.completedOn),
      completedOn: stampOf(r.completedOn),
      moodTags: r.moodTags || [],
      watchContext: r.watchContext || [],
      visibility: r.visibility || '',
      source: r.source || '',
      ep: hit && hit.ep,
    };
    /* The TV Time migration re-recorded ratings that already existed natively:
       a "gdpr-ep-…" legacy_import row beside a refract row for the same
       episode and the same value. Keep the native one. */
    const key = target
      ? (entry.kind === 'episode' ? `${target.mediaItemId}|${entry.season}|${entry.episode}` : target.mediaItemId)
      : entry.targetKey;
    const prev = rated.get(key);
    if (!prev || (prev.source === 'legacy_import' && entry.source !== 'legacy_import')) rated.set(key, entry);
    byTargetKey.set(entry.targetKey, entry);
    allRatings.push(entry);
  }

  const ratings = [...rated.values()];
  for (const r of ratings) if (r.ep) r.ep.rating = r.rating || r.ep.rating;   // surface it on the seasons accordion too
  for (const r of allRatings) delete r.ep;
  ratings.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));

  /* ---- mood tags. vibes.jsonl scopes them per target, where ratings.moodTags
     aggregates a show's episode tags upward, so vibes wins when the export has
     that section. Its episode rows carry no item, so titles come from the
     rating on the same target. ---- */
  const vibeRows = rawOf(tables, 'vibes');
  const moodFor = new Map();
  if (vibeRows.length) {
    for (const v of vibeRows) {
      if (v.moodTags && v.moodTags.length) moodFor.set(`${v.targetType}|${v.targetId}`, { tags: v.moodTags, date: parseDate(v.createdAt) });
    }
  } else {
    for (const [k, tags] of moodByRating) moodFor.set(k, { tags, date: null });
  }

  const reactions = [];
  for (const [key, mood] of moodFor) {
    const r = byTargetKey.get(key);
    const [targetType] = key.split('|');
    reactions.push({
      title: r ? r.title : UNKNOWN,
      target: r ? r.target : null,
      kind: KIND[targetType] || 'show',
      targetType: TARGET_LABEL[targetType] || targetType,
      season: r ? r.season : null,
      episode: r ? r.episode : null,
      rating: r ? r.rating : null,
      moodTags: mood.tags,
      watchContext: (r && r.watchContext) || [],
      date: mood.date || (r && r.date) || null,
    });
  }
  reactions.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));

  /* ---- reviews.jsonl: written prose only. The rating, mood tags and
     completion date for the same target live in ratings and vibes. ---- */
  const reviews = [];
  for (const r of rawOf(tables, 'reviews')) {
    const key = `${r.targetType}|${r.targetId}`;
    const scored = byTargetKey.get(key);
    const hit = resolveTarget(r);
    const target = (hit && hit.show) || (scored && scored.target) || null;
    const mood = moodFor.get(key);
    const entry = {
      title: target ? target.title : UNKNOWN,
      target, kind: KIND[r.targetType] || 'show', targetType: TARGET_LABEL[r.targetType] || r.targetType,
      season: r.seasonNumber ?? null,
      episode: r.episodeNumber ?? null,
      rating: scored ? scored.rating : null,
      text: r.body || '',
      moodTags: (mood && mood.tags) || [],
      watchContext: (scored && scored.watchContext) || [],
      isSpoiler: !!r.isSpoiler,
      visibility: r.visibility || '',
      completedOn: scored ? scored.completedOn : null,
      date: parseDate(r.createdAt),
    };
    reviews.push(entry);
    if (target) target.reviews.push(entry);
  }
  reviews.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
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
        history.push({ ...base, rewatch: i > 0, date, ts: date.getTime(), userSetDate: ep.handSet.has(date.getTime()) });
      });
    }
  }
  for (const m of movies) {
    const dates = (m.watchedDate ? [{ at: m.watchedDate, userSet: false }] : [])
      .concat(rewatch.byMovie.get(m.mediaItemId) || [])
      .sort((a, b) => a.at - b.at);
    dates.forEach((d, i) => history.push({ type: 'movie', title: m.title, ref: m, rewatch: i > 0, date: d.at, ts: d.at.getTime(), rating: m.rating, userSetDate: d.userSet }));
  }
  history.sort((a, b) => b.ts - a.ts);

  /* ---- slugs for detail routes ---- */
  assignSlugs(shows);
  assignSlugs(movies);

  /* ---- lists.jsonl + list_items.jsonl, joined on listId. v1 denormalized
     both into one row per item; v3 keeps the list's own metadata separate.
     Each list carries the sortOrder Refract displays it in, and each item a
     zero-based sortOrder within its list. ---- */
  const lists = [];
  const listById = new Map();
  for (const r of rawOf(tables, 'lists')) {
    if (!r.listId || listById.has(r.listId)) continue;
    const entry = {
      listId: r.listId,
      name: r.title || '',
      description: r.description || '',
      isPublic: !!r.isPublic,
      visibility: r.visibility || '',
      isSmartList: !!r.isSmartList,
      isOrdered: !!r.isOrdered,
      sortOrder: r.sortOrder ?? 0,
      items: [],
    };
    listById.set(entry.listId, entry);
    lists.push(entry);
  }
  for (const r of rawOf(tables, 'list_items')) {
    const list = listById.get(r.listId);
    if (!list) continue;   // an item whose list is not in the export
    const item = r.item || {};
    const media = byId.get(item.mediaItemId) || null;
    list.items.push({
      title: media ? media.title : (item.englishTitle || item.title || ''),
      year: media ? media.year : numOr(item.year),
      type: item.mediaType || '',
      note: r.note || '',
      position: r.sortOrder ?? 0,
      addedAt: parseDate(r.addedAt),
      media,
    });
  }
  for (const l of lists) l.items.sort((a, b) => a.position - b.position);
  lists.sort((a, b) => a.sortOrder - b.sortOrder);

  /* ---- diary.jsonl: Refract's activity log, one row per thing you did. ---- */
  const diary = [];
  for (const r of rawOf(tables, 'diary')) {
    const item = r.item || {};
    const target = byId.get(item.mediaItemId) || null;
    /* A rewatch row's note is the machine-readable snapshot, not prose. Its
       payload still names the season and episode, so the entry reads the same
       way a plain watch does ("S1E12") instead of showing nothing. */
    const snap = rewatchPayload(r.notes);
    const composite = snap && snap.episodeComposite;
    const note = snap
      ? (composite && composite.seasonNumber != null && composite.episodeNumber != null
          ? `S${composite.seasonNumber}E${composite.episodeNumber}` : '')
      : (r.notes || '');
    diary.push({
      action: r.actionType || '',
      label: DIARY_LABEL[r.actionType] || r.actionType || '',
      title: target ? target.title : (item.englishTitle || item.title || UNKNOWN),
      target,
      kind: item.mediaType === 'movie' ? 'movie' : 'show',
      rating: numOr(r.rating),
      note,
      imported: !!r.imported,
      userSetDate: r.userSetDate === true,   // the date was picked by hand rather than recorded
      date: stampOf(r.actionDate) || parseDate(r.occurredAt),
    });
  }
  diary.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));

  /* ---- favorites.jsonl. `kind` splits anime from shows, which nothing else
     in v3 does, but the badge follows mediaType like every other view. ---- */
  const favorites = [];
  for (const r of rawOf(tables, 'favorites')) {
    const item = r.item || {};
    const target = byId.get(item.mediaItemId) || null;
    favorites.push({
      title: target ? target.title : (item.englishTitle || item.title || UNKNOWN),
      target,
      kind: item.mediaType === 'movie' ? 'movie' : 'show',
      season: r.seasonNumber ?? null,
      episode: r.episodeNumber ?? null,
      episodeName: r.episodeName || '',
      personName: r.personName || '',
      sortOrder: r.sortOrder ?? null,
      date: parseDate(r.createdAt),
    });
  }
  favorites.sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity)
    || (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));

  /* ---- comments.jsonl, present only when the export included archived
     sections. An episode comment's targetId is a TMDB episode id, so it
     resolves through the same index the ratings use; tv and movie comments
     carry a mediaItemId. Replies to other people's comments name a comment
     that is not in your own export, so they keep their text and lose their
     thread. ---- */
  const comments = [];
  for (const r of rawOf(tables, 'comments')) {
    const hit = r.targetType === 'episode'
      ? epByEpTmdb.get(String(r.targetId))
      : (byId.has(r.targetId) ? { show: byId.get(r.targetId), ep: null } : null);
    const target = hit && hit.show;
    const entry = {
      title: target ? target.title : UNKNOWN,
      target,
      kind: KIND[r.targetType] || 'show',
      targetType: r.targetType === 'comment' ? 'Reply' : (TARGET_LABEL[r.targetType] || r.targetType),
      season: hit && hit.ep ? hit.ep.season : null,
      episode: hit && hit.ep ? hit.ep.episode : null,
      text: r.body || '',
      isSpoiler: !!r.isSpoiler,
      visibility: r.visibility || '',
      source: r.source || '',
      moodTags: [], watchContext: [], rating: null,   // so a comment renders like a review
      date: parseDate(r.createdAt),
      editedAt: parseDate(r.editedAt),
    };
    entry.id = r.id || '';
    entry.replyTo = r.targetType === 'comment' ? String(r.targetId) : '';
    comments.push(entry);
    // An episode comment belongs to its episode row; a show or movie one to the title.
    if (hit && hit.ep) hit.ep.comments.push(entry);
    else if (target) target.comments.push(entry);
  }
  /* A reply names the comment it answers. Refract exports only your own
     comments, so a reply to someone else's has no parent here. */
  const commentById = new Map(comments.filter(c => c.id).map(c => [c.id, c]));
  for (const c of comments) if (c.replyTo) c.parent = commentById.get(c.replyTo) || null;
  comments.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
  // oldest first within an episode, so a comment reads before any follow-up
  for (const s of shows) for (const ep of s.episodes.values()) ep.comments.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));

  /* ---- profile.jsonl: one row of account settings. Most of it is kept
     verbatim for the view to label; only the parts needing other sections are
     resolved here. avatarUrl is a path on Refract's own server rather than a
     URL, so there is nothing to load and the view falls back to an initial. ---- */
  const raw = rawOf(tables, 'profile')[0] || null;
  /* One row per year, so this grows rather than being a single setting. */
  const goals = rawOf(tables, 'yearly_goals')
    .map(g => ({ ...g, completedAt: parseDate(g.completedAt) }))
    .sort((a, b) => (b.year || 0) - (a.year || 0));
  const profile = raw && {
    ...raw,
    displayName: raw.displayName || raw.username || '',
    name: [raw.firstName, raw.lastName].filter(Boolean).join(' '),
    avatar: /^https?:\/\//.test(raw.avatarUrl || '') ? raw.avatarUrl : '',
    banner: /^https?:\/\//.test(raw.bannerUrl || '') ? raw.bannerUrl : '',
    featuredList: (listById.get(raw.featuredListId) || {}).name || '',
    backup: manifest ? {
      generatedAt: parseDate(manifest.generatedAt),
      formatVersion: manifest.formatVersion || '',
      includeArchived: !!(manifest.options || {}).includeArchived,
      sections: Object.keys(manifest.sections || {}).length,
    } : null,
  };

  /* ---- stats for the home view ---- */
  const stats = buildStats({ shows, movies, history, lists, reviews, ratings, reactions });

  return { media, shows, movies, history, lists, reviews, ratings, reactions, diary, favorites, comments, profile, goals, stats };
}
