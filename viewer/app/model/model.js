import { EMOTION_LABELS, LEVEL_LABEL, OLD_EMOTION_RATING, RATING_LABELS, reactionChipText, reactionIdFromKey } from '../core/decode.js';
import { notifImageRef } from '../core/media.js';
import { STATE, T } from '../core/state.js';
import { Extended } from '../core/storage.js';
import { $, nonEmpty, norm, parseDate, slugify, toNum } from '../core/util.js';

export function buildModel(tables) {
  const m = {};

  /* ---- Profile: user.csv + user_personal_data.csv + user_tv_show_data.csv ---- */
  m.profile = buildProfile();

  /* ---- History: v2 watch/rewatch episodes + movie watches + rewatched_episode.
     Built early so ratings can borrow watch dates (the ratings files carry none). ---- */
  m.history = buildHistory();

  /* ---- Ratings: the 5-level star scale for shows (tv_show_rate) + episodes/movies
     (ratings-* vote files). Decoded via RATING_LABELS. See buildRatings(). ---- */
  m.ratings = buildRatings(m.history);

  /* ---- Reactions: the "how did you feel?" emotions only (emotions-* + episode_emotion);
     star ratings are handled by buildRatings(). ---- */
  m.reactions = buildReactions(m.history);

  /* ---- Per-show reaction totals: tv_show_user_emotion_count.csv ---- */
  m.emotionPerShow = buildEmotionPerShow();

  /* ---- Shows: followed_tv_show + v2 user-series + ratings + reactions + addiction + seen ---- */
  m.shows = buildShows(m.ratings, m.reactions, m.emotionPerShow, m.history);

  /* ---- Movies: tracking-prod-records(entity=movie) + ratings + reaction votes ---- */
  m.movies = buildMovies(m.reactions, m.ratings, m.history);

  /* ---- Lists: lists-prod-lists.csv (collection + per-list items, titles resolved) ---- */
  m.lists = buildLists();

  /* ---- Comments: your posts across episode/show/movie/profile comment tables,
     with attached images (meme.csv) and reply threading where recoverable ---- */
  m.comments = buildComments(m.shows);

  /* ---- Notifications: read-only activity feed (likes, replies, mentions, follows,
     badges, airing reminders) from notifications-prod-notifications.csv ---- */
  m.notifications = buildNotifications();

  /* ---- Badges: user_badge.csv, grouped by badge type with art from notifications ---- */
  m.badges = buildBadges();

  /* ---- Characters & Friends: ids from the export, names/images from the extended backup ---- */
  m.characters = buildCharacters();
  m.friends = buildFriends();

  /* ---- Stats: stats-prod-cache.csv (marathons, per-month charts) ---- */
  m.stats = buildStats();

  /* ---- Overview headline stats: tracking-stats row + counts across sources ---- */
  m.overview = buildOverview(m);

  return m;
}

/* ---------------- Profile ---------------- */
export function buildProfile() {
  const u = T('user.csv')[0] || {};
  const personal = {};
  for (const r of T('user_personal_data.csv')) if (r.name) personal[r.name] = r.value;
  const tvd = {};
  for (const r of T('user_tv_show_data.csv')) if (r.name) tvd[r.name] = r.value;

  // user.csv `name` is often just the numeric user id — treat that as "no real name".
  const rawName = (u.name || '').trim();
  const realName = (rawName && rawName !== u.id && !/^\d+$/.test(rawName)) ? rawName : '';
  const routing = T('routing-prod-users.csv')[0] || {};
  const username = (routing.username || (T('auth-prod-login.csv').find(r => r.username) || {}).username || '').trim();
  // Greeting: real name, else username (no @), else nothing.
  const displayName = realName || username;

  return {
    name: realName || '—',
    username,
    displayName,
    avatar: (routing.image_url || '').trim(),      // profile picture (CloudFront)
    userId: (routing.user_id || u.id || '').trim(),
    email: u.mail || personal.email || '—',
    language: u.language || '—',
    timezone: u.timezone || '—',
    createdAt: parseDate(u.created_at),
    lastOpened: parseDate(u.last_opened),
    daysActive: u.nb_days_active,
    weeksActive: u.nb_weeks_active,
    monthsActive: u.nb_months_active,
    raw: u, personal, tvShowData: tvd,
  };
}

// Latest watch date per episode / movie — used as the "rated/reacted on" proxy since
// the vote files carry no timestamp of their own.
export function watchDates(history) {
  const ep = {}, mv = {};
  for (const e of history || []) {
    if (!e.date) continue;
    if (e.type === 'episode') { const k = `${norm(e.title)}|${e.season}|${e.episode}`; if (!ep[k] || e.date > ep[k]) ep[k] = e.date; }
    else if (e.type === 'movie') { const k = norm(e.title); if (!mv[k] || e.date > mv[k]) mv[k] = e.date; }
  }
  return { ep, mv };
}

