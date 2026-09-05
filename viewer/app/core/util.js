import { T } from './state.js';

/* -------------------------------------------------------------------
   Small utilities
   ------------------------------------------------------------------- */
export const $  = (sel, el = document) => el.querySelector(sel);

export const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};

export const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

export const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export const nonEmpty = (v) => v !== undefined && v !== null && String(v).trim() !== '';

export const truncate = (s, n) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const DATE_ONLY = new WeakSet();   // dates parsed from a string that carried no time of day

/* `mode` says how to read a stamp where the string itself does not settle it.
     'utc'   a naive stamp is UTC, and a stated zone is honored
     'wall'  the digits are the wall clock, and a stated zone is ignored */
export function parseDate(s, mode = 'utc') {
  if (!s) return null;
  s = String(s);
  // ISO 8601 carrying its own zone ("…T15:56:33+00:00" or "…Z"): let Date honor the offset.
  if (mode !== 'wall' && /[T ]\d{2}:\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s); return isNaN(d) ? null : d;
  }
  // Naive "YYYY-MM-DD HH:MM(:SS)". Under 'utc' this is the TV Time reading: no zone is
  // stated for those anywhere in the export, so they are read as UTC and shown in the
  // browser's zone. That is an assumption, not a fact: the one column that spells out an
  // offset is the notifications `date`, written by a different part of the service. If it
  // is wrong they are wall clocks, and every TV Time timestamp is off by the browser's
  // offset.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const p = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)];
    return mode === 'wall' ? new Date(...p) : new Date(Date.UTC(...p));
  }
  // Date-only value (no time): keep it as a local calendar date so the day never shifts.
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) { const d = new Date(+m2[1], +m2[2] - 1, +m2[3]); DATE_ONLY.add(d); return d; }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/* The one date renderer: `11 Sep 2026` by default, `11 Sep 2026, 02:34:56pm`
   with { time: true }. Built by hand rather than through toLocaleString so the
   shape is the same in every locale. A value that came out of a date-only
   string has no clock to print, so it stays date-only whatever the caller asks. */
export function fmtDate(d, { time = false } = {}) {
  if (!d) return '-';
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (!time || DATE_ONLY.has(d)) return day;
  const h = d.getHours();
  return `${day}, ${pad2(h % 12 || 12)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${h < 12 ? 'am' : 'pm'}`;
}

export const fmtInt = (n) => (n || 0).toLocaleString();

export function fmtDuration(seconds) {
  seconds = Math.round(toNum(seconds));
  if (!seconds) return '0m';
  const MONTH = 30 * 86400;   // approximate; months = 30 days
  const mo = Math.floor(seconds / MONTH);
  const d = Math.floor((seconds % MONTH) / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  // Drop leading zero units; once a larger unit shows, keep the smaller ones (incl. 0).
  if (mo > 0) return `${mo}mo ${d}d ${h}h`;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

/* ---- Browser-history + URL navigation ----
   The current view is reflected in the URL hash (#/shows, #/shows/<slug>) so it's
   shareable and survives refresh, and the device Back button works in-app.
   A nav state is { view } for a tab, or { view:'shows', detail:<slug> } for a detail. */
// Keep letters/numbers from ANY script (not just a-z0-9), so non-Latin titles
// (CJK, Arabic, Cyrillic, …) produce a real slug instead of collapsing to empty.
export const slugify = (t) => norm(t).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
