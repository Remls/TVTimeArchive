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

export function parseDate(s) {
  if (!s) return null;
  s = String(s);
  // ISO 8601 carrying its own zone ("…T15:56:33+00:00" or "…Z"): let Date honor the offset.
  if (/[T ]\d{2}:\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  // Naive "YYYY-MM-DD HH:MM:SS": TV Time stores these in UTC (see the notifications table,
  // which spells out +00:00), so parse as UTC and let display convert to browser-local time.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  // Date-only value (no time): keep it as a local calendar date so the day never shifts.
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

export const fmtDate = (d) => d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

export const fmtDateTime = (d) => d ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';

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