export function buildRatings(history) {
  const shows = {}, movies = {}, eps = {};   // keyed lookups; value = { stars, label, ... }
  const put = (bucket, k, meta) => { if (!bucket[k] || meta.stars > bucket[k].stars) bucket[k] = meta; };
  const { ep: epWatch, mv: movieWatch } = watchDates(history);

  const ratingFiles = ['ratings-3-prod-episode_votes.csv', 'ratings-prod-episode_votes.csv', 'ratings-live-votes.csv', 'ratings-v2-prod-votes.csv'];
  for (const f of ratingFiles) {
    for (const r of T(f)) {
      const rl = RATING_LABELS[reactionIdFromKey(r.vote_key, r.user_id)];
      if (!rl) continue;
      const base = { stars: rl[0], label: rl[1] };
      if (r.movie_name) put(movies, norm(r.movie_name), { ...base, kind: 'movie', title: r.movie_name, date: movieWatch[norm(r.movie_name)] || null });
      else if (r.series_name) { const k = `${norm(r.series_name)}|${r.season_number || ''}|${r.episode_number || ''}`;
        put(eps, k, { ...base, kind: 'episode', title: r.series_name, season: r.season_number || '', episode: r.episode_number || '', date: epWatch[k] || null }); }
    }
  }
  // Old show-level 1–5 star rating (this one has a real timestamp).
  for (const r of T('tv_show_rate.csv')) {
    if (!r.tv_show_name) continue;
    const stars = Math.max(1, Math.min(5, Math.round(toNum(r.rating))));
    put(shows, norm(r.tv_show_name), { kind: 'show', title: r.tv_show_name, stars, label: LEVEL_LABEL[stars] || '', date: parseDate(r.created_at) });
  }
  // Ratings hidden in the old episode_emotion table (ids that aren't emotions).
  for (const r of T('episode_emotion.csv')) {
    if (!r.tv_show_name) continue;
    const id = toNum(r.emotion_id) || null;
    if (EMOTION_LABELS[id]) continue;          // it's a feeling → handled by buildReactions
    const rl = OLD_EMOTION_RATING[id]; if (!rl) continue;
    const k = `${norm(r.tv_show_name)}|${r.episode_season_number || ''}|${r.episode_number || ''}`;
    put(eps, k, { stars: rl[0], label: rl[1], kind: 'episode', title: r.tv_show_name, season: r.episode_season_number || '', episode: r.episode_number || '', date: parseDate(r.created_at) || epWatch[k] || null });
  }

  const list = [...Object.values(shows), ...Object.values(movies), ...Object.values(eps)]
    .sort((a, b) => b.stars - a.stars || a.title.localeCompare(b.title));
  return { list, epByKey: eps, movieByTitle: movies, showByTitle: shows };
}

/* ---------------- Reactions (emotions) ----------------
   The "how did you feel?" emotions — feelings only (star ratings live in buildRatings).
   Sources: emotions-3/v2 votes, emotions-live (movies), episode_emotion. */
export function buildReactions(history) {
  const list = [];
  for (const f of ['emotions-3-prod-episode_votes.csv', 'emotions-v2-prod-votes.csv']) {
    for (const r of T(f)) {
      const title = r.series_name || r.movie_name;
      if (!title) continue;
      list.push({ kind: r.movie_name ? 'movie' : 'episode', title, season: r.season_number || '', episode: r.episode_number || '',
        reactionId: reactionIdFromKey(r.vote_key, r.user_id), date: null, source: f.replace('.csv', '') });
    }
  }
  for (const r of T('emotions-live-votes.csv')) {
    if (!r.movie_name) continue;
    list.push({ kind: 'movie', title: r.movie_name, season: '', episode: '', reactionId: reactionIdFromKey(r.vote_key, r.user_id), date: null, source: 'emotions-live' });
  }
  for (const r of T('episode_emotion.csv')) {
    if (!r.tv_show_name) continue;
    const id = toNum(r.emotion_id) || null;
    if (!EMOTION_LABELS[id]) continue;   // ids that aren't feelings are old ratings → buildRatings
    list.push({ kind: 'episode', title: r.tv_show_name, season: r.episode_season_number || '', episode: r.episode_number || '', reactionId: id, date: parseDate(r.created_at), source: 'episode_emotion' });
  }

  // The emotion vote files carry no timestamp; borrow the latest watch date as a proxy
  // (a reaction is left right after watching). episode_emotion keeps its real date.
  const { ep: epWatch, mv: movieWatch } = watchDates(history);
  for (const r of list) {
    if (r.date) continue;
    r.date = (r.kind === 'movie' ? movieWatch[norm(r.title)] : epWatch[`${norm(r.title)}|${r.season}|${r.episode}`]) || null;
  }

  // Per-entity decoded-label lookups (Movie / Show detail) + a grouped view where each
  // episode/movie is one row carrying all its feeling chips.
  const epByKey = {}, movieByTitle = {}, countByTitle = {}, byEntity = {};
  for (const r of list) {
    countByTitle[norm(r.title)] = (countByTitle[norm(r.title)] || 0) + 1;
    const label = reactionChipText(r.reactionId, r.source);
    if (!label) continue;
    if (r.kind === 'movie') (movieByTitle[norm(r.title)] ||= new Set()).add(label);
    else (epByKey[`${norm(r.title)}|${r.season}|${r.episode}`] ||= new Set()).add(label);

    const key = r.kind === 'movie' ? `m|${norm(r.title)}` : `e|${norm(r.title)}|${r.season}|${r.episode}`;
    const g = byEntity[key] || (byEntity[key] = { kind: r.kind, title: r.title, season: r.season, episode: r.episode, reactions: [], _seen: new Set(), date: null });
    if (!g._seen.has(label)) { g._seen.add(label); g.reactions.push(label); }
    if (r.date && (!g.date || r.date > g.date)) g.date = r.date;
  }
  const grouped = Object.values(byEntity).map(g => { delete g._seen; return g; });
  return { list, grouped, countByTitle, epByKey, movieByTitle };
}

