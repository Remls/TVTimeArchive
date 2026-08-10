import { Enrichment } from '../../../app/core/enrich.js';
import { zoomImg } from '../../../app/core/media.js';
import { STATE } from '../../../app/core/state.js';
import { $, el, fmtDate, fmtInt } from '../../../app/core/util.js';
import { detailScaffold, emptyState, listView, posterCard, statusBadge } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { countryNames, enrichItem, kindIcon, metaYear, moodChips, rating10, reviewText, tagChips } from '../kit.js';

const pad2 = (n) => String(n).padStart(2, '0');

const STATUS_FILTERS = [
  { id: 'all', label: 'All statuses', test: () => true },
  { id: 'in_progress', label: 'Watching', test: s => s.status === 'in_progress' },
  { id: 'up_to_date', label: 'Up to date', test: s => s.status === 'up_to_date' },
  { id: 'completed', label: 'Completed', test: s => s.status === 'completed' },
  { id: 'on_hold', label: 'On hold', test: s => s.status === 'on_hold' },
  { id: 'dropped', label: 'Dropped', test: s => s.status === 'dropped' },
  { id: 'planned', label: 'Planned', test: s => s.status === 'planned' },
];

/* One gallery serves both the Shows and Anime views; they differ only in the
   slice of the model and the view id their cards navigate under. */
