import { STATE } from '../core/state.js';
import { $, download, el, fmtInt, norm, toCSV } from '../core/util.js';
import { buildToolbar, emptyState, viewHead } from '../ui/kit.js';

/* A cell's text. Scalars print as themselves. An array prints its items
   comma-separated, so watchedEpisodes reads "S1E10, S1E7, …" rather than as
   JSON. An object prints as spaced JSON. null and an empty array are blank:
   ratings alone carries 787 empty arrays, and they say nothing. The column's
   own max-width does the truncating, so the full text is built and the
   browser adds the ellipsis. */
const spacedJson = (v) => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ');
const itemText = (v) => (v !== null && typeof v === 'object' ? spacedJson(v) : String(v));

export function cellText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.length ? v.map(itemText).join(', ') : '';
  if (typeof v === 'object') return spacedJson(v);
  return String(v);
}

// A row is nested where a cell holds an object or a non-empty array.
export const isNested = (v) => v !== null && typeof v === 'object' && !(Array.isArray(v) && !v.length);

/* One lowercased string per row, built once and kept, so searching an
   18,000-row section doesn't re-serialise every cell on every keystroke. */
const haystacks = new WeakMap();
function haystack(row, fields) {
  let h = haystacks.get(row);
  if (h === undefined) { h = norm(fields.map(f => cellText(row[f])).join(' ')); haystacks.set(row, h); }
  return h;
}

/* ---------- JSON rendering ----------
   One token vocabulary, two layouts: a single line inside a table cell, and
   an indented tree in the panel a cell opens. Cell previews stop after CAP
   entries because the column clips long before that; the panel always shows
   the whole value. */
const CAP = 40;
const tok = (cls, text) => el('span', { class: 'j-' + cls, text: String(text) });
const quoted = (s) => JSON.stringify(s);

// JSON-faithful nodes: strings quoted, arrays bracketed.
function jsonNodes(v, out = []) {
  if (v === null || v === undefined) return out.push(tok('lit', 'null')), out;
  if (typeof v === 'boolean') return out.push(tok('lit', v)), out;
  if (typeof v === 'number') return out.push(tok('num', v)), out;
  if (typeof v !== 'object') return out.push(tok('string', quoted(String(v)))), out;
  if (Array.isArray(v)) {
    if (!v.length) return out.push(tok('punct', '[]')), out;
    out.push(tok('punct', '[ '));
    v.slice(0, CAP).forEach((x, i) => { if (i) out.push(tok('punct', ', ')); jsonNodes(x, out); });
    if (v.length > CAP) out.push(tok('punct', ', …'));
    out.push(tok('punct', ' ]'));
    return out;
  }
  const keys = Object.keys(v);
  if (!keys.length) return out.push(tok('punct', '{}')), out;
  out.push(tok('punct', '{ '));
  keys.slice(0, CAP).forEach((k, i) => {
    if (i) out.push(tok('punct', ', '));
    out.push(tok('key', quoted(k)), tok('punct', ': '));
    jsonNodes(v[k], out);
  });
  if (keys.length > CAP) out.push(tok('punct', ', …'));
  out.push(tok('punct', ' }'));
  return out;
}

// A bare scalar: no quotes, because a cell is not a JSON document.
const scalarTok = (v) => tok(typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'lit' : 'string', v);

/* A cell's nodes, matching cellText exactly. Scalars print bare, so a CSV
   column of plain strings looks like plain strings. Quotes and brackets only
   appear inside a nested value, where they carry the structure. */
function cellNodes(v) {
  if (v == null || (Array.isArray(v) && !v.length)) return [];
  if (Array.isArray(v)) {
    const out = [];
    v.slice(0, CAP).forEach((x, i) => {
      if (i) out.push(tok('punct', ', '));
      if (x !== null && typeof x === 'object') jsonNodes(x, out); else out.push(scalarTok(x));
    });
    if (v.length > CAP) out.push(tok('punct', ', …'));
    return out;
  }
  if (typeof v === 'object') return jsonNodes(v);
  return [scalarTok(v)];
}

const indentOf = (d) => '  '.repeat(d);

/* One <span> per value so a collapsed branch can be swapped for its expanded
   self in place. Real spaces and newlines, so selecting the panel and copying
   yields valid JSON. */
