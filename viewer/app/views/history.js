import { Enrichment, MovieMeta, movieTitle } from '../core/enrich.js';
import { zoomImg } from '../core/media.js';
import { STATE } from '../core/state.js';
import { $, download, el, fmtDate, fmtDateTime, fmtDuration, fmtInt, norm, toCSV } from '../core/util.js';
import { buildToolbar, entityNav, menuSelect, viewHead } from '../ui/kit.js';
import { navigate } from '../ui/router.js';

export function historyItem(ev) {
  const info = ev.type === 'episode' ? Enrichment.epInfo(ev.title, ev.seriesId, ev.season, ev.episode) : null;
  const epName = info && info.name;
  const sub = ev.type === 'episode'
    ? `S${ev.season || '?'}E${ev.episode || '?'}${epName ? ' ' + epName : ''}${ev.rewatch ? ' (rewatch)' : ''}`
    : `Movie${ev.rewatch ? ' (rewatch)' : ''}`;
  const kids = [];
  // Thumbnail slot for both types when enrichment is on: episodes get the image,
  // movies get an empty placeholder so rows stay aligned.
  if (Enrichment.enabled) {
    const img = ev.type === 'episode' && info && info.image ? info.image : null;
    kids.push(zoomImg('item-thumb', img, ev.title, info && info.imageFull));
  }
  kids.push(el('div', { class: 'item-main' }, [
    el('div', { class: 'item-title', text: ev.type === 'movie' ? movieTitle(ev.title) : ev.title }),
    el('div', { class: 'item-meta' }, [
      el('span', { text: sub }),
      ev.runtime ? el('span', { text: fmtDuration(ev.runtime) }) : null,
      el('span', { text: fmtDateTime(ev.date) }),
    ]),
  ]));
  kids.push(el('div', { class: 'item-right' }, [
    el('span', { class: 'badge ' + (ev.type === 'movie' ? 'warn' : 'accent'), html: ev.type === 'movie' ? '<i class="ph ph-film-slate"></i>' : '<i class="ph ph-television"></i>' }),
  ]));
  const nav = entityNav(ev.type, ev.title);
  const item = el('div', { class: 'item' + (nav ? ' clickable' : '') }, kids);
  if (nav) { item.title = nav.view === 'movies' ? 'View movie details' : 'View episode progress'; item.addEventListener('click', () => navigate(nav)); }
  return item;
}

export function renderHistory(root) {
  const events = STATE.model.history;
  const saved = STATE.listState.history || {};
  const state = { q: saved.q || '', type: saved.type || 'all', sort: saved.sort || 'recent', page: saved.page || 0, pageSize: 60 };
  const persist = () => { STATE.listState.history = { q: state.q, type: state.type, sort: state.sort, page: state.page }; };

  viewHead(root, 'Watch history', `${fmtInt(events.length)} watch events`);
  const doExport = (fmt) => {
    const rows = computed().map(e => ({ date: e.date ? e.date.toISOString() : '', type: e.type, rewatch: e.rewatch, title: e.title, season: e.season, episode: e.episode, runtime_seconds: e.runtime }));
    if (fmt === 'csv') download('tvtime-history.csv', toCSV(rows), 'text/csv');
    else download('tvtime-history.json', JSON.stringify(rows, null, 2), 'application/json');
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
      items = items.filter(e => norm(e.title).includes(q) || (e.type === 'movie' && norm(movieTitle(e.title)).includes(q)));
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
    let lastDay = null;
    const wrap = el('div', { class: 'cards' });
    for (const ev of slice) {
      const day = ev.date ? ev.date.toDateString() : 'Unknown date';
      if (day !== lastDay) { container.append(wrap.childNodes.length ? wrap.cloneNode(true) : document.createComment('')); wrap.innerHTML = ''; container.append(el('div', { class: 'day-divider', text: ev.date ? fmtDate(ev.date) : 'Unknown date' })); lastDay = day; const nw = el('div', { class: 'cards' }); container.append(nw); wrap._cur = nw; }
      (wrap._cur || wrap).append(historyItem(ev));
    }
    pager.innerHTML = '';
    if (pages > 1) {
      pager.append(
        el('button', { text: '‹ Prev', disabled: state.page === 0 ? '' : false, onclick: () => { state.page--; draw(); window.scrollTo(0, 0); } }),
        el('span', { text: `Page ${state.page + 1} of ${pages}` }),
        el('button', { text: 'Next ›', disabled: state.page >= pages - 1 ? '' : false, onclick: () => { state.page++; draw(); window.scrollTo(0, 0); } }),
      );
    }

    // Lazily fetch episode titles/thumbnails for the shows on this page; redraw when they arrive.
    if (Enrichment.enabled) {
      Enrichment.ensure(slice.filter(e => e.type === 'episode'), true)
        .then(n => { if (n > 0 && STATE.view === 'watch-history') draw(); });
    }
    if (MovieMeta.enabled) {
      MovieMeta.ensure(slice.filter(e => e.type === 'movie').map(e => e.title))
        .then(n => { if (n > 0 && STATE.view === 'watch-history') draw(); });
    }
    persist();
  }
  search.addEventListener('input', () => { state.q = search.value; state.page = 0; draw(); });
  draw();
}
