import { Enrichment, MovieMeta } from '../core/enrich.js';
import { STATE, UI } from '../core/state.js';
import { $, download, el, fmtInt, norm, slugify, toCSV } from '../core/util.js';
import { navigate } from './router.js';

export function viewHead(root, title, subtitle) {
  root.append(el('div', { class: 'view-head' }, [el('h2', { text: title }), subtitle ? el('p', { text: subtitle }) : null]));
}

/* ---- Show poster + navigation helpers ----
   Used by the summary sections (Overview, Stats, Reactions, Ratings) so each show
   row can show its poster (auto-loaded when enrichment is on) and open its detail. */
export function knownShowSlug(title) {
  const slug = slugify(title || '');
  if (!slug) return null;
  const m = STATE.model;
  if (!m._showSlugs) m._showSlugs = new Set(m.shows.map(s => slugify(s.title)));
  return m._showSlugs.has(slug) ? slug : null;
}

// A poster box that fills now if cached, else is tagged to be filled once the fetch lands.
export function autoPoster(title, seriesId) {
  const box = el('div', { class: 'item-poster' });
  const url = Enrichment.posterFor(title, seriesId);
  if (url) box.append(el('img', { src: url, loading: 'lazy', alt: '' }));
  else box.dataset.poster = Enrichment.resolveKey(title, seriesId);
  return box;
}

export function fillPostersIn(rootEl) {
  // fills any tagged poster box (list-item posters AND gallery poster cards)
  for (const box of rootEl.querySelectorAll('[data-poster]')) {
    const v = Enrichment.getCached(box.dataset.poster);
    if (v && v.img) { box.append(el('img', { src: v.img, loading: 'lazy', alt: '' })); box.removeAttribute('data-poster'); }
  }
}

/* Vertical poster tile for galleries (Home, Shows, Movies, Lists, Reactions).
   opts: { title, secondary, sub, kind:'show'|'movie', seriesId, status, rating, onClick }
   Show posters auto-resolve via Enrichment (cached now, else async-filled by ensureShowPosters);
   movies (no poster source) and un-enriched shows fall back to a dim kind icon.
   status -> top-left badge; rating (star count) -> top-right badge. */
export function posterCard(opts = {}) {
  const kind = opts.kind === 'movie' ? 'movie' : 'show';
  const art = el('div', { class: 'poster-card-art' }, [
    el('i', { class: 'ph ' + (kind === 'movie' ? 'ph-film-slate' : 'ph-television') + ' poster-card-icon' }),
  ]);
  if (kind === 'show' && Enrichment.enabled) {
    const url = Enrichment.posterFor(opts.title, opts.seriesId);
    if (url) art.append(el('img', { src: url, loading: 'lazy', alt: '' }));
    else art.dataset.poster = Enrichment.resolveKey(opts.title, opts.seriesId);
  }
  if (opts.status) art.append(el('div', { class: 'poster-card-tl' }, [statusBadge(opts.status)]));
  if (opts.rating) art.append(el('div', { class: 'poster-card-tr' }, [
    el('span', { class: 'poster-badge', html: `<i class="ph-fill ph-star"></i> ${opts.rating}` })]));
  const info = [el('div', { class: 'poster-card-title', text: opts.title })];
  if (opts.secondary) info.push(el('div', { class: 'poster-card-secondary', text: opts.secondary }));
  if (opts.sub) info.push(el('div', { class: 'poster-card-sub', text: opts.sub }));
  const card = el('div', { class: 'poster-card' + (opts.onClick ? ' clickable' : '') }, [art, el('div', { class: 'poster-card-info' }, info)]);
  if (opts.onClick) card.addEventListener('click', opts.onClick);
  return card;
}

export function ensureShowPosters(items) {
  if (!Enrichment.enabled || !items.length) return;
  const root = $('#viewRoot');
  Enrichment.ensure(items, false).then(n => { if (n > 0) fillPostersIn(root); });
}