function treeNodes(v, depth, collapseFrom) {
  const box = el('span');
  const nest = (x) => x !== null && typeof x === 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length);

  if (!nest(v)) { box.append(...jsonNodes(v)); return box; }

  const arr = Array.isArray(v);
  const entries = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
  box.append(tok('punct', arr ? '[' : '{'));
  entries.forEach(([k, x], i) => {
    box.append(document.createTextNode('\n' + indentOf(depth + 1)));
    if (!arr) box.append(tok('key', quoted(k)), tok('punct', ': '));
    if (nest(x) && depth + 1 >= collapseFrom) {
      const stub = el('span', { class: 'fold', title: 'Expand' }, [
        el('i', { class: 'ph ph-caret-right caret' }),
        el('span', { text: Array.isArray(x) ? '[ … ]' : '{ … }' }),
      ]);
      stub.addEventListener('click', (e) => { e.stopPropagation(); stub.replaceWith(treeNodes(x, depth + 1, Infinity)); });
      box.append(stub);
    } else {
      box.append(treeNodes(x, depth + 1, collapseFrom));
    }
    if (i < entries.length - 1) box.append(tok('punct', ','));
  });
  box.append(document.createTextNode('\n' + indentOf(depth)), tok('punct', arr ? ']' : '}'));
  return box;
}

/* The panel a nested cell opens: the whole value, folded one level down,
   with the field name and the three actions across the top. */
function jsonPanel(field, value) {
  const body = el('div', { class: 'json-body' });
  const render = (collapseFrom) => { body.innerHTML = ''; body.append(treeNodes(value, 0, collapseFrom)); };
  render(1);

  const iconBtn = (icon, label, onclick) =>
    el('button', { html: `<i class="ph ph-${icon}"></i>`, title: label, 'aria-label': label, onclick });

  const copy = iconBtn('copy', 'Copy', async () => {
    // The whole value, not what happens to be unfolded.
    let icon = 'check', label = 'Copied';
    try { await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); }
    catch { icon = 'warning'; label = 'Copy failed'; }
    setCopy(icon, label);
    setTimeout(() => setCopy('copy', 'Copy'), 1600);
  });
  const setCopy = (icon, label) => {
    copy.innerHTML = `<i class="ph ph-${icon}"></i>`;
    copy.title = label;
    copy.setAttribute('aria-label', label);
  };

  return el('div', { class: 'json-panel' }, [
    el('div', { class: 'json-head' }, [
      el('span', { class: 'json-field', text: field }),
      el('span', { class: 'json-btns' }, [
        iconBtn('arrows-out-line-vertical', 'Expand all', () => render(Infinity)),
        iconBtn('arrows-in-line-vertical', 'Collapse all', () => render(1)),
        copy,
      ]),
    ]),
    body,
  ]);
}

/* ---------- Export ----------
   The view keeps rows nested; a spreadsheet cannot, so CSV flattens on the way
   out. Keys keep their source spelling and gain a dotted path (item.tmdbId),
   and arrays are JSON-encoded. A CSV-sourced table has no nesting, so its rows
   and column names pass through untouched. */
function flattenInto(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenInto(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : (v == null ? '' : v);
  }
  return out;
}

/* toCSV reads its columns off the first row, so every row is given the same
   keys: `ratings.item` is an object on 37 rows and null on 360. */
function flatRows(rows) {
  const flat = rows.map(r => flattenInto(r, '', {}));
  const cols = [];
  for (const r of flat) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return flat.map(r => Object.fromEntries(cols.map(c => [c, r[c] ?? ''])));
}

