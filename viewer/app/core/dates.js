/* -------------------------------------------------------------------
   Reading a date out of an export, and rendering one back out. The two
   live together because the marker below is private state they share.
   ------------------------------------------------------------------- */

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
