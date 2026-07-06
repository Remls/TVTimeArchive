import { LEVEL_LABEL, reactionChipText } from '../core/decode.js';
import { Enrichment } from '../core/enrich.js';
import { zoomImg } from '../core/media.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtDateTime, fmtInt, norm, slugify } from '../core/util.js';
import { emptyState, listView, posterCard, ratingChip, statusBadge } from '../ui/kit.js';
import { navigate } from '../ui/router.js';

export function renderShows(root) {
  const shows = STATE.model.shows;
  listView(root, {
    title: 'TV Shows', subtitle: `${fmtInt(shows.length)} shows`,
    items: shows, searchKeys: ['title'], gallery: true, stateKey: 'shows',
    enrichShows: (slice) => slice.map(s => ({ seriesId: s.id, title: s.title })),
    filter: { default: 'all', options: [
      { id: 'all', label: 'All statuses', test: () => true },
      { id: 'following', label: 'Following', test: s => s.status === 'following' },
      { id: 'archived', label: 'Archived', test: s => s.status === 'archived' },
      { id: 'stopped', label: 'Stopped', test: s => s.status === 'stopped' },
      { id: 'rated', label: 'Rated', test: s => !!s.rating },
    ] },
    sorts: [
      { id: 'recent', label: 'Recently watched', fn: (a, b) => (b.lastWatched?.getTime() || 0) - (a.lastWatched?.getTime() || 0) },
      { id: 'followed', label: 'Recently followed', fn: (a, b) => (b.followedAt?.getTime() || 0) - (a.followedAt?.getTime() || 0) },
      { id: 'rating', label: 'Highest rated', fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
      { id: 'watched', label: 'Most episodes watched', fn: (a, b) => b.epWatched - a.epWatched },
      { id: 'az', label: 'A → Z', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (s) => posterCard({
      kind: 'show', title: s.title, seriesId: s.id,
      status: s.status, rating: s.rating,
      sub: `${fmtInt(s.epWatched)} episodes`,
      onClick: () => navigate({ view: 'shows', detail: slugify(s.title) }),
    }),
    exportName: 'tvtime-shows',
    exportRow: (s) => ({ title: s.title, status: s.status || '', episodes_watched: s.epWatched, rewatches: s.rewatches, rating: s.rating ?? '', emotion_count: s.emotionCount, seen_episodes: s.seenCount, followed_at: s.followedAt ? s.followedAt.toISOString() : '', last_watched: s.lastWatched ? s.lastWatched.toISOString() : '', sources: (s.sources || []).join('|') }),
  });
}

export const pad2 = (n) => { const s = String(n); return /^\d$/.test(s) ? '0' + s : s; };

export function openShowDetail(show) {
  // Remember where the Shows list was scrolled so we can restore it on back.
  STATE.pendingScroll = { key: 'shows', y: window.scrollY || window.pageYOffset || 0 };
  const root = $('#viewRoot');
  root.innerHTML = '';
  window.scrollTo(0, 0);

  root.append(el('div', { class: 'backbar' }, [
    el('button', { class: 'back-btn', text: '‹ Back', onclick: () => history.back() }),
  ]));
  const poster = el('div', { class: 'detail-poster' });
  const setPoster = (url, full) => { poster.innerHTML = ''; if (url) poster.append(zoomImg('detail-poster-fill', url, show.title, full)); };
  root.append(el('div', { class: 'detail-hero' }, [
    poster,
    el('div', { class: 'detail-hero-text' }, [
      el('h2', { text: show.title }),
      el('div', { class: 'detail-sub' }, [
        el('span', { html: `<b>${fmtInt(show.epWatched || 0)}</b> episodes watched` }),
        show.rewatches ? el('span', { html: `<b>${fmtInt(show.rewatches)}</b> rewatches` }) : null,
        show.emotionCount ? el('span', { html: `<i class="ph ph-heart"></i> ${fmtInt(show.emotionCount)}` }) : null,
        show.rating ? ratingChip({ stars: show.rating, label: LEVEL_LABEL[show.rating] || '' }) : null,
        statusBadge(show.status),
      ]),
    ]),
  ]));

  // Per-episode watch dates (each watch + rewatch event) from history.
  const datesByEp = {};
  for (const ev of STATE.model.history) {
    if (ev.type !== 'episode' || norm(ev.title) !== norm(show.title)) continue;
    (datesByEp[`${ev.season}|${ev.episode}`] ||= []).push(ev.date);
  }
  for (const k in datesByEp) datesByEp[k].sort((a, b) => (a ? a.getTime() : 0) - (b ? b.getTime() : 0));

  // Your feelings + star rating on each episode of this show.
  const showKey = norm(show.title);
  const reactsByEp = {};
  for (const r of STATE.model.reactions.list) {
    if (r.kind !== 'episode' || norm(r.title) !== showKey || r.reactionId == null) continue;
    const label = reactionChipText(r.reactionId, r.source);
    (reactsByEp[`${r.season}|${r.episode}`] ||= new Set()).add(label);
  }
  const ratingByEp = {};
  for (const r of STATE.model.ratings.list) {
    if (r.kind === 'episode' && norm(r.title) === showKey) ratingByEp[`${r.season}|${r.episode}`] = r;
  }

  const body = el('div');
  root.append(body);
  const key = Enrichment.keyFor(show.id, show.title);

  const load = () => {
    body.innerHTML = '';
    body.append(el('div', { class: 'enrich-note' }, [ el('div', { class: 'spinner' }), 'Loading from TVmaze…' ]));
    Enrichment.ensure([{ seriesId: show.id, title: show.title }], true).then(() => {
      const v = Enrichment.getCached(key);
      render(v && v.e && Object.keys(v.e).length ? v.e : null, v && v.f);
    });
  };
  const refetch = () => { Enrichment.forget(key); load(); };

  const render = (epMap, failed) => {
    body.innerHTML = '';
    const v = Enrichment.getCached(key);
    setPoster(v && v.img, v && (v.imgO || v.img));
    const note = el('div', { class: 'enrich-note' });
    if (epMap) {
      note.append(el('span', { text: 'Episodes from TVmaze.' }));
      note.append(el('button', { class: 'btn secondary', text: '↻ Refetch', onclick: refetch }));
    } else {
      note.append(el('span', { text: failed ? 'Not found on TVmaze.' : 'Showing your watched episodes.' }));
      note.append(el('button', { class: 'btn secondary', text: failed ? '↻ Retry' : 'Load episodes', onclick: refetch }));
    }
    body.append(note);
    renderSeasons(body, datesByEp, epMap, v && v.i, reactsByEp, v && v.iO, ratingByEp);
  };

  const cached = Enrichment.getCached(key);
  if (cached && cached.full && cached.e && Object.keys(cached.e).length) render(cached.e, false);
  else if (cached && cached.f) render(null, true);
  else if (Enrichment.enabled) load();
  else render(null, false);
}

export function renderSeasons(container, datesByEp, epMap, imgMap, reactsByEp, imgFullMap, ratingByEp) {
  const full = !!epMap;
  const seasons = {}; // sNum -> { eNum -> title|null }
  const source = full ? Object.keys(epMap) : Object.keys(datesByEp);
  for (const k of source) { const [s, e] = k.split('|'); (seasons[s] ||= {})[e] = full ? epMap[k] : null; }

  const sNums = Object.keys(seasons).sort((a, b) => Number(a) - Number(b));
  if (!sNums.length) { container.append(emptyState('No episode data for this show', { icon: 'ph-television' })); return; }

  // absolute-episode offsets across regular seasons (season > 0)
  const absOffset = {}; let running = 0;
  for (const s of sNums) if (Number(s) > 0) { absOffset[s] = running; running += Object.keys(seasons[s]).length; }

  for (const s of sNums) {
    const eNums = Object.keys(seasons[s]).sort((a, b) => Number(a) - Number(b));
    const watched = eNums.filter(e => (datesByEp[`${s}|${e}`] || []).length).length;
    const total = eNums.length;
    const complete = total > 0 && watched === total;
    const det = el('details', { class: 'season' });   // collapsed by default
    det.append(el('summary', {}, [
      el('span', { class: 'season-title', text: Number(s) === 0 ? 'Specials' : `Season ${s}` }),
      el('span', { class: 'season-prog' + (complete ? ' complete' : ''), text: `${watched}/${total}` }),
    ]));
    for (const e of eNums) {
      const dates = datesByEp[`${s}|${e}`] || [];
      const c = dates.length;
      const abs = full && Number(s) > 0 ? absOffset[s] + Number(e) : null;
      const numTxt = `S${pad2(s)}E${pad2(e)}` + (abs ? ` (E${pad2(abs)})` : '');
      const thumb = imgMap && imgMap[`${s}|${e}`];
      const thumbFull = imgFullMap && imgFullMap[`${s}|${e}`];
      det.append(el('div', { class: 'ep-row' }, [
        zoomImg('ep-thumb', thumb, seasons[s][e] || `Episode ${e}`, thumbFull),
        el('div', { class: 'ep-body' }, [
          el('div', { class: 'ep-num', text: numTxt }),
          el('div', { class: 'ep-title' + (c ? '' : ' unseen'), text: seasons[s][e] || `Episode ${e}` }),
          c ? el('div', { class: 'ep-dates' }, dates.map((d, i) => el('span', { text: (i === 0 ? '▶ ' : '↻ ') + fmtDateTime(d) }))) : null,
          (ratingByEp && ratingByEp[`${s}|${e}`]) ? el('div', { class: 'ep-rating', text: `${ratingByEp[`${s}|${e}`].label} ${ratingByEp[`${s}|${e}`].stars}★` }) : null,
          (reactsByEp && reactsByEp[`${s}|${e}`]) ? el('div', { class: 'ep-reactions', text: [...reactsByEp[`${s}|${e}`]].join(', ') }) : null,
        ]),
        c ? el('span', { class: 'count-badge' + (c === 1 ? ' once' : ''), text: `×${c}` }) : el('span', { class: 'unwatched-dot' }),
      ]));
    }
    container.append(det);
  }
}
