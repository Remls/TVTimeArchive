import { STATE } from '../core/state.js';
import { $, download, el, fmtInt, norm, toCSV } from '../core/util.js';
import { buildToolbar, viewHead } from '../ui/kit.js';

export function renderRaw(root) {
  viewHead(root, 'All data', `${Object.keys(STATE.tables).length} CSV files`);

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
    const base = state.file.replace('.csv', '') + '-filtered';
    if (fmt === 'csv') download(base + '.csv', toCSV(rows), 'text/csv');
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
    if (state.q) { const q = norm(state.q); rows = rows.filter(r => tbl.fields.some(f => norm(r[f]).includes(q))); }
    if (state.sortCol) {
      rows = [...rows].sort((a, b) => {
        const av = a[state.sortCol] ?? '', bv = b[state.sortCol] ?? '';
        const an = parseFloat(av), bn = parseFloat(bv);
        const cmp = (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '') ? an - bn : String(av).localeCompare(String(bv));
        return cmp * state.sortDir;
      });
    }
    return { tbl, rows };
  }
  function draw() {
    const { tbl, rows } = computed();
    countPill.textContent = rows.length === tbl.rows.length ? `${fmtInt(tbl.rows.length)} rows` : `${fmtInt(rows.length)} of ${fmtInt(tbl.rows.length)} rows`;
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.page = Math.min(state.page, pages - 1);
    const slice = rows.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);

    const table = el('table', { class: 'data' });
    const thead = el('thead'); const htr = el('tr');
    for (const f of tbl.fields) {
      htr.append(el('th', { text: f + (state.sortCol === f ? (state.sortDir === 1 ? ' ▲' : ' ▼') : ''), onclick: () => { if (state.sortCol === f) state.sortDir *= -1; else { state.sortCol = f; state.sortDir = 1; } draw(); } }));
    }
    thead.append(htr); table.append(thead);
    const tbody = el('tbody');
    for (const r of slice) {
      const tr = el('tr');
      for (const f of tbl.fields) { const v = r[f] ?? ''; tr.append(el('td', { title: v, text: v })); }
      tbody.append(tr);
    }
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