/* ---------------- Per-show reaction totals ----------------
   tv_show_user_emotion_count.csv — TV Time's own per-show reaction tally. */
export function buildEmotionPerShow() {
  const perShow = {};
  for (const r of T('tv_show_user_emotion_count.csv')) {
    if (!r.tv_show_name) continue;
    perShow[norm(r.tv_show_name)] = (perShow[norm(r.tv_show_name)] || 0) + toNum(r.count);
  }
  return perShow;
}

/* ---------------- History (watch timeline) ----------------
   Episodes: tracking-prod-records-v2.csv  (key starts watch-episode / rewatch-episode)
   Movies:   tracking-prod-records.csv     (entity_type == movie, type == watch/rewatch)
   Extra rewatches: rewatched_episode.csv */
export function buildHistory() {
  const events = [];

  for (const r of T('tracking-prod-records-v2.csv')) {
    const key = r.key || '';
    if (key.startsWith('watch-episode') || key.startsWith('rewatch-episode')) {
      const d = parseDate(r.created_at);
      events.push({
        date: d, ts: d ? d.getTime() : 0,
        type: 'episode',
        rewatch: key.startsWith('rewatch-episode'),
        title: r.series_name || '(unknown series)',
        seriesId: r.s_id || '',
        season: r.season_number, episode: r.episode_number,
        runtime: toNum(r.runtime),
      });
    }
  }

  for (const r of T('tracking-prod-records.csv')) {
    if (r.entity_type !== 'movie') continue;
    if (r.type !== 'watch' && r.type !== 'rewatch') continue;
    const d = parseDate(r.watch_date) || parseDate(r.created_at);
    events.push({
      date: d, ts: d ? d.getTime() : 0,
      type: 'movie',
      rewatch: r.type === 'rewatch',
      title: r.movie_name || '(unknown movie)',
      season: '', episode: '',
      runtime: toNum(r.runtime),
    });
  }

  events.sort((a, b) => b.ts - a.ts);
  return events;
}

/* ---------------- Shows ----------------
   Merge, keyed by normalized title:
     followed_tv_show.csv        -> follow status, folder, followed date
     tracking-prod-records-v2    -> per-series watch/rewatch counts, following flag
     tv_show_rate / ratings      -> rating
     tv_show_user_emotion_count  -> emotion count
     show_addiction_score.csv    -> engagement score
     seen_episode_source.csv     -> seen-episode count
   Watched-episode counts are also cross-checked against the history timeline. */
