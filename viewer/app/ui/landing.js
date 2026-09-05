import { APP } from '../core/app.js';
import { Enrichment, MovieMeta } from '../core/enrich.js';
import { STATE, UI } from '../core/state.js';
import { $, el } from '../core/util.js';
import { applyState, hashToState, navigate } from './router.js';
import { buildChrome, closeNavMenus } from './shell.js';

/* -------------------------------------------------------------------
   Load & parse the zip

   Two archive layouts. A flat set of CSVs (TV Time's GDPR export, and
   Refract's original export) becomes one table per file, keyed by
   filename. A manifest-led backup (Refract format 3.0) carries
   manifest.json plus data/<section>.jsonl, and becomes one table per
   section, keyed by section name.
   ------------------------------------------------------------------- */

const entryPath = (entry) => entry.name.replace(/^\.?\//, '');
const fileEntries = (zip) => Object.values(zip.files).filter(f => !f.dir);
const readText = async (entry) => (await entry.async('string')).replace(/^\uFEFF/, '');   // strip a UTF-8 BOM (Refract CSVs carry one)

/* One table from a .jsonl section: the rows stay as parsed, nesting intact,
   and the fields are their top-level keys. Fields accumulate in first-seen
   order across rows, since sections like ratings carry `item` as an object
   on some rows and null on others. */
function jsonlTable(text) {
  const rows = [], fields = [];
  const seen = new Set();
  let malformed = 0;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let obj;
    try { obj = JSON.parse(s); } catch { malformed++; continue; }
    rows.push(obj);
    for (const f of Object.keys(obj)) if (!seen.has(f)) { seen.add(f); fields.push(f); }
  }
  return { fields, rows, malformed };
}

/* Refract 3.0: manifest.json names every section and its file, so a section
   added by a later release still reaches the table view. Anything under
   data/ that the manifest omits is picked up too. */
async function readManifest(zip) {
  const entry = fileEntries(zip).find(f => entryPath(f) === 'manifest.json');
  if (!entry) return null;
  try {
    const m = JSON.parse(await readText(entry));
    return (m && m.sections && typeof m.sections === 'object') ? m : null;
  } catch { return null; }
}

async function readSections(zip, manifest) {
  const byPath = new Map(fileEntries(zip).map(f => [entryPath(f), f]));
  const wanted = new Map();   // section name -> zip entry
  for (const [name, info] of Object.entries(manifest.sections)) {
    const entry = byPath.get(String((info && info.file) || `data/${name}.jsonl`));
    if (entry) wanted.set(name, entry);
  }
  for (const [p, entry] of byPath) {
    const m = /^data\/(.+)\.jsonl$/i.exec(p);
    if (m && !wanted.has(m[1])) wanted.set(m[1], entry);
  }
  if (!wanted.size) throw new Error('That backup’s manifest lists no readable data sections.');

  showLoading(`Parsing ${wanted.size} data sections…`);
  const tables = {};
  let malformed = 0;
  for (const [name, entry] of wanted) {
    const t = jsonlTable(await readText(entry));
    malformed += t.malformed;
    tables[name] = t;
  }
  if (malformed) console.warn(`Skipped ${malformed} unparseable line(s) in the archive.`);
  return tables;
}

async function readCsvTables(zip) {
  const csvEntries = fileEntries(zip).filter(f => /\.csv$/i.test(f.name));
  if (!csvEntries.length) throw new Error('No CSV files found inside the archive.');

  showLoading(`Parsing ${csvEntries.length} CSV files…`);
  const tables = {};
  for (const entry of csvEntries) {
    const base = entryPath(entry).split('/').pop();    // strip any folder prefix
    const parsed = Papa.parse(await readText(entry), { header: true, skipEmptyLines: 'greedy', dynamicTyping: false });
    tables[base] = { fields: parsed.meta.fields || [], rows: parsed.data || [] };
  }
  return tables;
}

export async function loadArchive(file, opts = {}) {
  showLoading(opts.restoring ? 'Restoring your archive…' : 'Reading archive…');
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    return fail('That doesn’t look like a valid .zip archive.');
  }

  let manifest = null, tables;
  try {
    manifest = await readManifest(zip);
    tables = manifest ? await readSections(zip, manifest) : await readCsvTables(zip);
  } catch (e) {
    return fail(e.message);
  }
  STATE.manifest = manifest;
  STATE.tables = tables;
  if (APP.beforeModel) APP.beforeModel();

  try {
    STATE.model = APP.buildModel(tables, { manifest });
  } catch (e) {
    console.error(e);
    // A zip meant for the other viewer is a recognition problem, not a parse one.
    return fail(e.wrongViewer ? e.message : 'Failed while interpreting the data: ' + e.message, e.href);
  }

  if (APP.afterModel) await APP.afterModel(STATE.model);

  // Persist the raw archive locally (IndexedDB) so it reloads next visit. Never uploaded.
  if (!opts.restoring) APP.archive.put(file, file.name || 'archive.zip');

  $('#landing').hidden = true;
  $('#app').hidden = false;
  buildChrome();
  navigate(hashToState(), true);   // honor a deep-link hash; establish the history base
  return true;
}

export function showLoading(msg) {
  $('#landingError').hidden = true;
  $('#loadingBar').hidden = false;
  $('#loadingText').textContent = msg;
}

/* `href`, when the zip belongs to the sibling viewer, turns the message into a
   way out rather than an instruction to go and find the other page. */
export function fail(msg, href) {
  $('#loadingBar').hidden = true;
  showChooser();   // reveal the dropzone so the user can pick a file
  const e = $('#landingError');
  e.textContent = msg;
  if (href) e.append(' Load it ', el('a', { href, text: 'here' }), ' instead.');
  e.hidden = false;
  return false;
}

export function showChooser() {
  $('#chooser').hidden = false;
  $('#loadingBar').hidden = true;
}

export function initLanding() {
  try { Enrichment.enabled = localStorage.getItem('tvt.enrich') === '1'; } catch {}
  try { MovieMeta.enabled = localStorage.getItem('tvt.movies') === '1'; } catch {}
  const input = $('#fileInput');
  const dz = $('#dropzone');
  input.addEventListener('change', () => { if (input.files[0]) loadArchive(input.files[0]); });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadArchive(f); });

  // Device Back button / hash change → replay the nav state (only once an archive is loaded).
  // If the lightbox is open, Back just closes it (and doesn't re-render the view).
  window.addEventListener('popstate', (e) => {
    if (UI.activeLightbox) { const r = UI.activeLightbox; UI.activeLightbox = null; r(); return; }
    if (STATE.model) applyState(e.state || hashToState());
  });

  // Close the mobile nav popup when tapping outside it.
  document.addEventListener('click', (e) => { if (!e.target.closest('.tab.group') && !e.target.closest('.subnav')) closeNavMenus(); });

  // Boot: check IndexedDB first. If an archive is stored, auto-load it (staying in the
  // loading state); otherwise reveal the dropzone. This avoids flashing the landing.
  APP.archive.get().then(rec => {
    if (rec && rec.blob) loadArchive(rec.blob, { restoring: true }).then(ok => { if (!ok) APP.archive.clear(); });
    else showChooser();
  });
}