// A show row: optional poster + main/right content; navigates to the show when known.
export function showLineItem(title, seriesId, mainKids, rightKids) {
  const slug = knownShowSlug(title);
  const kids = [];
  if (Enrichment.enabled) kids.push(autoPoster(title, seriesId));
  kids.push(el('div', { class: 'item-main' }, mainKids));
  if (rightKids && rightKids.length) kids.push(el('div', { class: 'item-right' }, rightKids));
  const item = el('div', { class: 'item' + (slug ? ' clickable' : '') }, kids);
  if (slug) { item.title = 'View episode progress'; item.addEventListener('click', () => navigate({ view: 'shows', detail: slug })); }
  return item;
}

export const showPosterItem = (title, seriesId) => ({ seriesId: seriesId || Enrichment.seriesIdByName[norm(title)] || '', title });

export const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtMonth = (s) => { const [y, mo] = String(s).split('-'); return (y && mo) ? `${MONTHS[+mo] || mo} '${y.slice(2)}` : s; };

export function barChart(root, data, fmt) {
  const max = Math.max(1, ...data.map(d => d.value));
  const wrap = el('div', { class: 'bars' });
  for (const d of data) {
    wrap.append(el('div', { class: 'bar-row' }, [
      el('span', { class: 'bar-label', text: fmtMonth(d.label) }),
      el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill', style: `width:${Math.round(d.value / max * 100)}%` })]),
      el('span', { class: 'bar-val', text: (fmt || fmtInt)(d.value) }),
    ]));
  }
  root.append(wrap);
}

/* Shared toolbar: row 1 = search (+ optional Export dropdown, pinned top-right so it's
   in the same place on every page); row 2 = the view's sort/filter selects + count. */
export function buildToolbar(root, opts = {}) {
  const search = el('input', { type: 'search', placeholder: 'Search…', class: 'tb-search' });
  const row1 = el('div', { class: 'tb-row1' }, [search, opts.onExport ? makeExportMenu(opts.onExport) : null]);
  const controls = el('div', { class: 'tb-controls' });
  root.append(el('div', { class: 'toolbar' }, [row1, controls]));
  return { search, controls };
}

/* Export dropdown: a button that opens a small CSV / JSON menu. */
export function makeExportMenu(onExport) {
  const wrap = el('div', { class: 'export-menu' });
  const btn = el('button', { class: 'btn secondary', html: '<i class="ph ph-download-simple"></i> Export' });
  const onDoc = (e) => { if (!wrap.contains(e.target)) close(); };
  function close() { pop.hidden = true; document.removeEventListener('click', onDoc); if (UI.activePopup === close) UI.activePopup = null; }
  const pick = (fmt) => (e) => { e.stopPropagation(); close(); onExport(fmt); };
  const pop = el('div', { class: 'menu-pop export-pop', hidden: '' }, [
    el('button', { class: 'menu-item', text: 'CSV', onclick: pick('csv') }),
    el('button', { class: 'menu-item', text: 'JSON', onclick: pick('json') }),
  ]);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) {
      if (UI.activePopup) UI.activePopup();
      pop.hidden = false; UI.activePopup = close;
      setTimeout(() => document.addEventListener('click', onDoc), 0);
    } else close();
  });
  wrap.append(btn, pop);
  return wrap;
}

/* Styled sort / filter dropdown: a button showing an icon + the current option +
   caret, opening a menu-pop of choices. kind ('sort' | 'filter') picks the icon.
   Replaces native <select> across the list views for a consistent, on-theme look. */
export function menuSelect({ value, options, onChange, kind }) {
  const icon = kind === 'filter' ? 'ph-funnel' : 'ph-arrows-down-up';
  const cur = () => options.find(o => o.id === value) || options[0];
  const label = el('span', { class: 'ms-label', text: cur().label });
  const btn = el('button', { class: 'ms-btn', title: kind === 'filter' ? 'Filter' : 'Sort' }, [
    el('i', { class: 'ph ' + icon + ' ms-ico' }),
    label,
    el('i', { class: 'ph ph-caret-down ms-caret' }),
  ]);
  const pop = el('div', { class: 'menu-pop ms-pop', hidden: '' });
  const wrap = el('div', { class: 'ms ms-' + kind }, [btn, pop]);
  const onDoc = (e) => { if (!wrap.contains(e.target)) close(); };
  function close() { pop.hidden = true; wrap.classList.remove('open'); document.removeEventListener('click', onDoc); if (UI.activePopup === close) UI.activePopup = null; }
  function build() {
    pop.innerHTML = '';
    for (const o of options) {
      const item = el('button', { class: 'menu-item' + (o.id === value ? ' active' : ''), text: o.label });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        if (o.id !== value) { value = o.id; label.textContent = o.label; onChange(o.id); }
      });
      pop.append(item);
    }
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) {
      if (UI.activePopup) UI.activePopup();            // close any other open menu
      build(); pop.hidden = false; wrap.classList.add('open'); UI.activePopup = close;
      setTimeout(() => document.addEventListener('click', onDoc), 0);
    } else close();
  });
  return wrap;
}