export function buildShows(ratings, reactions, emotionPerShow, history) {
  const shows = {};
  const get = (title) => {
    const k = norm(title);
    return (shows[k] ||= { title, id: null, status: null, followedAt: null, epWatched: 0, rewatches: 0, rating: null, emotionCount: 0, addiction: 0, seenCount: 0, lastWatched: null, sources: new Set() });
  };

  // followed_tv_show.csv
  for (const r of T('followed_tv_show.csv')) {
    if (!r.tv_show_name) continue;
    const s = get(r.tv_show_name);
    s.id ||= r.tv_show_id;
    s.followedAt = parseDate(r.created_at);
    s.diffusion = r.diffusion;
    const archived = r.archived === '1' || r.archived === 'true';
    const active = r.active === '1' || r.active === 'true';
    s.status = archived ? 'archived' : (active ? 'following' : 'stopped');
    s.sources.add('followed_tv_show');
  }

  // tracking-prod-records-v2 user-series aggregates
  for (const r of T('tracking-prod-records-v2.csv')) {
    if (!(r.key || '').startsWith('user-series')) continue;
    if (!r.series_name) continue;
    const s = get(r.series_name);
    s.id ||= r.s_id;
    s.epWatched = Math.max(s.epWatched, toNum(r.ep_watch_count));
    s.rewatches += toNum(r.rewatch_count);
    if (r.is_followed === 'true' && !s.status) s.status = 'following';
    if (r.is_archived === 'true') s.status = 'archived';
    if (r.is_for_later === 'true') s.forLater = true;
    if (nonEmpty(r.followed_at) && !s.followedAt) s.followedAt = parseDate(r.followed_at);
    s.sources.add('tracking-v2');
  }

  // show-level star rating (tv_show_rate)
  for (const [k, r] of Object.entries(ratings.showByTitle)) if (shows[k]) shows[k].rating = r.stars;

  // per-show reaction totals (prefer TV Time's own tally, else count from reactions list)
  for (const [k, count] of Object.entries(emotionPerShow)) if (shows[k]) shows[k].emotionCount = count;
  for (const [k, count] of Object.entries(reactions.countByTitle)) if (shows[k]) shows[k].emotionCount = Math.max(shows[k].emotionCount, count);

  // addiction score
  for (const r of T('show_addiction_score.csv')) {
    if (!r.tv_show_name) continue;
    const s = shows[norm(r.tv_show_name)];
    if (s) s.addiction = Math.max(s.addiction, toNum(r.monthly_score), toNum(r.weekly_score));
  }

  // seen-episode counts
  for (const r of T('seen_episode_source.csv')) {
    if (!r.tv_show_name) continue;
    const s = shows[norm(r.tv_show_name)];
    if (s) s.seenCount++;
  }

  // last-watched from timeline + a watched-count fallback
  const watchedByShow = {};
  for (const ev of history) {
    if (ev.type !== 'episode') continue;
    const k = norm(ev.title);
    watchedByShow[k] = (watchedByShow[k] || 0) + 1;
    const s = shows[k];
    if (s && ev.ts && (!s.lastWatched || ev.ts > s.lastWatched.getTime())) s.lastWatched = ev.date;
  }
  for (const [k, s] of Object.entries(shows)) {
    if (!s.epWatched && watchedByShow[k]) s.epWatched = watchedByShow[k];
    s.sources = [...s.sources];
  }

  return Object.values(shows).sort((a, b) => (b.epWatched - a.epWatched) || a.title.localeCompare(b.title));
}

/* ---------------- Movies ----------------
   Source of truth: tracking-prod-records.csv (entity_type == movie).
   A movie's rows are grouped by uuid: follow row + watch row(s) + rewatch_count row.
   Reaction votes merged by normalized title (movies have no numeric star rating). */
export function buildMovies(reactions, ratings, history) {
  const movies = {};
  const get = (title, uuid) => {
    const k = norm(title);
    return (movies[k] ||= { title, uuid, watched: false, watchCount: 0, rewatches: 0, runtime: 0, followedAt: null, watchedAt: null, watchDates: [], status: null, reacted: false, rating: null, reactions: [], sources: new Set() });
  };

  for (const r of T('tracking-prod-records.csv')) {
    if (r.entity_type !== 'movie') continue;
    const title = r.movie_name;
    if (!title) continue;
    const mv = get(title, r.uuid);
    mv.sources.add('tracking');
    if (nonEmpty(r.runtime)) mv.runtime = Math.max(mv.runtime, toNum(r.runtime));
    if (r.type === 'follow')  { mv.followedAt = parseDate(r.created_at); mv.status ||= 'watchlist'; }
    if (r.type === 'towatch') { mv.status = 'watchlist'; }
    if (r.type === 'watch')   { mv.watched = true; mv.status = 'watched'; mv.watchCount++; const d = parseDate(r.watch_date) || parseDate(r.created_at); if (d) { mv.watchDates.push(d); if (!mv.watchedAt || d > mv.watchedAt) mv.watchedAt = d; } }
    if (r.type === 'rewatch') { mv.watched = true; mv.rewatches++; const d = parseDate(r.watch_date) || parseDate(r.created_at); if (d) mv.watchDates.push(d); }
    if (r.type === 'rewatch_count') { mv.rewatches = Math.max(mv.rewatches, toNum(r.rewatch_count)); }
    if (nonEmpty(r.watch_count)) mv.watchCount = Math.max(mv.watchCount, toNum(r.watch_count));
  }

  // Surface movies that only appear as a reaction or rating, and flag/annotate the rest.
  for (const r of reactions.list.filter(r => r.kind === 'movie')) { get(r.title).reacted = true; get(r.title).sources.add('reactions'); }
  for (const [k, rt] of Object.entries(ratings.movieByTitle)) {
    if (!movies[k]) get(rt.title);
    movies[k].rating = rt; movies[k].sources.add('ratings');
  }
  // Decoded feeling labels per movie.
  for (const [k, set] of Object.entries(reactions.movieByTitle)) if (movies[k]) movies[k].reactions = [...set];
  for (const mv of Object.values(movies)) {
    if (mv.rating && !mv.status) mv.status = 'reacted';
    if (mv.reacted && !mv.status) mv.status = 'reacted';
  }

  for (const mv of Object.values(movies)) { mv.sources = [...mv.sources]; mv.watchDates.sort((a, b) => (a ? a.getTime() : 0) - (b ? b.getTime() : 0)); }
  return Object.values(movies).sort((a, b) => {
    const at = a.watchedAt ? a.watchedAt.getTime() : 0, bt = b.watchedAt ? b.watchedAt.getTime() : 0;
    return bt - at || a.title.localeCompare(b.title);
  });
}