export function showsGallery(root, { viewId, title, items, exportName }) {
  listView(root, {
    title, subtitle: `${fmtInt(items.length)} ${viewId === 'anime' ? 'anime' : 'shows'}`,
    items, gallery: true, stateKey: viewId,
    searchText: (s) => `${s.title} ${s.originalTitle}`,
    enrichShows: (slice) => slice.map(enrichItem),
    filter: { default: 'all', options: STATUS_FILTERS },
    sorts: [
      { id: 'recent', label: 'Recently watched', fn: (a, b) => (b.lastWatched?.getTime() || 0) - (a.lastWatched?.getTime() || 0) },
      { id: 'rating', label: 'Highest rated', fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
      { id: 'watched', label: 'Most episodes watched', fn: (a, b) => b.epWatched - a.epWatched },
      { id: 'year', label: 'Newest', fn: (a, b) => (b.year || 0) - (a.year || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (s) => posterCard({
      kind: 'show', kindIcon: kindIcon(s), title: s.title, year: metaYear(s),
      secondary: s.originalTitle && s.originalTitle !== s.title ? s.originalTitle : null,
      status: s.status, rating: s.rating,
      sub: [s.year, s.epWatched ? `${fmtInt(s.epWatched)} episodes watched` : null].filter(Boolean).join(', ') || null,
      onClick: () => navigate({ view: viewId, detail: s.slug }),
    }),
    exportName,
    exportRow: (s) => ({
      title: s.title, original_title: s.originalTitle, year: s.year ?? '', type: s.type,
      countries: s.countries.join('|'), status: s.status, rating: s.rating ?? '',
      episodes_watched: s.epWatched, watch_events: s.watches,
      first_watched: s.firstWatched ? s.firstWatched.toISOString() : '',
      last_watched: s.lastWatched ? s.lastWatched.toISOString() : '',
      sources: s.sources.join('|'),
    }),
  });
}

export function renderShows(root) {
  showsGallery(root, { viewId: 'shows', title: 'TV Shows', items: STATE.model.shows.filter(s => !s.isAnime), exportName: 'refract-shows' });
}

export function renderAnime(root) {
  showsGallery(root, { viewId: 'anime', title: 'Anime', items: STATE.model.shows.filter(s => s.isAnime), exportName: 'refract-anime' });
}

export function openShowDetail(show) {
  const backKey = STATE.view === 'anime' ? 'anime' : 'shows';
  STATE.pendingScroll = { key: backKey, y: window.scrollY || window.pageYOffset || 0 };
  const root = $('#viewRoot');
  const { body, setPoster } = detailScaffold(root, {
    title: show.title, kind: 'show', kindIcon: kindIcon(show),
    subKids: [
      el('span', { html: `<b>${fmtInt(show.epWatched || 0)}</b> episodes watched` }),
      show.year ? el('span', { text: String(show.year) }) : null,
      show.countries.length ? el('span', { text: countryNames(show.countries) }) : null,
      rating10(show.rating),
      statusBadge(show.status),
    ],
  });

  if (show.originalTitle && show.originalTitle !== show.title) {
    body.append(el('div', { class: 'detail-orig', text: show.originalTitle }));
  }
  if (show.ambiguous) {
    body.append(el('div', { class: 'enrich-note' }, [
      el('i', { class: 'ph ph-warning-circle' }),
      el('span', { text: `This title exists more than once in your library and episode watches carry no year, so they are attributed by watch date and may be imperfect.` }),
    ]));
  }

  const key = Enrichment.keyFor('', show.title, metaYear(show));
  const load = () => {
    body.querySelector('.seasons-host').innerHTML = '';
    body.querySelector('.seasons-host').append(el('div', { class: 'enrich-note' }, [el('div', { class: 'spinner' }), 'Loading from TVmaze…']));
    Enrichment.ensure([enrichItem(show)], true).then(() => {
      const v = Enrichment.getCached(key);
      render(v && v.e && Object.keys(v.e).length ? v.e : null, v && v.f);
    });
  };
  const refetch = () => { Enrichment.forget(key); load(); };

  const host = el('div', { class: 'seasons-host' });
  body.append(host);

  const render = (epMap, failed) => {
    host.innerHTML = '';
    const v = Enrichment.getCached(key);
    setPoster(v && v.img, v && (v.imgO || v.img));
    const note = el('div', { class: 'enrich-note' });
    if (epMap) {
      note.append(el('span', { text: 'Episodes from TVmaze.' }));
      note.append(el('button', { class: 'btn secondary', html: '<i class="ph ph-arrow-clockwise"></i>Refetch', onclick: refetch }));
    } else {
      note.append(el('span', { text: failed ? 'Not found on TVmaze.' : 'Showing your watched episodes.' }));
      note.append(el('button', { class: 'btn secondary', html: failed ? '<i class="ph ph-arrow-clockwise"></i>Retry' : 'Load episodes', onclick: refetch }));
    }
    host.append(note);
    renderSeasons(host, show, epMap, v && v.i, v && v.iO);
    if (show.reviews.length) {
      host.append(el('div', { class: 'section-title', text: show.reviews.length === 1 ? '1 review' : `${fmtInt(show.reviews.length)} reviews` }));
      for (const r of show.reviews) host.append(reviewCard(r));
    }
  };

  const cached = Enrichment.getCached(key);
  if (cached && cached.full && cached.e && Object.keys(cached.e).length) render(cached.e, false);
  else if (cached && cached.f) render(null, true);
  else if (Enrichment.enabled) load();
  else render(null, false);
}

/* Refract's database (TMDB-backed) numbers some shows as one continuous run
   while TVmaze splits them into seasons. When every watched episode sits in
   season 1 but runs past the end of TVmaze's season 1, the watched numbers are
   treated as absolute episode indexes and remapped onto TVmaze's seasons. */
function remapContinuous(watched, epMap) {
  if (!epMap) return { watched, remapped: false };
  const ordered = Object.keys(epMap).map(k => k.split('|').map(Number))
    .filter(([s]) => s > 0)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const maxS1 = Math.max(0, ...ordered.filter(([s]) => s === 1).map(([, e]) => e));
  const seasonCount = new Set(ordered.map(([s]) => s)).size;
  const regular = [...watched.keys()].map(k => k.split('|').map(Number)).filter(([s]) => s > 0);
  if (seasonCount < 2 || !regular.length) return { watched, remapped: false };
  if (!regular.every(([s]) => s === 1) || Math.max(...regular.map(([, e]) => e)) <= maxS1) {
    return { watched, remapped: false };
  }
  const out = new Map();
  for (const [k, v] of watched) {
    const [s, e] = k.split('|').map(Number);
    if (s === 0) { out.set(k, v); continue; }   // specials pass through
    const target = ordered[e - 1];
    if (!target) return { watched, remapped: false };   // runs past TVmaze's list: numbering doesn't line up after all
    out.set(target.join('|'), { ...v, season: target[0], episode: target[1] });
  }
  return { watched: out, remapped: true };
}

/* Seasons accordion: canonical episode list from TVmaze when available, else
   just the episodes with watches. */
function renderSeasons(container, show, epMap, imgMap, imgFullMap) {
  const { watched, remapped } = remapContinuous(show.episodes, epMap);
  if (remapped) {
    container.append(el('div', { class: 'enrich-note' }, [
      el('i', { class: 'ph ph-info' }),
      el('span', { text: 'Refract numbers this title as one continuous season; your watches were mapped onto the season split below.' }),
    ]));
  }
  const seasons = {};              // sNum -> { eNum: name|null }
  for (const k of (epMap ? Object.keys(epMap) : watched.keys())) {
    const [s, e] = k.split('|');
    (seasons[s] ||= {})[e] = epMap ? epMap[k] : null;
  }
  // Watches TVmaze doesn't know (numbering still off, or extra specials): keep
  // them visible as extra rows in their nominal season instead of dropping them.
  const orphans = epMap ? [...watched.keys()].filter(k => !(k in epMap)) : [];
  for (const k of orphans) { const [s, e] = k.split('|'); (seasons[s] ||= {})[e] = null; }

  const sNums = Object.keys(seasons).sort((a, b) => Number(a) - Number(b));
  if (!sNums.length) { container.append(emptyState('No episode data for this show', { icon: kindIcon(show) || 'ph-television' })); return; }

  for (const s of sNums) {
    const eNums = Object.keys(seasons[s]).sort((a, b) => Number(a) - Number(b));
    const seen = eNums.filter(e => watched.has(`${s}|${e}`)).length;
    const det = el('details', { class: 'season' });
    det.append(el('summary', {}, [
      el('span', { class: 'season-head' }, [
        el('i', { class: 'ph ph-caret-right season-caret' }),
        el('span', { class: 'season-title', text: Number(s) === 0 ? 'Specials' : `Season ${s}` }),
      ]),
      el('span', { class: 'season-prog' + (seen === eNums.length ? ' complete' : ''), text: `${seen}/${eNums.length}` }),
    ]));
    for (const e of eNums) {
      const w = watched.get(`${s}|${e}`);
      const dates = w ? [...w.dates].sort((a, b) => a.getTime() - b.getTime()) : [];
      const thumb = imgMap && imgMap[`${s}|${e}`];
      det.append(el('div', { class: 'ep-row' }, [
        zoomImg('ep-thumb', thumb, seasons[s][e] || `Episode ${e}`, imgFullMap && imgFullMap[`${s}|${e}`]),
        el('div', { class: 'ep-body' }, [
          el('div', { class: 'ep-num', text: `S${pad2(s)}E${pad2(e)}` }),
          el('div', { class: 'ep-title' + (w ? '' : ' unseen'), text: seasons[s][e] || `Episode ${e}` }),
          dates.length ? el('div', { class: 'ep-dates' }, dates.map((d, i) => el('span', { html: `<i class="ph ${i === 0 ? 'ph-play' : 'ph-arrow-clockwise'}"></i>${fmtDate(d)}` }))) : null,
          w && w.rating ? el('div', { class: 'ep-rating' }, [rating10(w.rating)]) : null,
        ]),
        el('span', { class: 'count-badge ' + (!w ? 'none' : w.count === 1 ? 'watched' : 'rewatched'), text: `×${w ? w.count : 0}` }),
      ]));
    }
    container.append(det);
  }
}

export function reviewCard(r) {
  return el('div', { class: 'item review-item' }, [
    el('div', { class: 'item-main' }, [
      el('div', { class: 'item-meta' }, [
        r.kind === 'episode' && r.season != null ? el('span', { text: `S${pad2(r.season)}E${pad2(r.episode)}` }) : null,
        r.date ? el('span', { text: fmtDate(r.date) }) : null,
        ...(r.moodTags.length ? moodChips(r.moodTags) : []),
        ...(r.watchContext.length ? tagChips(r.watchContext, 'ph-users') : []),
      ]),
      reviewText(r.text, r.isSpoiler),
    ]),
    el('div', { class: 'item-right' }, [rating10(r.rating)].filter(Boolean)),
  ]);
}