export function renderRaw(root) {
  const n = Object.keys(STATE.tables).length;
  viewHead(root, 'All data', `${n} ${STATE.manifest ? (n === 1 ? 'section' : 'sections') : 'CSV files'}`);

  const names = Object.keys(STATE.tables).sort();
  const saved = STATE.listState.raw || {};
  const state = {
    file: (saved.file && STATE.tables[saved.file]) ? saved.file : names[0],
    q: saved.q || '', page: saved.page || 0, pageSize: 100,
    sortCol: saved.sortCol || null, sortDir: saved.sortDir || 1,
  };
  const persist = () => { STATE.listState.raw = { file: state.file, q: state.q, page: state.page, sortCol: state.sortCol, sortDir: state.sortDir }; };

  const doExport = (fmt) => {
    const { rows } = computed();
    const base = state.file + '-filtered';
    if (fmt === 'csv') download(base + '.csv', toCSV(flatRows(rows)), 'text/csv');
    else download(base + '.json', JSON.stringify(rows, null, 2), 'application/json');
  };
  const { search, controls } = buildToolbar(root, { onExport: doExport });
  search.value = state.q;
  const picker = el('select', { class: 'raw-picker', title: 'File' });
  for (const n of names) picker.append(el('option', { value: n, text: `${n}  (${fmtInt(STATE.tables[n].rows.length)} rows)` }));
  picker.value = state.file;
  const countPill = el('span', { class: 'count-pill' });
  controls.append(picker, countPill);

  const tableWrap = el('div', { class: 'table-wrap' });
  const pager = el('div', { class: 'pager' });
  root.append(tableWrap, pager);

  function computed() {
    const tbl = STATE.tables[state.file];
    let rows = tbl.rows;
    if (state.q) { const q = norm(state.q); rows = rows.filter(r => haystack(r, tbl.fields).includes(q)); }
    if (state.sortCol) {
      rows = [...rows].sort((a, b) => {
        const av = cellText(a[state.sortCol]), bv = cellText(b[state.sortCol]);
        const an = parseFloat(av), bn = parseFloat(bv);
        const cmp = (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '') ? an - bn : av.localeCompare(bv);
        return cmp * state.sortDir;
      });
    }
    return { tbl, rows };
  }
  /* A row opens itself in full beneath itself: the whole record, pretty-printed,
     with nothing truncated. Several can be open at once, each owning the row it
     inserted; the next draw() rebuilds the table and takes them with it. */
  function toggleRow(tr, row, label, colCount) {
    if (tr._panel) { tr._panel.remove(); tr._panel = null; tr.classList.remove('open'); return; }
    const panel = jsonPanel(label, row);
    // The cell spans the full table, which can be far wider than the viewport,
    // so the panel is pinned to the scrollport and sized to it.
    panel.style.width = tableWrap.clientWidth + 'px';
    const panelRow = el('tr', { class: 'json-row' }, [el('td', { colspan: colCount }, [panel])]);
    tr.after(panelRow);
    tr._panel = panelRow;
    tr.classList.add('open');
  }

  function draw() {
    const { tbl, rows } = computed();
    countPill.textContent = rows.length === tbl.rows.length ? `${fmtInt(tbl.rows.length)} rows` : `${fmtInt(rows.length)} of ${fmtInt(tbl.rows.length)} rows`;
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.page = Math.min(state.page, pages - 1);
    const slice = rows.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);

    // A section can be empty in the export itself, which would otherwise draw
    // a table with no columns and no rows.
    if (!rows.length) {
      tableWrap.innerHTML = '';
      tableWrap.append(tbl.rows.length
        ? emptyState('Nothing matches your search', { icon: 'ph-magnifying-glass' })
        : emptyState('This file is empty', { icon: 'ph-tray' }));
      pager.innerHTML = '';
      persist();
      return;
    }

    const table = el('table', { class: 'data' });
    const thead = el('thead'); const htr = el('tr');
    for (const f of tbl.fields) {
      htr.append(el('th', { text: f + (state.sortCol === f ? (state.sortDir === 1 ? ' ▲' : ' ▼') : ''), onclick: () => { if (state.sortCol === f) state.sortDir *= -1; else { state.sortCol = f; state.sortDir = 1; } draw(); } }));
    }
    thead.append(htr); table.append(thead);
    const tbody = el('tbody');
    slice.forEach((r, i) => {
      const tr = el('tr', { class: 'expandable', title: 'Click to see the whole row' });
      for (const f of tbl.fields) {
        const v = r[f];
        // A nested cell's full text can run to thousands of characters; the row
        // itself is the way to read it, so no tooltip for those.
        tr.append(el('td', { title: isNested(v) ? null : cellText(v) }, cellNodes(v)));
      }
      const label = `${state.file} · row ${fmtInt(state.page * state.pageSize + i + 1)}`;
      tr.addEventListener('click', () => toggleRow(tr, r, label, tbl.fields.length));
      tbody.append(tr);
    });
    table.append(tbody);
    tableWrap.innerHTML = ''; tableWrap.append(table);

    pager.innerHTML = '';
    if (pages > 1) pager.append(
      el('button', { html: '<i class="ph ph-caret-left"></i>Prev', disabled: state.page === 0 ? '' : false, onclick: () => { state.page--; draw(); } }),
      el('span', { text: `Page ${state.page + 1} of ${pages}` }),
      el('button', { html: 'Next<i class="ph ph-caret-right"></i>', disabled: state.page >= pages - 1 ? '' : false, onclick: () => { state.page++; draw(); } }),
    );
    persist();
  }
  picker.addEventListener('change', () => { state.file = picker.value; state.q = ''; search.value = ''; state.page = 0; state.sortCol = null; state.sortDir = 1; draw(); });
  search.addEventListener('input', () => { state.q = search.value; state.page = 0; draw(); });
  draw();
}