/* ---------------- Lists ----------------
   lists-prod-lists.csv is a joinable structure, not one blob:
     - a `collection` row      -> list names + cover artwork (posters/fanart), keyed by s_key
     - per-list rows (by s_key) -> membership in `objects` (each item: id/uuid + type)
   We resolve every item id/uuid to a real title using id/uuid->name maps built
   from the rest of the export, then join collection metadata to its items. */
export function buildLists() {
  const listRows = T('lists-prod-lists.csv');
  if (!listRows.length) return [];

  // id/uuid -> title, gathered across the export
  const id2name = {}, uuid2name = {};
  const addId = (i, n) => { if (i && n && !id2name[i]) id2name[i] = n; };
  const addUuid = (u, n) => { if (u && n && !uuid2name[u]) uuid2name[u] = n; };
  for (const r of T('followed_tv_show.csv')) addId(r.tv_show_id, r.tv_show_name);
  for (const r of T('show_seen_episode_latest.csv')) addId(r.tv_show_id, r.tv_show_name);
  for (const r of T('tv_show_rate.csv')) addId(r.tv_show_id, r.tv_show_name);
  for (const r of T('tracking-prod-records.csv')) {
    if (r.series_id) addId(r.series_id, r.series_name);
    if (r.series_uuid) addUuid(r.series_uuid, r.series_name);
    if (r.entity_type === 'movie' && r.uuid) addUuid(r.uuid, r.movie_name);
  }
  for (const r of T('tracking-prod-records-v2.csv')) {
    if (r.s_id) addId(r.s_id, r.series_name);
    if (r.uuid && r.series_name) addUuid(r.uuid, r.series_name);
  }

  // parse a flat objects list: "[map[id:.. type:.. uuid:.. created_at:..] ...]"
  const parseObjects = (s) => {
    const items = [];
    for (const b of (s.match(/map\[(.*?)\]/g) || [])) {
      const inner = b.slice(4, -1);
      const g = (k) => { const m = inner.match(new RegExp('(?:^| )' + k + ':(\\S+)')); return m ? m[1] : null; };
      const id = g('id'), uuid = g('uuid'), type = g('type');
      items.push({ id, uuid, type, title: (id && id2name[id]) || (uuid && uuid2name[uuid]) || null });
    }
    return items;
  };
  const itemsBySkey = {};
  for (const r of listRows) if (r.type === 'list' && r.objects) itemsBySkey[r.s_key] = parseObjects(r.objects);

  // split the collection blob into top-level map[...] blocks (they contain nested [ ] arrays)
  const topMaps = (s) => {
    const out = []; let i = 0;
    while (i < s.length) {
      const start = s.indexOf('map[', i);
      if (start < 0) break;
      let depth = 0, j = start + 3;
      for (; j < s.length; j++) { if (s[j] === '[') depth++; else if (s[j] === ']') { if (--depth === 0) { j++; break; } } }
      out.push(s.slice(start + 4, j - 1)); i = j;
    }
    return out;
  };
  const KEYS = 'order|posters|s_key|type|updated_at|user_id|description|fanart|is_public|created_at|name';
  const meta = {};
  const coll = listRows.find(r => r.s_key === 'collection');
  if (coll && coll.lists) {
    for (const b of topMaps(coll.lists)) {
      const skey = (b.match(/s_key:(\S+)/) || [])[1];
      if (!skey) continue;
      const nameM = b.match(new RegExp('name:(.*?)(?=\\s+(?:' + KEYS + '):)')) || b.match(/name:(\S+)/);
      const posters = ((b.match(/posters:\[([^\]]*)\]/) || [])[1] || '').split(/\s+/).filter(x => /^https?:/.test(x));
      meta[skey] = { name: nameM ? nameM[1] : null, isPublic: /is_public:true/.test(b), cover: posters[0] || null };
    }
  }

  const out = [], seen = new Set();
  const push = (skey, m) => {
    const items = itemsBySkey[skey] || [];
    const kinds = new Set(items.map(i => i.type));
    const fallback = skey === 'favorite-series' ? 'Favorite Shows' : skey === 'favorite-movies' ? 'Favorite Movies' : 'List';
    out.push({
      name: (m && m.name && m.name !== '<nil>') ? m.name : fallback,
      isPublic: m ? m.isPublic : false,
      cover: m ? m.cover : null,
      kind: kinds.size === 1 ? [...kinds][0] : 'mixed',
      items,
    });
    seen.add(skey);
  };
  for (const skey of Object.keys(meta)) if (itemsBySkey[skey]) push(skey, meta[skey]);
  for (const skey of Object.keys(itemsBySkey)) if (!seen.has(skey)) push(skey, null);
  return out;
}

