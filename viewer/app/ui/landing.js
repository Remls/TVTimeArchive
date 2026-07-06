import { Enrichment, MovieMeta } from '../core/enrich.js';
import { STATE, UI } from '../core/state.js';
import { Backup, Extended, IDB } from '../core/storage.js';
import { $, norm } from '../core/util.js';
import { buildModel } from '../model/model.js';
import { applyState, hashToState, navigate } from './router.js';
import { buildChrome, closeNavMenus } from './shell.js';

/* -------------------------------------------------------------------
   Load & parse the zip
   ------------------------------------------------------------------- */
export async function loadArchive(file, opts = {}) {
  showLoading(opts.restoring ? 'Restoring your archive…' : 'Reading archive…');
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    return fail('That doesn’t look like a valid .zip archive.');
  }

  const csvEntries = Object.values(zip.files).filter(f => !f.dir && /\.csv$/i.test(f.name));
  if (!csvEntries.length) return fail('No CSV files found inside the archive.');

  showLoading(`Parsing ${csvEntries.length} CSV files…`);
  const tables = {};
  for (const entry of csvEntries) {
    const text = await entry.async('string');
    const base = entry.name.split('/').pop();          // strip any folder prefix
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', dynamicTyping: false });
    tables[base] = { fields: parsed.meta.fields || [], rows: parsed.data || [] };
  }
  STATE.tables = tables;
  Extended.load();   // imported character/friend names, if any

  try {
    STATE.model = buildModel(tables);
  } catch (e) {
    console.error(e);
    return fail('Failed while interpreting the data: ' + e.message);
  }

  // Index show titles -> TheTVDB id so name-only views (Reactions) can hit the enrichment cache.
  Enrichment.seriesIdByName = {};
  for (const s of STATE.model.shows) if (s.id) Enrichment.seriesIdByName[norm(s.title)] = s.id;

  // Load any locally-backed-up comment images so they render from local copies.
  await Backup.init();

  // Persist the raw archive locally (IndexedDB) so it reloads next visit. Never uploaded.
  if (!opts.restoring) IDB.put(file, file.name || 'archive.zip');

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

export function fail(msg) {
  $('#loadingBar').hidden = true;
  showChooser();   // reveal the dropzone so the user can pick a file
  const e = $('#landingError');
  e.textContent = msg; e.hidden = false;
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
  IDB.get().then(rec => {
    if (rec && rec.blob) loadArchive(rec.blob, { restoring: true }).then(ok => { if (!ok) IDB.clear(); });
    else showChooser();
  });
}
document.addEventListener('DOMContentLoaded', initLanding);
