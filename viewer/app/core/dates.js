/* -------------------------------------------------------------------
   Reading a date out of an export, and rendering one back out. The two
   live together because the marker below is private state they share.
   ------------------------------------------------------------------- */
import * as Prefs from './prefs.js';

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

/* ---- Rendering ----------------------------------------------------
   Patterns use the Unicode LDML date field symbols (UTS #35), the same
   vocabulary as Intl, CLDR and java.time, so `yyyy-MM-dd` needs no
   explanation. Only the symbols below are understood, and there is no
   quoting: every other character passes through, so a pattern must not
   carry literal letters.
   ------------------------------------------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (n) => String(n).padStart(2, '0');

const TOKEN = /yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|ss|a/g;

function render(d, pattern) {
  return pattern.replace(TOKEN, (t) => {
    const h = d.getHours();
    switch (t) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy':   return pad2(d.getFullYear() % 100);
      case 'MMMM': return MONTHS_FULL[d.getMonth()];
      case 'MMM':  return MONTHS[d.getMonth()];
      case 'MM':   return pad2(d.getMonth() + 1);
      case 'M':    return String(d.getMonth() + 1);
      case 'dd':   return pad2(d.getDate());
      case 'd':    return String(d.getDate());
      case 'EEEE': return DAYS_FULL[d.getDay()];
      case 'EEE':  return DAYS[d.getDay()];
      case 'HH':   return pad2(h);
      case 'H':    return String(h);
      case 'hh':   return pad2(h % 12 || 12);
      case 'h':    return String(h % 12 || 12);
      case 'mm':   return pad2(d.getMinutes());
      case 'ss':   return pad2(d.getSeconds());
      case 'a':    return h < 12 ? 'AM' : 'PM';
    }
  });
}

/* Go's reference time with the day moved past the 12th, which is what lets a
   preview show whether a preset leads with the day or the month while the
   month keeps its zero. Every rendered number is distinct: 2006, 06, 01, 21,
   15, 03, 04, 05. Day and 24-hour hour cannot show their padding at these
   values, and no instant can fix that without losing the ordering; no preset
   below leaves either of them unpadded, so there is nothing to disambiguate. */
export const SAMPLE = new Date(2006, 0, 21, 15, 4, 5);   // a Saturday

export const DATE_PRESETS = [
  { id: 'y-mon-d',  pattern: 'yyyy MMM dd' },
  { id: 'd-mon-y',  pattern: 'dd MMM yyyy' },
  { id: 'mon-d-y',  pattern: 'MMM dd, yyyy' },
  { id: 'iso',      pattern: 'yyyy-MM-dd' },
  { id: 'd-m-y',    pattern: 'dd/MM/yyyy' },
  { id: 'm-d-y',    pattern: 'MM/dd/yyyy' },
];

export const WEEKDAYS = [
  { id: 'none',  token: '',      prefix: '' },
  { id: 'short', token: 'EEE',   prefix: 'EEE, ' },
  { id: 'full',  token: 'EEEE',  prefix: 'EEEE, ' },
];

export const TIME_PRESETS = [
  { id: 'h12-pad', pattern: 'hh:mm:ss a' },
  { id: 'h12',     pattern: 'h:mm:ss a' },
  { id: 'h24',     pattern: 'HH:mm:ss' },
];

// The controls are editors of the two pattern strings, not settings of their own.
export const composeDate = (preset, weekday, fullYear) =>
  weekday.prefix + (fullYear ? preset.pattern : preset.pattern.replace('yyyy', 'yy'));
export const composeTime = (preset, seconds) =>
  seconds ? preset.pattern : preset.pattern.replace(':ss', '');

/* ---- The stored format ---------------------------------------------- */

const DEFAULTS = { date: 'yyyy MMM dd', time: 'hh:mm:ss a' };

/* Usable means at least one symbol and nothing else alphabetic. There is no
   quoting, so a stray letter would render as junk rather than as itself. */
function usable(p) {
  if (typeof p !== 'string') return false;
  const rest = p.replace(TOKEN, '');
  return rest.length < p.length && !/[A-Za-z]/.test(rest);
}

let current = { ...DEFAULTS };

export function loadFormat() {
  const t = Prefs.get('timestamp');
  current = {
    date: usable(t.date) ? t.date : DEFAULTS.date,
    time: usable(t.time) ? t.time : DEFAULTS.time,
  };
  return { ...current };
}

export const timestampFormat = () => ({ ...current });

// Any pattern, against the sample instant. The settings menu previews with this.
export const fmtSample = (pattern) => render(SAMPLE, pattern);

/* The controls, read back out of the two stored patterns. A hand-written
   pattern that no combination produces still renders; the controls just show
   their defaults and `custom` says so. */
export function formatChoice() {
  let date = { datePreset: DATE_PRESETS[0], weekday: WEEKDAYS[0], fullYear: true, custom: true };
  for (const datePreset of DATE_PRESETS)
    for (const weekday of WEEKDAYS)
      for (const fullYear of [true, false])
        if (composeDate(datePreset, weekday, fullYear) === current.date) date = { datePreset, weekday, fullYear, custom: false };
  let time = { timePreset: TIME_PRESETS[0], seconds: true, custom: true };
  for (const timePreset of TIME_PRESETS)
    for (const seconds of [true, false])
      if (composeTime(timePreset, seconds) === current.time) time = { timePreset, seconds, custom: false };
  return { ...date, ...time, custom: date.custom || time.custom };
}

export function setTimestampFormat(patch) {
  Prefs.set('timestamp', patch);
  loadFormat();
}

loadFormat();

/* The one date renderer. `{ time: true }` appends the time pattern; a value
   that came out of a date-only string has no clock to print, so it stays
   date-only whatever the caller asks. */
export function fmtDate(d, { time = false } = {}) {
  if (!d) return '-';
  const day = render(d, current.date);
  return !time || DATE_ONLY.has(d) ? day : `${day}, ${render(d, current.time)}`;
}