/* ---------------- Comments ----------------
   Your own comments, gathered from every comment table in the export:
     episode_comment.csv        — comments on episodes (the bulk)
     show_comment.csv           — comments on a show as a whole
     profile_comment.csv        — comments you left on a friend's profile
     comments-prod-comments.csv — newer movie/series comments (type comment/reply)
   Attached images come from meme.csv, joined on episode_comment_id.
   Replies keep their parent's text only when the parent is also one of your
   comments (other users' comments aren't in the export). */
export function buildComments(shows) {
  const showSlugs = new Set(shows.map(s => slugify(s.title)));
  const slugForShow = (name) => { const s = slugify(name || ''); return s && showSlugs.has(s) ? s : null; };

  // Images grouped by the episode comment they hang off.
  const memesByComment = {};
  for (const mm of T('meme.csv')) {
    const cid = (mm.episode_comment_id || '').trim(); if (!cid) continue;
    const url = (mm.medium_url || '').trim(); if (!url) continue;
    (memesByComment[cid] || (memesByComment[cid] = [])).push({
      id: (mm.id || '').trim(),
      url,                                        // "marked" — the version as posted
      clean: (mm.clean_version_medium_url || '').trim(),
      kind: mm.type || 'meme',
      w: toNum(mm.width) || null, h: toNum(mm.height) || null,
    });
  }

  const list = [];
  const byId = {};   // legacy comment id -> entry (for reply parent lookup)

  // TV Time stores absent fields as the literal string "null" (e.g. extended_comment
  // is always "null" here), so treat those as empty.
  const clean = (v) => { const s = (v || '').trim(); return (s === 'null' || s === 'undefined') ? '' : s; };
  const textOf = (r) => clean(r.comment) || clean(r.extended_comment) || clean(r.text) || clean(r.message);
  const add = (e) => { list.push(e); if (e.id) byId[e.id] = e; return e; };

  // episode_comment.csv
  for (const r of T('episode_comment.csv')) {
    const text = textOf(r); const images = memesByComment[(r.id || '').trim()] || [];
    if (!text && !images.length) continue;
    add({
      id: (r.id || '').trim(), kind: 'episode', target: clean(r.tv_show_name),
      slug: slugForShow(r.tv_show_name),
      season: toNum(r.episode_season_number) || null, episode: toNum(r.episode_number) || null,
      text, images, likes: toNum(r.nb_likes),
      parentId: (r.parent_comment_id || '').trim().replace(/^0$/, ''),
      date: parseDate(r.created_at),
    });
  }
  // show_comment.csv
  for (const r of T('show_comment.csv')) {
    const text = textOf(r); if (!text) continue;
    add({
      id: (r.id || '').trim(), kind: 'show', target: clean(r.tv_show_name),
      slug: slugForShow(r.tv_show_name), text, images: [], likes: toNum(r.nb_likes),
      parentId: (r.parent_comment_id || '').trim().replace(/^0$/, ''), date: parseDate(r.created_at),
    });
  }
  // profile_comment.csv — target is a friend's profile (id only; names aren't in the export)
  for (const r of T('profile_comment.csv')) {
    const text = textOf(r); if (!text) continue;
    add({
      id: (r.id || '').trim(), kind: 'profile', target: r.profile_id ? `Profile #${r.profile_id}` : 'A profile',
      slug: null, text, images: [], likes: toNum(r.nb_likes),
      parentId: (r.parent_comment_id || '').trim().replace(/^0$/, ''), date: parseDate(r.created_at),
    });
  }
  // comments-prod-comments.csv — newer movie/series comments (skip likes/reports/blank rows)
  const byUuid = {};
  for (const r of T('comments-prod-comments.csv')) {
    if (r.type !== 'comment' && r.type !== 'reply') continue;
    const text = textOf(r); if (!text) continue;
    const isMovie = r.entity_type === 'movie';
    const name = clean(isMovie ? r.movie_name : r.series_name);
    const e = add({
      id: '', uuid: (r.comment_uuid || r.uuid || '').trim(), kind: isMovie ? 'movie' : 'series',
      target: name, slug: isMovie ? null : slugForShow(name), text, images: [],
      likes: toNum(r.like_count), parentUuid: (r.parent_uuid || '').trim(),
      date: parseDate(r.created_at),
    });
    if (e.uuid) byUuid[e.uuid] = e;
  }

  // Resolve reply parents where recoverable, and tag every reply.
  for (const e of list) {
    e.isReply = !!(e.parentId || e.parentUuid);
    if (e.parentId && byId[e.parentId]) e.parent = byId[e.parentId];
    else if (e.parentUuid && byUuid[e.parentUuid]) e.parent = byUuid[e.parentUuid];
    else e.parent = null;
  }

  list.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  const withImages = list.filter(e => e.images.length).length;
  const imageCount = list.reduce((n, e) => n + e.images.length, 0);
  return { list, withImages, imageCount };
}

/* ---------------- Notifications ----------------
   notifications-prod-notifications.csv — your read-only activity feed: who liked /
   replied to / mentioned / requested to follow you, badges you unlocked, and airing
   reminders. The `text` is already display-ready; sender avatars / badge art / posters
   come from the `image` field (backed up per notifImageRef). */
