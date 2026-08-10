import { Enrichment, MovieMeta, movieTitle } from '../../../app/core/enrich.js';
import { zoomImg } from '../../../app/core/media.js';
import { STATE } from '../../../app/core/state.js';
import { download, el, fmtDate, fmtInt, norm, toCSV } from '../../../app/core/util.js';
import { buildToolbar, menuSelect, viewHead } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { enrichItem, kindIcon, metaYear, rating10 } from '../kit.js';

function historyItem(ev) {
  const info = ev.type === 'episode' ? Enrichment.epInfo(ev.title, '', ev.season, ev.episode, metaYear(ev.ref)) : null;
  const epName = info && info.name;
  const sub = ev.type === 'episode'
    ? `S${ev.season || '?'}E${ev.episode || '?'}${epName ? ' ' + epName : ''}${ev.rewatch ? ' (rewatch)' : ''}`
    : 'Movie';
  const kids = [];
  if (Enrichment.enabled) {
    kids.push(zoomImg('item-thumb', info && info.image, ev.title, info && info.imageFull));
  }
  kids.push(el('div', { class: 'item-main' }, [
    el('div', { class: 'item-title', text: ev.type === 'movie' && !ev.ref.titleWasExplicit ? movieTitle(ev.title) : ev.title }),
    el('div', { class: 'item-meta' }, [
      el('span', { text: sub }),
      el('span', { text: fmtDate(ev.date) }),
    ]),
  ]));
  kids.push(el('div', { class: 'item-right' }, [
    rating10(ev.rating),
    el('span', {
      class: 'badge ' + (ev.type === 'movie' ? 'warn' : (kindIcon(ev.ref) ? 'anime' : 'accent')),
      html: `<i class="ph ${ev.type === 'movie' ? 'ph-film-slate' : (kindIcon(ev.ref) || 'ph-television')}"></i>`,
    }),
  ].filter(Boolean)));
  const nav = ev.ref.slug
    ? { view: ev.type === 'movie' ? 'movies' : (ev.ref.isAnime ? 'anime' : 'shows'), detail: ev.ref.slug }
    : null;
  const item = el('div', { class: 'item' + (nav ? ' clickable' : '') }, kids);
  if (nav) { item.title = ev.type === 'movie' ? 'View movie details' : 'View episode progress'; item.addEventListener('click', () => navigate(nav)); }
  return item;
}

export function renderHistory(root) {
  const events = STATE.model.history;
  const saved = STATE.listState.history || {};
  const state = { q: saved.q || '', type: saved.type || 'all', sort: saved.sort || 'recent', page: saved.page || 0, pageSize: 60 };
  const persist = () => { STATE.listState.history = { q: state.q, type: state.type, sort: state.sort, page: state.page }; };

  viewHead(root, 'Watch history', `${fmtInt(events.length)} watch events`);
  const doExport = (fmt) => {
    const rows = computed().map(e => ({ date: e.date ? e.date.toISOString().slice(0, 10) : '', type: e.type, rewatch: !!e.rewatch, title: e.title, season: e.season ?? '', episode: e.episode ?? '', rating: e.rating ?? '' }));
    if (fmt === 'csv') download('refract-history.csv', toCSV(rows), 'text/csv');
    else download('refract-history.json', JSON.stringify(rows, null, 2), 'application/json');
  };
  const { search, controls } = buildToolbar(root, { onExport: doExport });
  search.value = state.q;
  const sortSel = menuSelect({
    value: state.sort, kind: 'sort',
    options: [{ id: 'recent', label: 'Newest first' }, { id: 'oldest', label: 'Oldest first' }],
    onChange: (id) => { state.sort = id; state.page = 0; draw(); },
  });
  const typeSel = menuSelect({
    value: state.type, kind: 'filter',
    options: [{ id: 'all', label: 'All' }, { id: 'episode', label: 'Episodes' }, { id: 'movie', label: 'Movies' }, { id: 'rewatch', label: 'Rewatches only' }],
    onChange: (id) => { state.type = id; state.page = 0; draw(); },
  });
  const countPill = el('span', { class: 'count-pill' });
  controls.append(sortSel, typeSel, countPill);

  const container = el('div');
  const pager = el('div', { class: 'pager' });
  root.append(container, pager);

  function computed() {
    let items = events;
    if (state.type === 'rewatch') items = items.filter(e => e.rewatch);
    else if (state.type !== 'all') items = items.filter(e => e.type === state.type);
    if (state.q) {
      const q = norm(state.q);
      items = items.filter(e => norm(e.title).includes(q) || norm(e.ref.originalTitle || '').includes(q));
    }
    if (state.sort === 'oldest') items = [...items].reverse();   // base list is newest-first
    return items;
  }
  function draw() {
    const items = computed();
    countPill.hidden = items.length === events.length;
    countPill.textContent = `${fmtInt(items.length)} of ${fmtInt(events.length)}`;
    const pages = Math.max(1, Math.ceil(items.length / state.pageSize));
    state.page = Math.min(state.page, pages - 1);
    const slice = items.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
    container.innerHTML = '';
    let lastDay = null, wrap = null;
    for (const ev of slice) {
      const day = ev.date ? ev.date.toDateString() : 'Unknown date';
      if (day !== lastDay) {
        container.append(el('div', { class: 'day-divider', text: ev.date ? fmtDate(ev.date) : 'Unknown date' }));
        wrap = el('div', { class: 'cards' });
        container.append(wrap);
        lastDay = day;
      }
      wrap.append(historyItem(ev));
    }
    pager.innerHTML = '';
    if (pages > 1) {
      pager.append(
        el('button', { html: '<i class="ph ph-caret-left"></i>Prev', disabled: state.page === 0 ? '' : false, onclick: () => { state.page--; draw(); window.scrollTo(0, 0); } }),
        el('span', { text: `Page ${state.page + 1} of ${pages}` }),
        el('button', { html: 'Next<i class="ph ph-caret-right"></i>', disabled: state.page >= pages - 1 ? '' : false, onclick: () => { state.page++; draw(); window.scrollTo(0, 0); } }),
      );
    }

    // Lazily fetch episode titles/thumbnails for the shows on this page; redraw when they arrive.
    if (Enrichment.enabled) {
      Enrichment.ensure(slice.filter(e => e.type === 'episode').map(e => enrichItem(e.ref)), true)
        .then(n => { if (n > 0 && STATE.view === 'watch-history') draw(); });
    }
    if (MovieMeta.enabled) {
      MovieMeta.ensure(slice.filter(e => e.type === 'movie' && !e.ref.titleWasExplicit).map(e => e.title))
        .then(n => { if (n > 0 && STATE.view === 'watch-history') draw(); });
    }
    persist();
  }
  search.addEventListener('input', () => { state.q = search.value; state.page = 0; draw(); });
  draw();
}
