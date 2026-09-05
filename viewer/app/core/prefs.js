/* -------------------------------------------------------------------
   Every user setting, in one localStorage object, shared by both viewers
   because they are served from the same origin. Caches keep their own
   keys: this holds only what the user chose.

     { autoLoad: { shows, movies }, timestamp: { date, time } }
   ------------------------------------------------------------------- */

const KEY = 'tvt.prefs';

function readAll() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

function writeAll(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {}
}

export function get(section) {
  const v = readAll()[section];
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/* Re-reads before writing and replaces only the named section, so two
   sections, or two tabs, never drop each other's changes. */
export function set(section, patch) {
  const all = readAll();
  all[section] = { ...get(section), ...patch };
  writeAll(all);
}

/* The two settings that predate this object. Seeded on `autoLoad` being
   absent rather than on the old keys being present, so it survives running
   twice, and the old keys go only after the new object is safely written.
   Removing this migration would reset anyone who has not opened the app
   since it landed. */
function migrateLegacy() {
  const all = readAll();
  if (all.autoLoad) return;
  try {
    set('autoLoad', {
      shows: localStorage.getItem('tvt.enrich') === '1',
      movies: localStorage.getItem('tvt.movies') === '1',
    });
    localStorage.removeItem('tvt.enrich');
    localStorage.removeItem('tvt.movies');
  } catch {}
}

migrateLegacy();