export const NOTIF_CAT = {
  'episode-comment-liked': 'like', 'episode-reply-liked': 'like', 'movie-comment-liked': 'like',
  'show-comment-liked': 'like', 'show-reply-liked': 'like',
  'replied-to-comment': 'reply', 'episode-commented': 'reply',
  'mentioned-in-comment': 'mention',
  'follow-requested': 'follow',
  'badge-unlocked': 'badge',
  'episode-will-air': 'airing',
};

export const NOTIF_CAT_LABEL = { like: 'Like', reply: 'Reply', mention: 'Mention', follow: 'Follow', badge: 'Badge', airing: 'Airing', other: 'Other' };

export function buildNotifications() {
  const list = [];
  for (const r of T('notifications-prod-notifications.csv')) {
    const type = (r.type || '').trim();
    const cat = NOTIF_CAT[type] || 'other';
    const isBadge = type === 'badge-unlocked';
    const badgeName = (r.badge_name || '').trim();
    const text = isBadge ? (badgeName ? `Unlocked “${badgeName}”` : 'Unlocked a badge') : (r.text || '').trim();
    const imgRef = notifImageRef(r);
    if (!text && !imgRef) continue;
    // `time` is a ms epoch on every row; `date` (ISO) only on some.
    const date = (r.time || '').trim() ? new Date(+r.time) : parseDate(r.date);
    const senderId = imgRef && imgRef.kind === 'avatar' ? imgRef.key.slice('avatars/'.length) : null;
    list.push({ type, cat, text, date, img: imgRef, senderId, isBadge });
  }
  list.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  const byCat = {};
  for (const n of list) byCat[n.cat] = (byCat[n.cat] || 0) + 1;
  return { list, byCat };
}

/* ---------------- Badges ----------------
   user_badge.csv — 528 earned badges, but most are the same badge unlocked per show
   (e.g. "quick-watcher-3" for many series). We group by badge *type* (the slug minus
   the leading show id) with a count + date range. Art/name for the ~119 that appeared
   in a badge-unlocked notification; a humanized slug for the rest. */