export function listView(root, cfg) {
  // cfg: { title, subtitle, items, searchKeys, sorts:[{id,label,fn}], renderItem, exportName, exportRow, twoCol, beforeList }
  viewHead(root, cfg.title, cfg.subtitle);

  if (cfg.beforeList) { const pre = el('div'); cfg.beforeList(pre); root.append(pre); }

  const saved = (cfg.stateKey && STATE.listState[cfg.stateKey]) || {};
  const filterDefault = cfg.filter ? cfg.filter.default : null;
  // Fall back to the default if a saved sort/filter id is no longer valid.
  const validSort = cfg.sorts.some(s => s.id === saved.sort) ? saved.sort : cfg.sorts[0].id;
  const validFilter = (cfg.filter && cfg.filter.options.some(o => o.id === saved.filterId)) ? saved.filterId : filterDefault;
  const state = { q: saved.q || '', sort: validSort, filterId: validFilter, page: saved.page || 0, pageSize: cfg.pageSize || 30 };
  const persist = () => { if (cfg.stateKey) STATE.listState[cfg.stateKey] = { q: state.q, sort: state.sort, filterId: state.filterId, page: state.page }; };

  const doExport = (fmt) => {
    const rows = computed().map(cfg.exportRow);
    if (fmt === 'csv') download(cfg.exportName + '.csv', toCSV(rows), 'text/csv');
    else download(cfg.exportName + '.json', JSON.stringify(rows, null, 2), 'application/json');
  };
  const { search, controls } = buildToolbar(root, cfg.exportRow ? { onExport: doExport } : {});
  search.value = state.q;
  const sortSel = menuSelect({
    value: state.sort, kind: 'sort',
    options: cfg.sorts.map(s => ({ id: s.id, label: s.label })),
    onChange: (id) => { state.sort = id; state.page = 0; draw(); },
  });
  let filterSel = null;
  if (cfg.filter) {
    filterSel = menuSelect({
      value: state.filterId, kind: 'filter',
      options: cfg.filter.options.map(o => ({ id: o.id, label: o.label })),
      onChange: (id) => { state.filterId = id; state.page = 0; draw(); },
    });
  }
  const countPill = el('span', { class: 'count-pill' });
  controls.append(...[sortSel, filterSel, countPill].filter(Boolean));

  const container = el('div', { class: cfg.gallery ? 'poster-gallery' : ('cards' + (cfg.twoCol ? ' two-col' : '')) });
  const pager = el('div', { class: 'pager' });
  root.append(container, pager);

  function computed() {
    let items = cfg.items;
    if (cfg.filter) {
      const opt = cfg.filter.options.find(o => o.id === state.filterId) || cfg.filter.options[0];
      items = items.filter(opt.test);
    }
    if (state.q) {
      const q = norm(state.q);
      items = items.filter(it => {
        const hay = cfg.searchText ? cfg.searchText(it) : cfg.searchKeys.map(k => it[k]).join(' ');
        return norm(hay).includes(q);
      });
    }
    const sort = cfg.sorts.find(s => s.id === state.sort);
    items = [...items].sort(sort.fn);
    return items;
  }

  function draw() {
    const items = computed();
    // Only show the count when a search/filter is narrowing results; the subtitle gives the total.
    countPill.hidden = items.length === cfg.items.length;
    countPill.textContent = `${fmtInt(items.length)} of ${fmtInt(cfg.items.length)}`;
    const pages = Math.max(1, Math.ceil(items.length / state.pageSize));
    state.page = Math.min(state.page, pages - 1);
    const slice = items.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);

    container.innerHTML = '';
    if (!slice.length) { container.append(emptyState('Nothing matches your search', { icon: 'ph-magnifying-glass' })); }
    for (const it of slice) container.append(cfg.renderItem(it));

    pager.innerHTML = '';
    if (pages > 1) {
      const prev = el('button', { text: '‹ Prev', disabled: state.page === 0 ? '' : false, onclick: () => { state.page--; draw(); window.scrollTo(0,0); } });
      const next = el('button', { text: 'Next ›', disabled: state.page >= pages - 1 ? '' : false, onclick: () => { state.page++; draw(); window.scrollTo(0,0); } });
      pager.append(prev, el('span', { text: `Page ${state.page + 1} of ${pages}` }), next);
    }
    persist();

    // Lazily enrich the shows on this page; redraw when posters/titles/images arrive.
    // Light fetch (poster only) unless the view needs episodes (cfg.enrichFull).
    if (cfg.enrichShows && Enrichment.enabled) {
      Enrichment.ensure(cfg.enrichShows(slice), cfg.enrichFull === true)
        .then(n => { if (n > 0 && document.contains(container)) draw(); });
    }
    if (cfg.enrichMovies && MovieMeta.enabled) {
      MovieMeta.ensure(cfg.enrichMovies(slice))
        .then(n => { if (n > 0 && document.contains(container)) draw(); });
    }
  }

  search.addEventListener('input', () => { state.q = search.value; state.page = 0; draw(); });

  draw();

  // Restore scroll once, when returning to this list (e.g. back from a show).
  if (cfg.stateKey && STATE.pendingScroll && STATE.pendingScroll.key === cfg.stateKey) {
    const y = STATE.pendingScroll.y;
    STATE.pendingScroll = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
}