export function buildBadges() {
  const rows = T('user_badge.csv');
  // Badge art keyed by full badge_id, from badge-unlocked notifications.
  const art = {};
  for (const r of T('notifications-prod-notifications.csv')) {
    if (r.type !== 'badge-unlocked') continue;
    const m = (r.url || '').match(/badge_id=([^&]+)/);
    if (m && (r.image || '').trim()) art[m[1]] = { image: r.image.trim(), key: 'badges/' + m[1] };
  }
  // TV Time's internal show id (the badge_id prefix) -> show name.
  const showName = {};
  for (const file of ['followed_tv_show.csv', 'tv_show_rate.csv', 'show_comment.csv']) {
    for (const r of T(file)) {
      const id = (r.tv_show_id || '').trim(), nm = (r.tv_show_name || '').trim();
      if (id && nm && !showName[id]) showName[id] = nm;
    }
  }
  const typeKey = (bid) => bid.replace(/^\d+-/, '');                 // drop the show-id prefix
  const humanize = (tk) => tk.replace(/-bd$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const groups = {};
  for (const r of rows) {
    const bid = (r.badge_id || '').trim(); if (!bid) continue;
    const tk = typeKey(bid);
    const g = groups[tk] || (groups[tk] = { key: tk, name: humanize(tk), count: 0, first: null, last: null, art: null, shows: [], _seen: new Set() });
    g.count++;
    const d = parseDate(r.created_at);
    if (d) { if (!g.first || d < g.first) g.first = d; if (!g.last || d > g.last) g.last = d; }
    if (!g.art && art[bid]) g.art = art[bid];
    const pm = bid.match(/^(\d+)-/);   // per-show badge -> record the show
    if (pm && !g._seen.has(pm[1])) { g._seen.add(pm[1]); g.shows.push({ id: pm[1], name: showName[pm[1]] || null, date: d }); }
  }
  const list = Object.values(groups).map(g => {
    delete g._seen;
    g.shows.sort((a, b) => (a.name || 'zzz').localeCompare(b.name || 'zzz'));
    return g;
  }).sort((a, b) => b.count - a.count || (b.last?.getTime() || 0) - (a.last?.getTime() || 0));
  return { list, total: rows.length };
}

/* ---------------- Characters ----------------
   show_character_episode_vote.csv — the characters you voted for, per episode. Names /
   actors / posters come from the extended backup (Extended.characters), else id only. */
export function buildCharacters() {
  const byId = {};
  for (const r of T('show_character_episode_vote.csv')) {
    const id = (r.show_character_id || '').trim(); if (!id) continue;
    const c = byId[id] || (byId[id] = { id, votes: [] });
    c.votes.push({ show: r.tv_show_name || '', season: r.episode_season_number || '', episode: r.episode_number || '', date: parseDate(r.created_at) });
  }
  const list = Object.values(byId).map(c => {
    const m = Extended.characters[c.id] || {};
    c.votes.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
    const shows = [...new Set(c.votes.map(v => v.show).filter(Boolean))];
    return { id: c.id, name: m.name || null, actor: m.actor_name || null, poster: m.poster || null,
      votes: c.votes, shows, lastDate: c.votes[0]?.date || null };
  });
  list.sort((a, b) => (b.lastDate?.getTime() || 0) - (a.lastDate?.getTime() || 0));
  return list;
}

/* ---------------- Friends ----------------
   friend.csv — your friends (ids + affinity + since). Real names / avatars come from
   the extended backup (Extended.friends), else id only. */
export function buildFriends() {
  const list = [];
  for (const r of T('friend.csv')) {
    const id = (r.friend_id || '').trim(); if (!id) continue;
    const m = Extended.friends[id] || {};
    list.push({ id, name: m.name || null, username: m.username || null, avatar: m.avatar || null,
      since: parseDate(r.created_at), affinity: toNum(r.affinity) });
  }
  list.sort((a, b) => (a.name || 'zzz~').localeCompare(b.name || 'zzz~'));
  return list;
}

// After importing an extended backup: reload the resolved names and rebuild the two
// affected models so the new names/images show without a full reload.
export function refreshExtended() {
  Extended.load();
  if (STATE.model) { STATE.model.characters = buildCharacters(); STATE.model.friends = buildFriends(); }
}

/* ---------------- Stats ----------------
   stats-prod-cache.csv holds Go-serialized `map[...]` blobs of precomputed stats:
   biggest marathons, and episode/movie counts + hours per month. */
export function goMaps(s) {   // split "map[..] map[..]" into inner strings, depth-aware
  const out = []; let i = 0;
  while (i < s.length) {
    const start = s.indexOf('map[', i); if (start < 0) break;
    let depth = 0, j = start + 3;
    for (; j < s.length; j++) { if (s[j] === '[') depth++; else if (s[j] === ']') { if (--depth === 0) { j++; break; } } }
    out.push(s.slice(start + 4, j - 1)); i = j;
  }
  return out;
}

export function goArray(blob, key) {   // content of "key:[ ... ]", depth-aware
  const idx = blob.indexOf(key + ':['); if (idx < 0) return null;
  let i = idx + key.length + 1, depth = 0; const start = i;
  for (; i < blob.length; i++) { if (blob[i] === '[') depth++; else if (blob[i] === ']') { if (--depth === 0) return blob.slice(start + 1, i); } }
  return null;
}

export function buildStats() {
  const cache = T('stats-prod-cache.csv');
  const blob = (type) => (cache.find(r => r.type === type) || {}).stats || '';
  const epW = blob('episode-watched'), mvW = blob('movie-watched');

  const marathons = [];
  const marr = goArray(epW, 'biggest-marathon');
  if (marr) for (const b of goMaps(marr)) {
    const x = (b.match(/x:(.*?)\s+y:/) || [])[1];
    const y = b.match(/y:\[(\d+)\s+(\d+)\]/);
    if (x && y) marathons.push({ show: x, episodes: +y[1], days: +y[2] });
  }
  const series = (source, key) => {
    const arr = goArray(source, key), out = [];
    if (arr) for (const b of goMaps(arr)) {
      const x = (b.match(/x:(.*?)\s+y:/) || [])[1];
      const y = (b.match(/y:(\d+)/) || [])[1];
      if (x) out.push({ label: x, value: +y || 0 });
    }
    return out;
  };
  const epByMonth = series(epW, 'count-by-month');
  return {
    hasData: !!(marathons.length || epByMonth.length),
    marathons,
    epByMonth,
    hoursByMonth: series(epW, 'duration-by-month'),
    moviesByMonth: series(mvW, 'count-by-month'),
  };
}

/* ---------------- Overview ----------------
   Headline numbers primarily from the tracking-stats row (authoritative totals),
   with everything else counted from the curated datasets above. */
export function buildOverview(m) {
  const statsRow = T('tracking-prod-records-v2.csv').find(r => r.key === 'tracking-stats') || {};
  const epFromStats = toNum(statsRow.ep_watch_count);
  const movieFromStats = toNum(statsRow.movie_watch_count);

  const episodeWatches = m.history.filter(e => e.type === 'episode').length;
  const movieWatches   = m.history.filter(e => e.type === 'movie').length;

  return {
    episodesWatched: epFromStats || episodeWatches,
    moviesWatched:   movieFromStats || movieWatches,
    seriesRuntime:   toNum(statsRow.total_series_runtime),
    moviesRuntime:   toNum(statsRow.total_movies_runtime),
    showsFollowed:   toNum(statsRow.series_follow_count) || m.shows.filter(s => s.status === 'following').length,
    showsTracked:    m.shows.length,
    moviesTracked:   m.movies.length,
    ratingsLogged:   m.ratings.list.length,
    reactionsLogged: m.reactions.list.length,
    timelineEvents:  m.history.length,
    firstWatch:      m.history.length ? m.history[m.history.length - 1].date : null,
    lastWatch:       m.history.length ? m.history[0].date : null,
  };
}