export function statusBadge(status) {
  const map = { following: ['good', 'Following'], archived: ['dim', 'Archived'], stopped: ['warn', 'Stopped'], watchlist: ['accent', 'Watchlist'], watched: ['good', 'Watched'], rated: ['warn', 'Rated'] };
  const [cls, label] = map[status] || ['dim', status || '—'];
  return el('span', { class: 'badge ' + cls, text: label });
}

export function ratingChip(r) {
  return el('div', { class: 'rating-chip', title: `${r.label} (${r.stars}/5)` }, [
    el('span', { text: r.label }), el('span', { class: 'star', text: ` ${r.stars}★` }),
  ]);
}

/* Small inline chip/tag used in list items (list contents, character shows, badge shows).
   opts: { icon, unknown, clickable, onClick } */
export function chip(label, opts = {}) {
  const cls = 'chip' + (opts.unknown ? ' unknown' : '') + (opts.clickable ? ' clickable' : '');
  const node = el('span', { class: cls }, opts.icon ? [el('i', { class: 'ph ' + opts.icon }), ' ' + label] : [label]);
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  return node;
}

/* Consistent empty-state block for a view (or section) that has no data. */
export function emptyState(text, opts = {}) {
  return el('div', { class: 'empty-state' }, [
    el('i', { class: 'ph ' + (opts.icon || 'ph-tray') }),
    el('div', { text }),
  ]);
}

/* Shared "this data lives on TV Time's servers — capture it before shutdown" notice.
   opts: { icon, title, body (string | array of nodes), action (node | null) } */
export function backupNote({ icon, title, body, action }) {
  const status = el('div', { class: 'backup-note-status' }, [
    el('div', { class: 'backup-note-title' }, [el('i', { class: 'ph ' + icon }), el('strong', { text: title })]),
    Array.isArray(body) ? el('p', {}, body) : el('p', { text: body }),
  ]);
  return el('div', { class: 'backup-note' }, action ? [status, action] : [status]);
}

export function extendedNote(unresolved, total) {
  if (!unresolved) return null;
  return backupNote({
    icon: 'ph-info', title: 'Names & images',
    body: [`${fmtInt(unresolved)} of ${fmtInt(total)} still show IDs only. `,
      el('a', { href: 'https://github.com/Remls/TVTimeArchive#extended-backup', target: '_blank', rel: 'noopener noreferrer', text: 'Generate an extended backup' }),
      ' and import it (⚙) to fill these in.'],
  });
}
