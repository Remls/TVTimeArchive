/* ===================================================================
   TV Time Archive Viewer
   Fully client-side. Reads the GDPR .zip, parses the relevant CSVs,
   and builds browsable views of movie & TV data.

   Data is intentionally drawn from MANY source files (not one). See
   SOURCES below and buildModel() for exactly which file feeds what.
   =================================================================== */

'use strict';

/* -------------------------------------------------------------------
   Small utilities
   ------------------------------------------------------------------- */
const $  = (sel, el = document) => el.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
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

const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const nonEmpty = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const truncate = (s, n) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function parseDate(s) {
  if (!s) return null;
  // "2024-04-14 19:26:37"  or ISO
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const m2 = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
const fmtDate = (d) => d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtInt = (n) => (n || 0).toLocaleString();

function fmtDuration(seconds) {
  seconds = Math.round(toNum(seconds));
  if (!seconds) return '0m';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

/* -------------------------------------------------------------------
   Reaction decoding — static, offline (no API needed).
   TV Time reused numeric ids across ~10 versioned "sets" over the years, so an id's
   meaning depends on whether it's a RATING (ratings-* vote files) or an EMOTION
   (emotions-* / episode_emotion). These tables were captured from TV Time's own
   emotion/rating set catalogs (msapi.tvtime.com/live/v1/{emotions,ratings}/sets/…).
   ------------------------------------------------------------------- */

// Ratings: one 5-level star scale, shared by episodes, movies AND shows. Different app
// eras used different ids for the same level (anchored by TV Time's stable `old_id`:
// old7=bad, old6=meh, old8=okay, old1=good, old3=wow).  id -> [stars 1-5, label]
const RATING_LABELS = {
  1: [1, 'Bad'],  16: [1, 'Bad'],
  2: [2, 'Meh'],  17: [2, 'Meh'],  27: [2, 'Meh'],
  4: [3, 'Okay'], 18: [3, 'Okay'], 28: [3, 'Okay'],
  5: [4, 'Good'], 19: [4, 'Good'], 29: [4, 'Good'],
  3: [5, 'Wow'],  20: [5, 'Wow'],
};

// Emotions: the modern "How did you feel?" 12-set (ids 28-39) plus the older
// emoji-grid reactions (ids 2-27) that predate it.  id -> [emoji, label]
const EMOTION_LABELS = {
  28: ['😵', 'Shocked'], 29: ['😤', 'Frustrated'], 30: ['😭', 'Sad'],       31: ['🤔', 'Reflective'],
  32: ['🥺', 'Touched'], 33: ['😆', 'Amused'],     34: ['😱', 'Scared'],    35: ['😑', 'Bored'],
  36: ['😌', 'Understood'], 37: ['🤩', 'Thrilled'], 38: ['🙃', 'Confused'], 39: ['😬', 'Tense'],
  // legacy emoji-grid reactions (custom / android / native grids)
  2: ['😠', 'Angry'],    4: ['😑', 'Bored'],    5: ['🙃', 'Confused'],  6: ['🤩', 'Excited'],
  7: ['😀', 'Happy'],    10: ['😭', 'Sad'],     11: ['😱', 'Scared'],   12: ['😵', 'Shocked'],
  13: ['😀', 'Happy'],   14: ['🙃', 'Confused'], 15: ['😭', 'Sad'],     16: ['😱', 'Scared'],
  17: ['😠', 'Angry'],   18: ['😵', 'Shocked'],  19: ['🤩', 'Excited'], 20: ['😑', 'Bored'],
  21: ['🙃', 'Confusing'], 22: ['😱', 'Scary'], 23: ['😤', 'Frustrating'], 24: ['😵', 'Shocking'],
  25: ['🤩', 'Exciting'], 26: ['😑', 'Boring'], 27: ['😤', 'Frustrated'],
};

const STARS = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

// Is this reaction a star rating (vs an emotion)? Decided by its source file.
const isRatingSource = (source = '') => /^ratings/.test(source);
function reactionChipText(id, source = '') {
  if (id == null) return null;
  if (isRatingSource(source)) {
    const r = RATING_LABELS[id];
    return r ? `${STARS(r[0])} ${r[1]}` : `rating #${id}`;
  }
  const e = EMOTION_LABELS[id];
  return e ? `${e[0]} ${e[1]}` : `reaction #${id}`;
}
// vote_key is "<entityId>-<userId>-<reactionId>"; take the segment after the user id.
function reactionIdFromKey(key, uid) {
  const p = String(key || '').split('-');
  const i = p.lastIndexOf(String(uid));
  const seg = (i >= 0 && i + 1 < p.length) ? p[i + 1] : p[p.length - 1];
  return /^\d+$/.test(seg) ? Number(seg) : null;
}

/* -------------------------------------------------------------------
   Local persistence of the loaded archive via IndexedDB (never uploaded).
   Stores the original .zip blob so it can be re-parsed on the next visit.
   ------------------------------------------------------------------- */
const IDB = {
  DB: 'tvt-archive', STORE: 'files', KEY: 'archive',
  _open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(this.DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(this.STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  },
  async put(blob, name) {
    try {
      const db = await this._open();
      await new Promise((res, rej) => { const tx = db.transaction(this.STORE, 'readwrite'); tx.objectStore(this.STORE).put({ blob, name }, this.KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (e) { console.warn('IDB put failed', e); }
  },
  async get() {
    try {
      const db = await this._open();
      return await new Promise((res, rej) => { const tx = db.transaction(this.STORE, 'readonly'); const r = tx.objectStore(this.STORE).get(this.KEY); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
    } catch { return null; }
  },
  async clear() {
    try {
      const db = await this._open();
      await new Promise((res) => { const tx = db.transaction(this.STORE, 'readwrite'); tx.objectStore(this.STORE).delete(this.KEY); tx.oncomplete = res; tx.onerror = res; });
    } catch {}
  },
};

/* -------------------------------------------------------------------
   Backup store — the imported "extended backup" (comment images, avatars, badge art,
   character posters, friend avatars + resolved names). Images live on TV Time's CDN
   (no CORS) and names behind ids, so extended-backup.py (repo root) harvests them into one
   foldered zip; this store holds that zip's image blobs locally (keyed by
   "<folder>/<name>") plus the names JSON (in localStorage). Blobs load into object
   URLs at startup so rendering stays synchronous.
   ------------------------------------------------------------------- */
const Backup = {
  DB: 'tvt-images', STORE: 'memes',
  urls: new Map(),   // memeId(string) -> object URL
  _open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(this.DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(this.STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  },
  async init() {
    try {
      const db = await this._open();
      const [blobs, keys] = await new Promise((res, rej) => {
        const tx = db.transaction(this.STORE, 'readonly'); const os = tx.objectStore(this.STORE);
        const gv = os.getAll(); const gk = os.getAllKeys();
        tx.oncomplete = () => res([gv.result || [], gk.result || []]);
        tx.onerror = () => rej(tx.error);
      });
      this.urls.forEach(u => URL.revokeObjectURL(u)); this.urls.clear();
      keys.forEach((k, i) => { if (blobs[i]) this.urls.set(String(k), URL.createObjectURL(blobs[i])); });
    } catch (e) { console.warn('Backup init failed', e); }
  },
  async importZip(file) {
    const zip = await JSZip.loadAsync(file);
    const all = Object.values(zip.files).filter(f => !f.dir);
    const images = all.filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f.name));
    const metas = all.filter(f => /(^|\/)(characters|friends)\.json$/i.test(f.name));
    if (!images.length && !metas.length) throw new Error('No backup data found in that zip.');
    const db = await this._open();
    let n = 0;
    for (const entry of images) {
      // Key by folder-namespaced path minus extension, e.g. "comments/450347-marked",
      // "avatars/123", "characters/63315360". Old flat zips key without a folder.
      const key = entry.name.replace(/^\.?\//, '').replace(/\.[^./]+$/, '');
      if (!key) continue;
      const blob = await entry.async('blob');
      await new Promise((res, rej) => { const tx = db.transaction(this.STORE, 'readwrite'); tx.objectStore(this.STORE).put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      n++;
    }
    // Resolved names (characters.json / friends.json) — kept in localStorage.
    for (const entry of metas) {
      const base = entry.name.split('/').pop().replace(/\.json$/i, '');   // 'characters' | 'friends'
      try { localStorage.setItem('tvt.' + base, await entry.async('string')); n++; } catch {}
    }
    await this.init();
    return n;
  },
  async clear() {
    try {
      const db = await this._open();
      await new Promise((res) => { const tx = db.transaction(this.STORE, 'readwrite'); tx.objectStore(this.STORE).clear(); tx.oncomplete = res; tx.onerror = res; });
    } catch {}
    try { localStorage.removeItem('tvt.characters'); localStorage.removeItem('tvt.friends'); } catch {}
    const n = this.urls.size;
    this.urls.forEach(u => URL.revokeObjectURL(u)); this.urls.clear();
    return n;
  },
  // Total backed-up files (comments + avatars + badges).
  count() { return this.urls.size; },
  // Distinct comment images (a meme has both a -clean and -marked file; supports both
  // the new "comments/<id>-…" layout and older flat "<id>-…" zips).
  countComments() {
    const ids = new Set();
    for (const k of this.urls.keys()) {
      if (k.startsWith('comments/')) ids.add(k.slice(9).replace(/-(clean|marked)$/, ''));
      else if (!k.includes('/')) ids.add(k.replace(/-(clean|marked)$/, ''));
    }
    return ids.size;
  },
  urlFor(id) { return this.urls.get(String(id)) || null; },
};

/* -------------------------------------------------------------------
   Extended-backup names (characters + friends) resolved by extended-backup.py and
   kept in localStorage. Loaded at startup and refreshed on import.
   ------------------------------------------------------------------- */
const Extended = {
  characters: {},   // show_character_id -> { id, name, actor_name, poster, votes }
  friends: {},      // friend_id -> { id, name, username, avatar }
  load() {
    this.characters = {}; this.friends = {};
    try { for (const c of JSON.parse(localStorage.getItem('tvt.characters') || '[]')) this.characters[String(c.id)] = c; } catch {}
    try { for (const f of JSON.parse(localStorage.getItem('tvt.friends') || '[]')) this.friends[String(f.id)] = f; } catch {}
  },
};

// Inline "image unavailable" placeholder — shown when an image is neither backed
// up locally nor reachable on the (possibly retired) server.
const BROKEN_IMG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">' +
  '<rect width="320" height="180" rx="10" fill="#241c15"/>' +
  '<rect x="1" y="1" width="318" height="178" rx="9" fill="none" stroke="#2f261e"/>' +
  '<g fill="none" stroke="#6f6456" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="120" y="62" width="80" height="60" rx="6"/>' +
  '<path d="M120 104 l20 -18 l16 14 l18 -20 l26 24"/>' +
  '<circle cx="146" cy="82" r="6"/>' +
  '<path d="M112 54 l96 76" stroke="#8a5040"/>' +
  '</g>' +
  '<text x="160" y="150" text-anchor="middle" font-family="Instrument Sans, Helvetica, Arial, sans-serif" font-size="14" fill="#a89e92">Image unavailable</text>' +
  '</svg>'
);

// Full-image overlay. Closes on click, Esc, OR the device Back gesture/button — opening
// pushes a history entry, so all three routes funnel through popstate (see initLanding).
let activeLightbox = null;
function openLightbox(src) {
  if (activeLightbox) return;
  const img = el('img', { src, alt: '' });
  const overlay = el('div', { class: 'lightbox' }, [img]);
  const onKey = (e) => { if (e.key === 'Escape') history.back(); };
  const remove = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  overlay.addEventListener('click', () => history.back());   // -> popstate -> close
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  history.pushState({ lightbox: true }, '');
  activeLightbox = remove;
}

// A circular user avatar. Prefers a local backup (by full key, e.g. "avatars/<id>" or
// "friends/<id>"), then the live CloudFront picture, then initials.
function avatarEl(url, name, backupKey, cls) {
  const wrap = el('span', { class: 'avatar' + (cls ? ' ' + cls : '') });
  const local = backupKey ? Backup.urlFor(backupKey) : null;
  const src = local || (url || '').trim();
  const fallback = () => wrap.append(el('span', { class: 'avatar-fallback', text: (name || '').trim().slice(0, 1).toUpperCase() || '?' }));
  if (src) {
    const img = el('img', { src, alt: name ? `${name} avatar` : '', loading: 'lazy' });
    if (!local) img.addEventListener('error', () => { img.remove(); if (!wrap.querySelector('.avatar-fallback')) fallback(); });
    wrap.append(img);
  } else {
    fallback();
  }
  return wrap;
}

// A plain <img> that tries a local backup (by key) then a live URL, then a placeholder.
// Same local-then-live rule as everything else; used for badge art, posters, etc.
function resilientImg(backupKey, liveUrl, opts = {}) {
  const local = backupKey ? Backup.urlFor(backupKey) : null;
  const url = (liveUrl || '').trim();
  const img = el('img', { src: local || url || BROKEN_IMG, loading: 'lazy', alt: opts.alt || '', class: opts.class || '' });
  if (!local) {
    if (!url) img.classList.add('broken');
    else img.addEventListener('error', () => { if (img.src !== BROKEN_IMG) { img.src = BROKEN_IMG; img.classList.add('broken'); } });
  }
  return img;
}

// Resolve a notification's image to a { key, url } — the backup key (folder-namespaced)
// and the live URL. The task-4 backup script mirrors this so local copies line up.
function notifImageRef(r) {
  const url = (r.image || '').trim();
  if (!url) return null;
  const av = url.match(/\/user\/(\d+)\/profile_picture/);
  if (av) return { key: 'avatars/' + av[1], url, kind: 'avatar' };
  if (r.type === 'badge-unlocked') {
    const b = (r.url || '').match(/badge_id=([^&]+)/);
    return { key: b ? 'badges/' + b[1] : null, url, kind: 'badge' };
  }
  return { key: null, url, kind: 'other' };   // show posters etc. — live-only for now
}

// A sized image box (poster / thumbnail / cover) that opens full-size on click.
// `cls` sizes the frame; `src` is the thumbnail; `fullSrc` (optional) is the higher-res
// image shown in the lightbox. With no src it's an empty placeholder of that shape.
function zoomImg(cls, src, alt, fullSrc) {
  if (!src) return el('div', { class: cls });
  const img = el('img', { src, loading: 'lazy', alt: alt || '' });
  return el('button', {
    class: cls + ' img-zoom', title: 'View image',
    onclick: (e) => { e.stopPropagation(); openLightbox(fullSrc || img.currentSrc || img.src); },
  }, [img]);
}

/* -------------------------------------------------------------------
   Global loading indicator — the top bar animates while any async
   work (currently TVmaze fetches) is in flight.
   ------------------------------------------------------------------- */
const Progress = {
  total: 0, done: 0,
  refs() {
    if (!this._bar) {
      this._bar = document.getElementById('loadbar');
      this._fill = this._bar && this._bar.querySelector('.loadbar-fill');
      this._pill = document.getElementById('loadpill');
    }
  },
  start() { this.total++; this.sync(); },
  finish() { this.done++; this.sync(); },
  sync() {
    this.refs();
    const active = this.done < this.total;
    if (this._bar) this._bar.classList.toggle('active', active);
    if (this._fill) this._fill.style.width = (this.total ? Math.round(this.done / this.total * 100) : 0) + '%';
    if (this._pill) {
      this._pill.hidden = !active;
      if (active) this._pill.textContent = `Loading ${this.done} of ${this.total}…`;
    }
    if (!active) { this.total = 0; this.done = 0; if (this._fill) requestAnimationFrame(() => { this._fill.style.width = '0%'; }); }
  },
};

/* -------------------------------------------------------------------
   TVmaze episode-title enrichment.
   Keyless, CORS-enabled public API. Opt-in (it sends a show id/name to
   TVmaze). Resolves a show by its TheTVDB id (falling back to a name
   search), fetches its episode list once, and caches the season/episode →
   title map in localStorage so repeat views are instant and offline.
   ------------------------------------------------------------------- */
const Enrichment = {
  enabled: false,
  mem: new Map(),        // key -> { e:{"s|e":name}, n:showName, f:failed }
  inflight: new Map(),   // key -> Promise
  POOL: 4,

  keyFor(seriesId, title) { return seriesId ? 't' + seriesId : 'n:' + norm(title); },
  lsKey(key) { return 'tvt.mz.' + key; },

  getCached(key) {
    if (this.mem.has(key)) return this.mem.get(key);
    try { const raw = localStorage.getItem(this.lsKey(key)); if (raw) { const v = JSON.parse(raw); this.mem.set(key, v); return v; } } catch {}
    return null;
  },
  store(key, val) {
    this.mem.set(key, val);
    try { localStorage.setItem(this.lsKey(key), JSON.stringify(val)); } catch {}
  },

  seriesIdByName: {},   // norm(title) -> TheTVDB id, so name-only views can resolve the cache
  resolveKey(title, seriesId) {
    const sid = seriesId || this.seriesIdByName[norm(title)] || '';
    return this.keyFor(sid, title);
  },
  epInfo(title, seriesId, season, episode) {
    if (!this.enabled) return null;
    const v = this.getCached(this.resolveKey(title, seriesId));
    if (!v) return null;
    const k = `${season}|${episode}`;
    const image = (v.i && v.i[k]) || null;
    return { name: (v.e && v.e[k]) || null, image, imageFull: (v.iO && v.iO[k]) || image };
  },
  titleFor(ev) { const i = this.epInfo(ev.title, ev.seriesId, ev.season, ev.episode); return i && i.name; },
  imageFor(ev) { const i = this.epInfo(ev.title, ev.seriesId, ev.season, ev.episode); return i && i.image; },
  posterFor(title, seriesId) {
    if (!this.enabled) return null;
    const v = this.getCached(this.resolveKey(title, seriesId));
    return (v && v.img) || null;
  },
  posterFullFor(title, seriesId) {
    if (!this.enabled) return null;
    const v = this.getCached(this.resolveKey(title, seriesId));
    return (v && (v.imgO || v.img)) || null;
  },

  // Does a cache entry already satisfy this need? (full needs episodes, light needs only the show/poster)
  needsFetch(key, full) {
    const v = this.getCached(key);
    if (!v) return true;
    if (v.f) return false;          // known-failed: don't retry
    if (full && !v.full) return true;  // have light (poster only), need episodes -> upgrade
    return false;
  },

  // full=false -> resolve the show only (poster). full=true -> also fetch the episode list.
  async fetchOne(seriesId, title, full) {
    const key = this.keyFor(seriesId, title);
    let show = null;
    if (seriesId) {
      try { const r = await fetch(`https://api.tvmaze.com/lookup/shows?thetvdb=${encodeURIComponent(seriesId)}`); if (r.ok) show = await r.json(); } catch {}
    }
    if (!show && title) {
      try { const r = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`); if (r.ok) show = await r.json(); } catch {}
    }
    if (!show || !show.id) { this.store(key, { e: {}, f: true, full: true }); return; }
    // Keep both sizes: medium for thumbnails, original (full-res) for zoom.
    const img = show.image ? (show.image.medium || show.image.original || null) : null;   // poster comes free
    const imgO = show.image ? (show.image.original || show.image.medium || null) : null;
    if (!full) { this.store(key, { img, imgO, n: show.name }); return; }   // light: poster only
    let eps = [];
    try { const r = await fetch(`https://api.tvmaze.com/shows/${show.id}/episodes`); if (r.ok) eps = await r.json(); } catch {}
    const e = {}, i = {}, iO = {};   // titles + episode thumbnails (medium + original), keyed by "season|number"
    for (const ep of eps) {
      const kk = `${ep.season}|${ep.number}`;
      e[kk] = ep.name;
      if (ep.image) { i[kk] = ep.image.medium || ep.image.original || null; iO[kk] = ep.image.original || ep.image.medium || null; }
    }
    this.store(key, { e, i, iO, img, imgO, n: show.name, full: true });
  },

  forget(key) { this.mem.delete(key); this.inflight.delete(key); try { localStorage.removeItem(this.lsKey(key)); } catch {} },

  // Ensure a batch of {seriesId,title} is fetched at the requested level. Resolves to number newly fetched.
  async ensure(items, full = false) {
    const need = [];
    const seen = new Set();
    for (const it of items) {
      const key = this.keyFor(it.seriesId, it.title);
      if (seen.has(key) || !this.needsFetch(key, full)) continue;
      seen.add(key); need.push(it);
    }
    if (!need.length) return 0;
    let i = 0;
    const worker = async () => {
      while (i < need.length) {
        const it = need[i++];
        const key = this.keyFor(it.seriesId, it.title);
        if (!this.needsFetch(key, full)) continue;
        let p = this.inflight.get(key);
        if (!p) {
          Progress.start();
          p = this.fetchOne(it.seriesId, it.title, full).finally(() => { this.inflight.delete(key); Progress.finish(); });
          this.inflight.set(key, p);
        }
        await p;
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.POOL, need.length) }, worker));
    return need.length;
  },

  // Remove every cached TVmaze episode map (localStorage + memory). Returns count cleared.
  clearCache() {
    let n = 0;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('tvt.mz')) { localStorage.removeItem(k); n++; }
    } catch {}
    this.mem.clear();
    this.inflight.clear();
    return n;
  },
};

/* -------------------------------------------------------------------
   Movie metadata enrichment via Wikidata (keyless, CORS-enabled).
   Resolves a (often localized) movie_name to an English title. Only
   accepts a match that is instance-of a film type AND carries an
   external id (TMDB/IMDb) — that "id match" guard cuts false hits.
   Wikidata has no film posters, so this is title-only. Separate opt-in
   setting and cache from the TVmaze show enrichment.
   ------------------------------------------------------------------- */
const FILM_P31 = new Set(['Q11424', 'Q24856', 'Q202866', 'Q29168811', 'Q506240', 'Q24862', 'Q20650540', 'Q24869', 'Q130232', 'Q17517379', 'Q842256', 'Q59755569', 'Q18011172', 'Q353834', 'Q157443', 'Q1054574']);
const WD = 'https://www.wikidata.org/w/api.php?format=json&origin=*&';

const MovieMeta = {
  enabled: false,
  mem: new Map(),
  inflight: new Map(),
  POOL: 3,

  keyFor(title) { return norm(title); },
  lsKey(key) { return 'tvt.wd.' + key; },
  getCached(key) {
    if (this.mem.has(key)) return this.mem.get(key);
    try { const raw = localStorage.getItem(this.lsKey(key)); if (raw) { const v = JSON.parse(raw); this.mem.set(key, v); return v; } } catch {}
    return null;
  },
  store(key, val) { this.mem.set(key, val); try { localStorage.setItem(this.lsKey(key), JSON.stringify(val)); } catch {} },

  // English title for a movie, or null if disabled / unresolved.
  titleFor(title) {
    if (!this.enabled) return null;
    const v = this.getCached(this.keyFor(title));
    return v && !v.f ? (v.en || null) : null;
  },

  async wdJson(params) {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(WD + params);
        if (r.status === 429) { await new Promise(res => setTimeout(res, 800 * (a + 1))); continue; }
        if (r.ok) return await r.json();
        return null;
      } catch { return null; }
    }
    return null;
  },
  async fetchOne(title) {
    const key = this.keyFor(title);
    // CirrusSearch: language-agnostic full-text over labels/aliases in every language.
    const s = await this.wdJson('action=query&list=search&srnamespace=0&srlimit=6&srsearch=' + encodeURIComponent(title));
    const hits = ((s && s.query && s.query.search) || []).map(h => h.title);
    if (!hits.length) { this.store(key, { f: true }); return; }
    const g = await this.wdJson('action=wbgetentities&props=labels|claims&ids=' + hits.join('|'));
    const ents = (g && g.entities) || {};
    const val = (cs) => cs && cs[0] && cs[0].mainsnak && cs[0].mainsnak.datavalue && cs[0].mainsnak.datavalue.value;
    let out = null;
    for (const qid of hits) {  // relevance order; take first confident film match
      const claims = (ents[qid] || {}).claims || {};
      const p31 = (claims.P31 || []).map(x => x.mainsnak && x.mainsnak.datavalue && x.mainsnak.datavalue.value && x.mainsnak.datavalue.value.id);
      if (!p31.some(p => FILM_P31.has(p))) continue;
      const tmdb = val(claims.P4947) || null, imdb = val(claims.P345) || null;
      const en = (ents[qid].labels && ents[qid].labels.en && ents[qid].labels.en.value) || null;
      if (en && (tmdb || imdb)) { out = { en, tmdb, imdb }; break; }   // film + external id = confident
    }
    this.store(key, out || { f: true });
  },

  async ensure(titles) {
    const need = [], seen = new Set();
    for (const t of titles) {
      const key = this.keyFor(t);
      if (!t || seen.has(key) || this.getCached(key)) continue;
      seen.add(key); need.push(t);
    }
    if (!need.length) return 0;
    let i = 0;
    const worker = async () => {
      while (i < need.length) {
        const t = need[i++]; const key = this.keyFor(t);
        if (this.getCached(key)) continue;
        let p = this.inflight.get(key);
        if (!p) { Progress.start(); p = this.fetchOne(t).finally(() => { this.inflight.delete(key); Progress.finish(); }); this.inflight.set(key, p); }
        await p;
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.POOL, need.length) }, worker));
    return need.length;
  },

  clearCache() {
    let n = 0;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('tvt.wd.')) { localStorage.removeItem(k); n++; } } catch {}
    this.mem.clear(); this.inflight.clear();
    return n;
  },
};

// Display title for a movie: English (Wikidata) if resolved, else the stored name.
const movieTitle = (title) => MovieMeta.titleFor(title) || title;

/* -------------------------------------------------------------------
   Global state
   ------------------------------------------------------------------- */
const STATE = {
  tables: {},   // filename -> { fields:[], rows:[] }
  model: null,  // derived, curated datasets
  view: 'home',
  listState: {},      // stateKey -> { q, sort, page } preserved across navigation
  pendingScroll: null,// { key, y } — restore scroll once when a list re-renders
};

/* -------------------------------------------------------------------
   Load & parse the zip
   ------------------------------------------------------------------- */
async function loadArchive(file, opts = {}) {
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

function showLoading(msg) {
  $('#landingError').hidden = true;
  $('#loadingBar').hidden = false;
  $('#loadingText').textContent = msg;
}
function fail(msg) {
  $('#loadingBar').hidden = true;
  showChooser();   // reveal the dropzone so the user can pick a file
  const e = $('#landingError');
  e.textContent = msg; e.hidden = false;
  return false;
}
function showChooser() {
  $('#chooser').hidden = false;
  $('#loadingBar').hidden = true;
}

/* helper to read a table safely */
const T = (name) => (STATE.tables[name] || { fields: [], rows: [] }).rows;
const has = (name) => !!STATE.tables[name];

/* ===================================================================
   MODEL BUILDING — the heart of the app.
   Each section names the source CSV(s) it consumes.
   =================================================================== */
function buildModel(tables) {
  const m = {};

  /* ---- Profile: user.csv + user_personal_data.csv + user_tv_show_data.csv ---- */
  m.profile = buildProfile();

  /* ---- History: v2 watch/rewatch episodes + movie watches + rewatched_episode.
     Built early so ratings can borrow watch dates (the ratings files carry none). ---- */
  m.history = buildHistory();

  /* ---- Ratings: the 5-level star scale for shows (tv_show_rate) + episodes/movies
     (ratings-* vote files). Decoded via RATING_LABELS. See buildRatings(). ---- */
  m.ratings = buildRatings(m.history);

  /* ---- Reactions: the "how did you feel?" emotions only (emotions-* + episode_emotion);
     star ratings are handled by buildRatings(). ---- */
  m.reactions = buildReactions(m.history);

  /* ---- Per-show reaction totals: tv_show_user_emotion_count.csv ---- */
  m.emotionPerShow = buildEmotionPerShow();

  /* ---- Shows: followed_tv_show + v2 user-series + ratings + reactions + addiction + seen ---- */
  m.shows = buildShows(m.ratings, m.reactions, m.emotionPerShow, m.history);

  /* ---- Movies: tracking-prod-records(entity=movie) + ratings + reaction votes ---- */
  m.movies = buildMovies(m.reactions, m.ratings, m.history);

  /* ---- Lists: lists-prod-lists.csv (collection + per-list items, titles resolved) ---- */
  m.lists = buildLists();

  /* ---- Comments: your posts across episode/show/movie/profile comment tables,
     with attached images (meme.csv) and reply threading where recoverable ---- */
  m.comments = buildComments(m.shows);

  /* ---- Notifications: read-only activity feed (likes, replies, mentions, follows,
     badges, airing reminders) from notifications-prod-notifications.csv ---- */
  m.notifications = buildNotifications();

  /* ---- Badges: user_badge.csv, grouped by badge type with art from notifications ---- */
  m.badges = buildBadges();

  /* ---- Characters & Friends: ids from the export, names/images from the extended backup ---- */
  m.characters = buildCharacters();
  m.friends = buildFriends();

  /* ---- Stats: stats-prod-cache.csv (marathons, per-month charts) ---- */
  m.stats = buildStats();

  /* ---- Overview headline stats: tracking-stats row + counts across sources ---- */
  m.overview = buildOverview(m);

  return m;
}

/* ---------------- Profile ---------------- */
function buildProfile() {
  const u = T('user.csv')[0] || {};
  const personal = {};
  for (const r of T('user_personal_data.csv')) if (r.name) personal[r.name] = r.value;
  const tvd = {};
  for (const r of T('user_tv_show_data.csv')) if (r.name) tvd[r.name] = r.value;

  // user.csv `name` is often just the numeric user id — treat that as "no real name".
  const rawName = (u.name || '').trim();
  const realName = (rawName && rawName !== u.id && !/^\d+$/.test(rawName)) ? rawName : '';
  const routing = T('routing-prod-users.csv')[0] || {};
  const username = (routing.username || (T('auth-prod-login.csv').find(r => r.username) || {}).username || '').trim();
  // Greeting: real name, else username (no @), else nothing.
  const displayName = realName || username;

  return {
    name: realName || '—',
    username,
    displayName,
    avatar: (routing.image_url || '').trim(),      // profile picture (CloudFront)
    userId: (routing.user_id || u.id || '').trim(),
    email: u.mail || personal.email || '—',
    language: u.language || '—',
    timezone: u.timezone || '—',
    createdAt: parseDate(u.created_at),
    lastOpened: parseDate(u.last_opened),
    daysActive: u.nb_days_active,
    weeksActive: u.nb_weeks_active,
    monthsActive: u.nb_months_active,
    raw: u, personal, tvShowData: tvd,
  };
}

/* ---------------- Show star ratings ----------------
   tv_show_rate.csv — the only genuine numeric rating (1–5 scale). */
/* ---------------- Ratings ----------------
   The 5-level star rating (Bad/Meh/Okay/Good/Wow) the user gave — the SAME scale for
   shows, movies and episodes. Show-level from tv_show_rate.csv; episode/movie from the
   ratings-* vote files (id decoded via RATING_LABELS, scoped to rating sources). One
   rating per entity — the export keeps historical clicks, so on conflict keep highest. */
const LEVEL_LABEL = [null, 'Bad', 'Meh', 'Okay', 'Good', 'Wow'];
// episode_emotion.csv is TV Time's OLD combined table — it stores the rating in the
// same emotion_id field, using the original id scheme (old7=bad … old3=wow). Ids that
// aren't emotions are these ratings. id -> [stars, label].
const OLD_EMOTION_RATING = { 7: [1, 'Bad'], 6: [2, 'Meh'], 8: [3, 'Okay'], 1: [4, 'Good'], 3: [5, 'Wow'] };

// Latest watch date per episode / movie — used as the "rated/reacted on" proxy since
// the vote files carry no timestamp of their own.
function watchDates(history) {
  const ep = {}, mv = {};
  for (const e of history || []) {
    if (!e.date) continue;
    if (e.type === 'episode') { const k = `${norm(e.title)}|${e.season}|${e.episode}`; if (!ep[k] || e.date > ep[k]) ep[k] = e.date; }
    else if (e.type === 'movie') { const k = norm(e.title); if (!mv[k] || e.date > mv[k]) mv[k] = e.date; }
  }
  return { ep, mv };
}

function buildRatings(history) {
  const shows = {}, movies = {}, eps = {};   // keyed lookups; value = { stars, label, ... }
  const put = (bucket, k, meta) => { if (!bucket[k] || meta.stars > bucket[k].stars) bucket[k] = meta; };
  const { ep: epWatch, mv: movieWatch } = watchDates(history);

  const ratingFiles = ['ratings-3-prod-episode_votes.csv', 'ratings-prod-episode_votes.csv', 'ratings-live-votes.csv', 'ratings-v2-prod-votes.csv'];
  for (const f of ratingFiles) {
    for (const r of T(f)) {
      const rl = RATING_LABELS[reactionIdFromKey(r.vote_key, r.user_id)];
      if (!rl) continue;
      const base = { stars: rl[0], label: rl[1] };
      if (r.movie_name) put(movies, norm(r.movie_name), { ...base, kind: 'movie', title: r.movie_name, date: movieWatch[norm(r.movie_name)] || null });
      else if (r.series_name) { const k = `${norm(r.series_name)}|${r.season_number || ''}|${r.episode_number || ''}`;
        put(eps, k, { ...base, kind: 'episode', title: r.series_name, season: r.season_number || '', episode: r.episode_number || '', date: epWatch[k] || null }); }
    }
  }
  // Old show-level 1–5 star rating (this one has a real timestamp).
  for (const r of T('tv_show_rate.csv')) {
    if (!r.tv_show_name) continue;
    const stars = Math.max(1, Math.min(5, Math.round(toNum(r.rating))));
    put(shows, norm(r.tv_show_name), { kind: 'show', title: r.tv_show_name, stars, label: LEVEL_LABEL[stars] || '', date: parseDate(r.created_at) });
  }
  // Ratings hidden in the old episode_emotion table (ids that aren't emotions).
  for (const r of T('episode_emotion.csv')) {
    if (!r.tv_show_name) continue;
    const id = toNum(r.emotion_id) || null;
    if (EMOTION_LABELS[id]) continue;          // it's a feeling → handled by buildReactions
    const rl = OLD_EMOTION_RATING[id]; if (!rl) continue;
    const k = `${norm(r.tv_show_name)}|${r.episode_season_number || ''}|${r.episode_number || ''}`;
    put(eps, k, { stars: rl[0], label: rl[1], kind: 'episode', title: r.tv_show_name, season: r.episode_season_number || '', episode: r.episode_number || '', date: parseDate(r.created_at) || epWatch[k] || null });
  }

  const list = [...Object.values(shows), ...Object.values(movies), ...Object.values(eps)]
    .sort((a, b) => b.stars - a.stars || a.title.localeCompare(b.title));
  return { list, epByKey: eps, movieByTitle: movies, showByTitle: shows };
}

/* ---------------- Reactions (emotions) ----------------
   The "how did you feel?" emotions — feelings only (star ratings live in buildRatings).
   Sources: emotions-3/v2 votes, emotions-live (movies), episode_emotion. */
function buildReactions(history) {
  const list = [];
  for (const f of ['emotions-3-prod-episode_votes.csv', 'emotions-v2-prod-votes.csv']) {
    for (const r of T(f)) {
      const title = r.series_name || r.movie_name;
      if (!title) continue;
      list.push({ kind: r.movie_name ? 'movie' : 'episode', title, season: r.season_number || '', episode: r.episode_number || '',
        reactionId: reactionIdFromKey(r.vote_key, r.user_id), date: null, source: f.replace('.csv', '') });
    }
  }
  for (const r of T('emotions-live-votes.csv')) {
    if (!r.movie_name) continue;
    list.push({ kind: 'movie', title: r.movie_name, season: '', episode: '', reactionId: reactionIdFromKey(r.vote_key, r.user_id), date: null, source: 'emotions-live' });
  }
  for (const r of T('episode_emotion.csv')) {
    if (!r.tv_show_name) continue;
    const id = toNum(r.emotion_id) || null;
    if (!EMOTION_LABELS[id]) continue;   // ids that aren't feelings are old ratings → buildRatings
    list.push({ kind: 'episode', title: r.tv_show_name, season: r.episode_season_number || '', episode: r.episode_number || '', reactionId: id, date: parseDate(r.created_at), source: 'episode_emotion' });
  }

  // The emotion vote files carry no timestamp; borrow the latest watch date as a proxy
  // (a reaction is left right after watching). episode_emotion keeps its real date.
  const { ep: epWatch, mv: movieWatch } = watchDates(history);
  for (const r of list) {
    if (r.date) continue;
    r.date = (r.kind === 'movie' ? movieWatch[norm(r.title)] : epWatch[`${norm(r.title)}|${r.season}|${r.episode}`]) || null;
  }

  // Per-entity decoded-label lookups (Movie / Show detail) + a grouped view where each
  // episode/movie is one row carrying all its feeling chips.
  const epByKey = {}, movieByTitle = {}, countByTitle = {}, byEntity = {};
  for (const r of list) {
    countByTitle[norm(r.title)] = (countByTitle[norm(r.title)] || 0) + 1;
    const label = reactionChipText(r.reactionId, r.source);
    if (!label) continue;
    if (r.kind === 'movie') (movieByTitle[norm(r.title)] ||= new Set()).add(label);
    else (epByKey[`${norm(r.title)}|${r.season}|${r.episode}`] ||= new Set()).add(label);

    const key = r.kind === 'movie' ? `m|${norm(r.title)}` : `e|${norm(r.title)}|${r.season}|${r.episode}`;
    const g = byEntity[key] || (byEntity[key] = { kind: r.kind, title: r.title, season: r.season, episode: r.episode, reactions: [], _seen: new Set(), date: null });
    if (!g._seen.has(label)) { g._seen.add(label); g.reactions.push(label); }
    if (r.date && (!g.date || r.date > g.date)) g.date = r.date;
  }
  const grouped = Object.values(byEntity).map(g => { delete g._seen; return g; });
  return { list, grouped, countByTitle, epByKey, movieByTitle };
}

/* ---------------- Per-show reaction totals ----------------
   tv_show_user_emotion_count.csv — TV Time's own per-show reaction tally. */
function buildEmotionPerShow() {
  const perShow = {};
  for (const r of T('tv_show_user_emotion_count.csv')) {
    if (!r.tv_show_name) continue;
    perShow[norm(r.tv_show_name)] = (perShow[norm(r.tv_show_name)] || 0) + toNum(r.count);
  }
  return perShow;
}

/* ---------------- History (watch timeline) ----------------
   Episodes: tracking-prod-records-v2.csv  (key starts watch-episode / rewatch-episode)
   Movies:   tracking-prod-records.csv     (entity_type == movie, type == watch/rewatch)
   Extra rewatches: rewatched_episode.csv */
function buildHistory() {
  const events = [];

  for (const r of T('tracking-prod-records-v2.csv')) {
    const key = r.key || '';
    if (key.startsWith('watch-episode') || key.startsWith('rewatch-episode')) {
      const d = parseDate(r.created_at);
      events.push({
        date: d, ts: d ? d.getTime() : 0,
        type: 'episode',
        rewatch: key.startsWith('rewatch-episode'),
        title: r.series_name || '(unknown series)',
        seriesId: r.s_id || '',
        season: r.season_number, episode: r.episode_number,
        runtime: toNum(r.runtime),
      });
    }
  }

  for (const r of T('tracking-prod-records.csv')) {
    if (r.entity_type !== 'movie') continue;
    if (r.type !== 'watch' && r.type !== 'rewatch') continue;
    const d = parseDate(r.watch_date) || parseDate(r.created_at);
    events.push({
      date: d, ts: d ? d.getTime() : 0,
      type: 'movie',
      rewatch: r.type === 'rewatch',
      title: r.movie_name || '(unknown movie)',
      season: '', episode: '',
      runtime: toNum(r.runtime),
    });
  }

  events.sort((a, b) => b.ts - a.ts);
  return events;
}

/* ---------------- Shows ----------------
   Merge, keyed by normalized title:
     followed_tv_show.csv        -> follow status, folder, followed date
     tracking-prod-records-v2    -> per-series watch/rewatch counts, following flag
     tv_show_rate / ratings      -> rating
     tv_show_user_emotion_count  -> emotion count
     show_addiction_score.csv    -> engagement score
     seen_episode_source.csv     -> seen-episode count
   Watched-episode counts are also cross-checked against the history timeline. */
function buildShows(ratings, reactions, emotionPerShow, history) {
  const shows = {};
  const get = (title) => {
    const k = norm(title);
    return (shows[k] ||= { title, id: null, status: null, followedAt: null, epWatched: 0, rewatches: 0, rating: null, emotionCount: 0, addiction: 0, seenCount: 0, lastWatched: null, sources: new Set() });
  };

  // followed_tv_show.csv
  for (const r of T('followed_tv_show.csv')) {
    if (!r.tv_show_name) continue;
    const s = get(r.tv_show_name);
    s.id ||= r.tv_show_id;
    s.followedAt = parseDate(r.created_at);
    s.diffusion = r.diffusion;
    const archived = r.archived === '1' || r.archived === 'true';
    const active = r.active === '1' || r.active === 'true';
    s.status = archived ? 'archived' : (active ? 'following' : 'stopped');
    s.sources.add('followed_tv_show');
  }

  // tracking-prod-records-v2 user-series aggregates
  for (const r of T('tracking-prod-records-v2.csv')) {
    if (!(r.key || '').startsWith('user-series')) continue;
    if (!r.series_name) continue;
    const s = get(r.series_name);
    s.id ||= r.s_id;
    s.epWatched = Math.max(s.epWatched, toNum(r.ep_watch_count));
    s.rewatches += toNum(r.rewatch_count);
    if (r.is_followed === 'true' && !s.status) s.status = 'following';
    if (r.is_archived === 'true') s.status = 'archived';
    if (r.is_for_later === 'true') s.forLater = true;
    if (nonEmpty(r.followed_at) && !s.followedAt) s.followedAt = parseDate(r.followed_at);
    s.sources.add('tracking-v2');
  }

  // show-level star rating (tv_show_rate)
  for (const [k, r] of Object.entries(ratings.showByTitle)) if (shows[k]) shows[k].rating = r.stars;

  // per-show reaction totals (prefer TV Time's own tally, else count from reactions list)
  for (const [k, count] of Object.entries(emotionPerShow)) if (shows[k]) shows[k].emotionCount = count;
  for (const [k, count] of Object.entries(reactions.countByTitle)) if (shows[k]) shows[k].emotionCount = Math.max(shows[k].emotionCount, count);

  // addiction score
  for (const r of T('show_addiction_score.csv')) {
    if (!r.tv_show_name) continue;
    const s = shows[norm(r.tv_show_name)];
    if (s) s.addiction = Math.max(s.addiction, toNum(r.monthly_score), toNum(r.weekly_score));
  }

  // seen-episode counts
  for (const r of T('seen_episode_source.csv')) {
    if (!r.tv_show_name) continue;
    const s = shows[norm(r.tv_show_name)];
    if (s) s.seenCount++;
  }

  // last-watched from timeline + a watched-count fallback
  const watchedByShow = {};
  for (const ev of history) {
    if (ev.type !== 'episode') continue;
    const k = norm(ev.title);
    watchedByShow[k] = (watchedByShow[k] || 0) + 1;
    const s = shows[k];
    if (s && ev.ts && (!s.lastWatched || ev.ts > s.lastWatched.getTime())) s.lastWatched = ev.date;
  }
  for (const [k, s] of Object.entries(shows)) {
    if (!s.epWatched && watchedByShow[k]) s.epWatched = watchedByShow[k];
    s.sources = [...s.sources];
  }

  return Object.values(shows).sort((a, b) => (b.epWatched - a.epWatched) || a.title.localeCompare(b.title));
}

/* ---------------- Movies ----------------
   Source of truth: tracking-prod-records.csv (entity_type == movie).
   A movie's rows are grouped by uuid: follow row + watch row(s) + rewatch_count row.
   Reaction votes merged by normalized title (movies have no numeric star rating). */
function buildMovies(reactions, ratings, history) {
  const movies = {};
  const get = (title, uuid) => {
    const k = norm(title);
    return (movies[k] ||= { title, uuid, watched: false, watchCount: 0, rewatches: 0, runtime: 0, followedAt: null, watchedAt: null, watchDates: [], status: null, reacted: false, rating: null, reactions: [], sources: new Set() });
  };

  for (const r of T('tracking-prod-records.csv')) {
    if (r.entity_type !== 'movie') continue;
    const title = r.movie_name;
    if (!title) continue;
    const mv = get(title, r.uuid);
    mv.sources.add('tracking');
    if (nonEmpty(r.runtime)) mv.runtime = Math.max(mv.runtime, toNum(r.runtime));
    if (r.type === 'follow')  { mv.followedAt = parseDate(r.created_at); mv.status ||= 'watchlist'; }
    if (r.type === 'towatch') { mv.status = 'watchlist'; }
    if (r.type === 'watch')   { mv.watched = true; mv.status = 'watched'; mv.watchCount++; const d = parseDate(r.watch_date) || parseDate(r.created_at); if (d) { mv.watchDates.push(d); if (!mv.watchedAt || d > mv.watchedAt) mv.watchedAt = d; } }
    if (r.type === 'rewatch') { mv.watched = true; mv.rewatches++; const d = parseDate(r.watch_date) || parseDate(r.created_at); if (d) mv.watchDates.push(d); }
    if (r.type === 'rewatch_count') { mv.rewatches = Math.max(mv.rewatches, toNum(r.rewatch_count)); }
    if (nonEmpty(r.watch_count)) mv.watchCount = Math.max(mv.watchCount, toNum(r.watch_count));
  }

  // Surface movies that only appear as a reaction or rating, and flag/annotate the rest.
  for (const r of reactions.list.filter(r => r.kind === 'movie')) { get(r.title).reacted = true; get(r.title).sources.add('reactions'); }
  for (const [k, rt] of Object.entries(ratings.movieByTitle)) {
    if (!movies[k]) get(rt.title);
    movies[k].rating = rt; movies[k].sources.add('ratings');
  }
  // Decoded feeling labels per movie.
  for (const [k, set] of Object.entries(reactions.movieByTitle)) if (movies[k]) movies[k].reactions = [...set];
  for (const mv of Object.values(movies)) {
    if (mv.rating && !mv.status) mv.status = 'reacted';
    if (mv.reacted && !mv.status) mv.status = 'reacted';
  }

  for (const mv of Object.values(movies)) { mv.sources = [...mv.sources]; mv.watchDates.sort((a, b) => (a ? a.getTime() : 0) - (b ? b.getTime() : 0)); }
  return Object.values(movies).sort((a, b) => {
    const at = a.watchedAt ? a.watchedAt.getTime() : 0, bt = b.watchedAt ? b.watchedAt.getTime() : 0;
    return bt - at || a.title.localeCompare(b.title);
  });
}

/* ---------------- Lists ----------------
   lists-prod-lists.csv is a joinable structure, not one blob:
     - a `collection` row      -> list names + cover artwork (posters/fanart), keyed by s_key
     - per-list rows (by s_key) -> membership in `objects` (each item: id/uuid + type)
   We resolve every item id/uuid to a real title using id/uuid->name maps built
   from the rest of the export, then join collection metadata to its items. */
function buildLists() {
  const listRows = T('lists-prod-lists.csv');
  if (!listRows.length) return [];

  // id/uuid -> title, gathered across the export
  const id2name = {}, uuid2name = {};
  const addId = (i, n) => { if (i && n && !id2name[i]) id2name[i] = n; };
  const addUuid = (u, n) => { if (u && n && !uuid2name[u]) uuid2name[u] = n; };
  for (const r of T('followed_tv_show.csv')) addId(r.tv_show_id, r.tv_show_name);
  for (const r of T('show_seen_episode_latest.csv')) addId(r.tv_show_id, r.tv_show_name);
  for (const r of T('tv_show_rate.csv')) addId(r.tv_show_id, r.tv_show_name);
  for (const r of T('tracking-prod-records.csv')) {
    if (r.series_id) addId(r.series_id, r.series_name);
    if (r.series_uuid) addUuid(r.series_uuid, r.series_name);
    if (r.entity_type === 'movie' && r.uuid) addUuid(r.uuid, r.movie_name);
  }
  for (const r of T('tracking-prod-records-v2.csv')) {
    if (r.s_id) addId(r.s_id, r.series_name);
    if (r.uuid && r.series_name) addUuid(r.uuid, r.series_name);
  }

  // parse a flat objects list: "[map[id:.. type:.. uuid:.. created_at:..] ...]"
  const parseObjects = (s) => {
    const items = [];
    for (const b of (s.match(/map\[(.*?)\]/g) || [])) {
      const inner = b.slice(4, -1);
      const g = (k) => { const m = inner.match(new RegExp('(?:^| )' + k + ':(\\S+)')); return m ? m[1] : null; };
      const id = g('id'), uuid = g('uuid'), type = g('type');
      items.push({ id, uuid, type, title: (id && id2name[id]) || (uuid && uuid2name[uuid]) || null });
    }
    return items;
  };
  const itemsBySkey = {};
  for (const r of listRows) if (r.type === 'list' && r.objects) itemsBySkey[r.s_key] = parseObjects(r.objects);

  // split the collection blob into top-level map[...] blocks (they contain nested [ ] arrays)
  const topMaps = (s) => {
    const out = []; let i = 0;
    while (i < s.length) {
      const start = s.indexOf('map[', i);
      if (start < 0) break;
      let depth = 0, j = start + 3;
      for (; j < s.length; j++) { if (s[j] === '[') depth++; else if (s[j] === ']') { if (--depth === 0) { j++; break; } } }
      out.push(s.slice(start + 4, j - 1)); i = j;
    }
    return out;
  };
  const KEYS = 'order|posters|s_key|type|updated_at|user_id|description|fanart|is_public|created_at|name';
  const meta = {};
  const coll = listRows.find(r => r.s_key === 'collection');
  if (coll && coll.lists) {
    for (const b of topMaps(coll.lists)) {
      const skey = (b.match(/s_key:(\S+)/) || [])[1];
      if (!skey) continue;
      const nameM = b.match(new RegExp('name:(.*?)(?=\\s+(?:' + KEYS + '):)')) || b.match(/name:(\S+)/);
      const posters = ((b.match(/posters:\[([^\]]*)\]/) || [])[1] || '').split(/\s+/).filter(x => /^https?:/.test(x));
      meta[skey] = { name: nameM ? nameM[1] : null, isPublic: /is_public:true/.test(b), cover: posters[0] || null };
    }
  }

  const out = [], seen = new Set();
  const push = (skey, m) => {
    const items = itemsBySkey[skey] || [];
    const kinds = new Set(items.map(i => i.type));
    const fallback = skey === 'favorite-series' ? 'Favorite Shows' : skey === 'favorite-movies' ? 'Favorite Movies' : 'List';
    out.push({
      name: (m && m.name && m.name !== '<nil>') ? m.name : fallback,
      isPublic: m ? m.isPublic : false,
      cover: m ? m.cover : null,
      kind: kinds.size === 1 ? [...kinds][0] : 'mixed',
      items,
    });
    seen.add(skey);
  };
  for (const skey of Object.keys(meta)) if (itemsBySkey[skey]) push(skey, meta[skey]);
  for (const skey of Object.keys(itemsBySkey)) if (!seen.has(skey)) push(skey, null);
  return out;
}

/* ---------------- Comments ----------------
   Your own comments, gathered from every comment table in the export:
     episode_comment.csv        — comments on episodes (the bulk)
     show_comment.csv           — comments on a show as a whole
     profile_comment.csv        — comments you left on a friend's profile
     comments-prod-comments.csv — newer movie/series comments (type comment/reply)
   Attached images come from meme.csv, joined on episode_comment_id.
   Replies keep their parent's text only when the parent is also one of your
   comments (other users' comments aren't in the export). */
function buildComments(shows) {
  const showSlugs = new Set(shows.map(s => slugify(s.title)));
  const slugForShow = (name) => { const s = slugify(name || ''); return s && showSlugs.has(s) ? s : null; };

  // Images grouped by the episode comment they hang off.
  const memesByComment = {};
  for (const mm of T('meme.csv')) {
    const cid = (mm.episode_comment_id || '').trim(); if (!cid) continue;
    const url = (mm.medium_url || '').trim(); if (!url) continue;
    (memesByComment[cid] || (memesByComment[cid] = [])).push({
      id: (mm.id || '').trim(),
      url,                                        // "marked" — the version as posted
      clean: (mm.clean_version_medium_url || '').trim(),
      kind: mm.type || 'meme',
      w: toNum(mm.width) || null, h: toNum(mm.height) || null,
    });
  }

  const list = [];
  const byId = {};   // legacy comment id -> entry (for reply parent lookup)

  // TV Time stores absent fields as the literal string "null" (e.g. extended_comment
  // is always "null" here), so treat those as empty.
  const clean = (v) => { const s = (v || '').trim(); return (s === 'null' || s === 'undefined') ? '' : s; };
  const textOf = (r) => clean(r.comment) || clean(r.extended_comment) || clean(r.text) || clean(r.message);
  const add = (e) => { list.push(e); if (e.id) byId[e.id] = e; return e; };

  // episode_comment.csv
  for (const r of T('episode_comment.csv')) {
    const text = textOf(r); const images = memesByComment[(r.id || '').trim()] || [];
    if (!text && !images.length) continue;
    add({
      id: (r.id || '').trim(), kind: 'episode', target: clean(r.tv_show_name),
      slug: slugForShow(r.tv_show_name),
      season: toNum(r.episode_season_number) || null, episode: toNum(r.episode_number) || null,
      text, images, likes: toNum(r.nb_likes),
      parentId: (r.parent_comment_id || '').trim().replace(/^0$/, ''),
      date: parseDate(r.created_at),
    });
  }
  // show_comment.csv
  for (const r of T('show_comment.csv')) {
    const text = textOf(r); if (!text) continue;
    add({
      id: (r.id || '').trim(), kind: 'show', target: clean(r.tv_show_name),
      slug: slugForShow(r.tv_show_name), text, images: [], likes: toNum(r.nb_likes),
      parentId: (r.parent_comment_id || '').trim().replace(/^0$/, ''), date: parseDate(r.created_at),
    });
  }
  // profile_comment.csv — target is a friend's profile (id only; names aren't in the export)
  for (const r of T('profile_comment.csv')) {
    const text = textOf(r); if (!text) continue;
    add({
      id: (r.id || '').trim(), kind: 'profile', target: r.profile_id ? `Profile #${r.profile_id}` : 'A profile',
      slug: null, text, images: [], likes: toNum(r.nb_likes),
      parentId: (r.parent_comment_id || '').trim().replace(/^0$/, ''), date: parseDate(r.created_at),
    });
  }
  // comments-prod-comments.csv — newer movie/series comments (skip likes/reports/blank rows)
  const byUuid = {};
  for (const r of T('comments-prod-comments.csv')) {
    if (r.type !== 'comment' && r.type !== 'reply') continue;
    const text = textOf(r); if (!text) continue;
    const isMovie = r.entity_type === 'movie';
    const name = clean(isMovie ? r.movie_name : r.series_name);
    const e = add({
      id: '', uuid: (r.comment_uuid || r.uuid || '').trim(), kind: isMovie ? 'movie' : 'series',
      target: name, slug: isMovie ? null : slugForShow(name), text, images: [],
      likes: toNum(r.like_count), parentUuid: (r.parent_uuid || '').trim(),
      date: parseDate(r.created_at),
    });
    if (e.uuid) byUuid[e.uuid] = e;
  }

  // Resolve reply parents where recoverable, and tag every reply.
  for (const e of list) {
    e.isReply = !!(e.parentId || e.parentUuid);
    if (e.parentId && byId[e.parentId]) e.parent = byId[e.parentId];
    else if (e.parentUuid && byUuid[e.parentUuid]) e.parent = byUuid[e.parentUuid];
    else e.parent = null;
  }

  list.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  const withImages = list.filter(e => e.images.length).length;
  const imageCount = list.reduce((n, e) => n + e.images.length, 0);
  return { list, withImages, imageCount };
}

/* ---------------- Notifications ----------------
   notifications-prod-notifications.csv — your read-only activity feed: who liked /
   replied to / mentioned / requested to follow you, badges you unlocked, and airing
   reminders. The `text` is already display-ready; sender avatars / badge art / posters
   come from the `image` field (backed up per notifImageRef). */
const NOTIF_CAT = {
  'episode-comment-liked': 'like', 'episode-reply-liked': 'like', 'movie-comment-liked': 'like',
  'show-comment-liked': 'like', 'show-reply-liked': 'like',
  'replied-to-comment': 'reply', 'episode-commented': 'reply',
  'mentioned-in-comment': 'mention',
  'follow-requested': 'follow',
  'badge-unlocked': 'badge',
  'episode-will-air': 'airing',
};
const NOTIF_CAT_LABEL = { like: 'Like', reply: 'Reply', mention: 'Mention', follow: 'Follow', badge: 'Badge', airing: 'Airing', other: 'Other' };

function buildNotifications() {
  const list = [];
  for (const r of T('notifications-prod-notifications.csv')) {
    const type = (r.type || '').trim();
    const cat = NOTIF_CAT[type] || 'other';
    const isBadge = type === 'badge-unlocked';
    const badgeName = (r.badge_name || '').trim();
    const text = isBadge ? (badgeName ? `Unlocked “${badgeName}”` : 'Unlocked a badge') : (r.text || '').trim();
    const imgRef = notifImageRef(r);
    if (!text && !imgRef) continue;
    // `time` is a ms epoch on every row; `date` (ISO) only on some.
    const date = (r.time || '').trim() ? new Date(+r.time) : parseDate(r.date);
    const senderId = imgRef && imgRef.kind === 'avatar' ? imgRef.key.slice('avatars/'.length) : null;
    list.push({ type, cat, text, date, img: imgRef, senderId, isBadge });
  }
  list.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  const byCat = {};
  for (const n of list) byCat[n.cat] = (byCat[n.cat] || 0) + 1;
  return { list, byCat };
}

/* ---------------- Badges ----------------
   user_badge.csv — 528 earned badges, but most are the same badge unlocked per show
   (e.g. "quick-watcher-3" for many series). We group by badge *type* (the slug minus
   the leading show id) with a count + date range. Art/name for the ~119 that appeared
   in a badge-unlocked notification; a humanized slug for the rest. */
function buildBadges() {
  const rows = T('user_badge.csv');
  // Badge art keyed by full badge_id, from badge-unlocked notifications.
  const art = {};
  for (const r of T('notifications-prod-notifications.csv')) {
    if (r.type !== 'badge-unlocked') continue;
    const m = (r.url || '').match(/badge_id=([^&]+)/);
    if (m && (r.image || '').trim()) art[m[1]] = { image: r.image.trim(), key: 'badges/' + m[1] };
  }
  // TV Time's internal show id (the badge_id prefix) -> show name.
  const showName = {};
  for (const file of ['followed_tv_show.csv', 'tv_show_rate.csv', 'show_comment.csv']) {
    for (const r of T(file)) {
      const id = (r.tv_show_id || '').trim(), nm = (r.tv_show_name || '').trim();
      if (id && nm && !showName[id]) showName[id] = nm;
    }
  }
  const typeKey = (bid) => bid.replace(/^\d+-/, '');                 // drop the show-id prefix
  const humanize = (tk) => tk.replace(/-bd$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const groups = {};
  for (const r of rows) {
    const bid = (r.badge_id || '').trim(); if (!bid) continue;
    const tk = typeKey(bid);
    const g = groups[tk] || (groups[tk] = { key: tk, name: humanize(tk), count: 0, first: null, last: null, art: null, shows: [], _seen: new Set() });
    g.count++;
    const d = parseDate(r.created_at);
    if (d) { if (!g.first || d < g.first) g.first = d; if (!g.last || d > g.last) g.last = d; }
    if (!g.art && art[bid]) g.art = art[bid];
    const pm = bid.match(/^(\d+)-/);   // per-show badge -> record the show
    if (pm && !g._seen.has(pm[1])) { g._seen.add(pm[1]); g.shows.push({ id: pm[1], name: showName[pm[1]] || null, date: d }); }
  }
  const list = Object.values(groups).map(g => {
    delete g._seen;
    g.shows.sort((a, b) => (a.name || 'zzz').localeCompare(b.name || 'zzz'));
    return g;
  }).sort((a, b) => b.count - a.count || (b.last?.getTime() || 0) - (a.last?.getTime() || 0));
  return { list, total: rows.length };
}

/* ---------------- Characters ----------------
   show_character_episode_vote.csv — the characters you voted for, per episode. Names /
   actors / posters come from the extended backup (Extended.characters), else id only. */
function buildCharacters() {
  const byId = {};
  for (const r of T('show_character_episode_vote.csv')) {
    const id = (r.show_character_id || '').trim(); if (!id) continue;
    const c = byId[id] || (byId[id] = { id, votes: [] });
    c.votes.push({ show: r.tv_show_name || '', season: r.episode_season_number || '', episode: r.episode_number || '', date: parseDate(r.created_at) });
  }
  const list = Object.values(byId).map(c => {
    const m = Extended.characters[c.id] || {};
    c.votes.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
    const shows = [...new Set(c.votes.map(v => v.show).filter(Boolean))];
    return { id: c.id, name: m.name || null, actor: m.actor_name || null, poster: m.poster || null,
      votes: c.votes, shows, lastDate: c.votes[0]?.date || null };
  });
  list.sort((a, b) => (b.lastDate?.getTime() || 0) - (a.lastDate?.getTime() || 0));
  return list;
}

/* ---------------- Friends ----------------
   friend.csv — your friends (ids + affinity + since). Real names / avatars come from
   the extended backup (Extended.friends), else id only. */
function buildFriends() {
  const list = [];
  for (const r of T('friend.csv')) {
    const id = (r.friend_id || '').trim(); if (!id) continue;
    const m = Extended.friends[id] || {};
    list.push({ id, name: m.name || null, username: m.username || null, avatar: m.avatar || null,
      since: parseDate(r.created_at), affinity: toNum(r.affinity) });
  }
  list.sort((a, b) => (a.name || 'zzz~').localeCompare(b.name || 'zzz~'));
  return list;
}

// After importing an extended backup: reload the resolved names and rebuild the two
// affected models so the new names/images show without a full reload.
function refreshExtended() {
  Extended.load();
  if (STATE.model) { STATE.model.characters = buildCharacters(); STATE.model.friends = buildFriends(); }
}

/* ---------------- Stats ----------------
   stats-prod-cache.csv holds Go-serialized `map[...]` blobs of precomputed stats:
   biggest marathons, and episode/movie counts + hours per month. */
function goMaps(s) {   // split "map[..] map[..]" into inner strings, depth-aware
  const out = []; let i = 0;
  while (i < s.length) {
    const start = s.indexOf('map[', i); if (start < 0) break;
    let depth = 0, j = start + 3;
    for (; j < s.length; j++) { if (s[j] === '[') depth++; else if (s[j] === ']') { if (--depth === 0) { j++; break; } } }
    out.push(s.slice(start + 4, j - 1)); i = j;
  }
  return out;
}
function goArray(blob, key) {   // content of "key:[ ... ]", depth-aware
  const idx = blob.indexOf(key + ':['); if (idx < 0) return null;
  let i = idx + key.length + 1, depth = 0; const start = i;
  for (; i < blob.length; i++) { if (blob[i] === '[') depth++; else if (blob[i] === ']') { if (--depth === 0) return blob.slice(start + 1, i); } }
  return null;
}
function buildStats() {
  const cache = T('stats-prod-cache.csv');
  const blob = (type) => (cache.find(r => r.type === type) || {}).stats || '';
  const epW = blob('episode-watched'), mvW = blob('movie-watched');

  const marathons = [];
  const marr = goArray(epW, 'biggest-marathon');
  if (marr) for (const b of goMaps(marr)) {
    const x = (b.match(/x:(.*?)\s+y:/) || [])[1];
    const y = b.match(/y:\[(\d+)\s+(\d+)\]/);
    if (x && y) marathons.push({ show: x, episodes: +y[1], days: +y[2] });
  }
  const series = (source, key) => {
    const arr = goArray(source, key), out = [];
    if (arr) for (const b of goMaps(arr)) {
      const x = (b.match(/x:(.*?)\s+y:/) || [])[1];
      const y = (b.match(/y:(\d+)/) || [])[1];
      if (x) out.push({ label: x, value: +y || 0 });
    }
    return out;
  };
  const epByMonth = series(epW, 'count-by-month');
  return {
    hasData: !!(marathons.length || epByMonth.length),
    marathons,
    epByMonth,
    hoursByMonth: series(epW, 'duration-by-month'),
    moviesByMonth: series(mvW, 'count-by-month'),
  };
}

/* ---------------- Overview ----------------
   Headline numbers primarily from the tracking-stats row (authoritative totals),
   with everything else counted from the curated datasets above. */
function buildOverview(m) {
  const statsRow = T('tracking-prod-records-v2.csv').find(r => r.key === 'tracking-stats') || {};
  const epFromStats = toNum(statsRow.ep_watch_count);
  const movieFromStats = toNum(statsRow.movie_watch_count);

  const episodeWatches = m.history.filter(e => e.type === 'episode').length;
  const movieWatches   = m.history.filter(e => e.type === 'movie').length;

  return {
    episodesWatched: epFromStats || episodeWatches,
    moviesWatched:   movieFromStats || movieWatches,
    seriesRuntime:   toNum(statsRow.total_series_runtime),
    moviesRuntime:   toNum(statsRow.total_movies_runtime),
    showsFollowed:   toNum(statsRow.series_follow_count) || m.shows.filter(s => s.status === 'following').length,
    showsTracked:    m.shows.length,
    moviesTracked:   m.movies.length,
    ratingsLogged:   m.ratings.list.length,
    reactionsLogged: m.reactions.list.length,
    timelineEvents:  m.history.length,
    firstWatch:      m.history.length ? m.history[m.history.length - 1].date : null,
    lastWatch:       m.history.length ? m.history[0].date : null,
  };
}

/* ===================================================================
   NAVIGATION / CHROME
   =================================================================== */
const VIEWS = [
  { id: 'home',     label: 'Home',     icon: 'ph-house', render: renderHome },
  // Watch group
  { id: 'shows',    label: 'Shows',    icon: 'ph-television', render: renderShows },
  { id: 'movies',   label: 'Movies',   icon: 'ph-film-slate', render: renderMovies },
  { id: 'watch-history', label: 'Watch history', icon: 'ph-clock-counter-clockwise', render: renderHistory },
  { id: 'lists',    label: 'Lists',    icon: 'ph-list-bullets', render: renderLists },
  // Ratings group
  { id: 'ratings',  label: 'Ratings',  icon: 'ph-star', render: renderRatings },
  { id: 'reactions', label: 'Reactions', icon: 'ph-heart', render: renderReactions },
  { id: 'character-votes', label: 'Character votes', icon: 'ph-mask-happy', render: renderCharacters },
  // Community group
  { id: 'comments', label: 'Comments', icon: 'ph-chat-circle-text', render: renderComments },
  { id: 'notifications', label: 'Notifications', icon: 'ph-bell', render: renderNotifications },
  { id: 'friends',  label: 'Friends',  icon: 'ph-users', render: renderFriends },
  { id: 'badges',   label: 'Badges',   icon: 'ph-medal', render: renderBadges },
  { id: 'profile',  label: 'Profile',  icon: 'ph-user', render: renderProfile },
  { id: 'raw',      label: 'All data', icon: 'ph-database', render: renderRaw },
];

// Views collapsed under one top-level tab. Children must be a contiguous run in VIEWS.
// Desktop: children nest under the group in the sidebar. Mobile: tapping the group tab
// opens a popup menu. The URL uses each child's own id (#/ratings), reflecting the sub-view.
const GROUPS = {
  watch:     { label: 'Watch',     icon: 'ph-play-circle',  children: ['shows', 'movies', 'watch-history', 'lists'] },
  ratings:   { label: 'Ratings',   icon: 'ph-star',         children: ['ratings', 'reactions', 'character-votes'] },
  community: { label: 'Community', icon: 'ph-users-three',  children: ['comments', 'notifications', 'friends', 'badges'] },
};
const GROUP_OF = {};   // childViewId -> groupId
for (const [gid, g] of Object.entries(GROUPS)) for (const c of g.children) GROUP_OF[c] = gid;

function buildChrome() {
  // desktop brand rail (inserted once)
  if (!$('.brand-rail')) {
    const rail = el('div', { class: 'brand-rail' }, [el('img', { class: 'brand-mark small', src: 'favicon.svg', alt: '', width: 22, height: 22 }), 'TV Time Archive']);
    $('#app').prepend(rail);
  }
  const bar = $('#tabbar');
  bar.innerHTML = '';
  const prof = STATE.model && STATE.model.profile;
  const hasAvatar = prof && (prof.avatar || (prof.userId && Backup.urlFor('avatars/' + prof.userId)));
  const seenGroup = new Set();
  const activeNav = GROUP_OF[STATE.view] ? 'group:' + GROUP_OF[STATE.view] : STATE.view;
  const isDesktop = () => window.matchMedia('(min-width: 860px)').matches;
  for (const v of VIEWS) {
    const gid = GROUP_OF[v.id];
    if (gid) {
      if (seenGroup.has(gid)) continue;   // one tab per group, at its first child's slot
      seenGroup.add(gid);
      const g = GROUPS[gid], navId = 'group:' + gid;
      const groupTab = el('button', { class: 'tab group' + (activeNav === navId ? ' active' : ''), 'data-view': navId },
        [el('i', { class: 'ph ' + g.icon + ' tab-ico' }), el('span', { text: g.label }), el('i', { class: 'ph ph-caret-down nav-caret' })]);
      const sub = el('div', { class: 'subnav' });
      for (const cid of g.children) {
        const cv = VIEWS.find(x => x.id === cid); if (!cv) continue;
        const item = el('button', { class: 'subnav-item' + (STATE.view === cid ? ' active' : ''), 'data-view': cid },
          [el('i', { class: 'ph ' + cv.icon }), el('span', { text: cv.label })]);
        item.addEventListener('click', () => { closeNavMenus(); navigate({ view: cid }); });
        sub.append(item);
      }
      groupTab.addEventListener('click', () => {
        // Desktop: enter the group (children nest via CSS). Mobile: toggle the popup.
        if (isDesktop()) { closeNavMenus(); navigate({ view: g.children[0] }); }
        else {
          const isOpen = navPopup && navPopup.tab === groupTab;
          closeNavMenus();
          if (!isOpen) openNavMenu(groupTab, sub);
        }
      });
      bar.append(groupTab, sub);
      continue;
    }
    // The Profile tab shows your avatar (when available) instead of the generic icon.
    const icon = (v.id === 'profile' && hasAvatar)
      ? avatarEl(prof.avatar, prof.displayName, prof.userId && 'avatars/' + prof.userId, 'tab-avatar')
      : el('i', { class: 'ph ' + v.icon + ' tab-ico' });
    bar.append(el('button', {
      class: 'tab' + (activeNav === v.id ? ' active' : ''),
      'data-view': v.id,
      onclick: () => { closeNavMenus(); navigate({ view: v.id }); },
    }, [icon, el('span', { text: v.label })]));
  }
  buildSettingsMenu();
}

// Mobile nav popup: move the group's subnav to <body> (escaping the tabbar's
// backdrop-filter containing block) and anchor it above the tab.
let navPopup = null;
function openNavMenu(tab, sub) {
  document.body.appendChild(sub);
  sub.classList.add('floating');
  tab.classList.add('menu-open');
  const r = tab.getBoundingClientRect();
  sub.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 200)) + 'px';
  sub.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  navPopup = { tab, sub };
}
function closeNavMenus() {
  if (!navPopup) return;
  const { tab, sub } = navPopup;
  tab.classList.remove('menu-open');
  sub.classList.remove('floating');
  sub.style.left = sub.style.bottom = '';
  tab.after(sub);   // restore it into the tabbar (for the desktop nested layout)
  navPopup = null;
}

function resetApp() {
  IDB.clear();   // "Change source .zip file" also forgets the stored archive
  STATE.tables = {}; STATE.model = null; STATE.listState = {}; STATE.pendingScroll = null;
  history.replaceState(null, '', location.pathname + location.search);   // drop the #/… hash
  $('#app').hidden = true; $('#landing').hidden = false;
  $('#fileInput').value = ''; $('#landingError').hidden = true;
  showChooser();
}

/* Topbar settings menu: auto-load toggle, cache clear, change file. */
function buildSettingsMenu() {
  const host = $('#settingsHost');
  host.innerHTML = '';
  const gear = el('button', { class: 'settings-btn', title: 'Settings', 'aria-label': 'Settings' }, [el('i', { class: 'ph ph-gear' })]);
  const pop = el('div', { class: 'menu-pop', hidden: '' });

  const sw = el('span', { class: 'switch' + (Enrichment.enabled ? ' on' : '') });
  const toggleItem = el('button', { class: 'menu-item' }, [el('span', { text: 'Auto-load show metadata' }), sw]);
  toggleItem.addEventListener('click', (e) => {
    e.stopPropagation();
    Enrichment.enabled = !Enrichment.enabled;
    try { localStorage.setItem('tvt.enrich', Enrichment.enabled ? '1' : '0'); } catch {}
    sw.classList.toggle('on', Enrichment.enabled);
    applyState(history.state || hashToState());
  });
  const note = el('div', { class: 'menu-note' }, [el('i', { class: 'ph ph-warning-circle' }), el('span', { text: 'This data is fetched from the TVMaze API.' })]);

  // Movie titles via Wikidata (separate opt-in + cache)
  const msw = el('span', { class: 'switch' + (MovieMeta.enabled ? ' on' : '') });
  const movieToggle = el('button', { class: 'menu-item' }, [el('span', { text: 'Auto-load movie titles' }), msw]);
  movieToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    MovieMeta.enabled = !MovieMeta.enabled;
    try { localStorage.setItem('tvt.movies', MovieMeta.enabled ? '1' : '0'); } catch {}
    msw.classList.toggle('on', MovieMeta.enabled);
    applyState(history.state || hashToState());
  });
  const movieNote = el('div', { class: 'menu-note' }, [el('i', { class: 'ph ph-warning-circle' }), el('span', { text: 'This data is fetched from the Wikidata API, and may not be accurate.' })]);

  // Extended backup: import the zip made by extended-backup.py (images + resolved names).
  const IMPORT_LABEL = 'Import extended backup…';
  const importItem = el('button', { class: 'menu-item' }, [el('span', { text: IMPORT_LABEL })]);
  importItem.addEventListener('click', (e) => {
    e.stopPropagation();
    pickBackup((err, count) => {
      importItem.firstChild.textContent = err ? (err.message || 'Import failed') : `Imported ${fmtInt(count)} ✓`;
      setTimeout(() => { importItem.firstChild.textContent = IMPORT_LABEL; }, 1800);
      if (!err) { refreshExtended(); applyState(history.state || hashToState()); }
    });
  });
  const importNote = el('div', { class: 'menu-note' }, [el('i', { class: 'ph ph-info' }), el('span', {}, [
    'Comment images, avatars, badges, characters & friends. Generate it with extended-backup.py — see the ',
    el('a', { href: 'https://github.com/Remls/TVTimeArchive#extended-backup', target: '_blank', rel: 'noopener noreferrer', text: 'README' }), '.',
  ])]);

  // Umbrella "Clear cache…" — expands to per-cache clears, each confirm-gated.
  const clearWrap = el('div', { class: 'menu-sub-wrap' });
  const clearToggle = el('button', { class: 'menu-item' }, [el('span', { text: 'Clear cache…' }), el('i', { class: 'ph ph-caret-right menu-caret' })]);
  const clearSub = el('div', { class: 'menu-sub', hidden: '' });
  const makeClear = (label, confirmMsg, fn) => {
    const item = el('button', { class: 'menu-item sub' }, [el('span', { text: label })]);
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(confirmMsg)) return;
      const n = await fn();
      item.firstChild.textContent = n ? `Cleared ${fmtInt(n)} ✓` : 'Nothing to clear';
      setTimeout(() => { item.firstChild.textContent = label; }, 1500);
      applyState(history.state || hashToState());
    });
    return item;
  };
  clearSub.append(
    makeClear('Show metadata', 'Clear cached show metadata?', () => Enrichment.clearCache()),
    makeClear('Movie titles', 'Clear cached movie titles?', () => MovieMeta.clearCache()),
    makeClear('Imported backup', 'Clear the imported backup (images + resolved names) from this browser?', () => Backup.clear()),
  );
  clearToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSub.hidden = !clearSub.hidden;
    clearToggle.querySelector('.menu-caret').classList.toggle('open', !clearSub.hidden);
  });
  clearWrap.append(clearToggle, clearSub);

  const changeItem = el('button', { class: 'menu-item' }, [el('span', { text: 'Change source .zip file' })]);
  changeItem.addEventListener('click', () => {
    if (!confirm('This forgets the loaded archive (cached metadata and comment images stay). Continue?')) return;
    close(); resetApp();
  });

  pop.append(toggleItem, note, el('div', { class: 'menu-sep' }), movieToggle, movieNote,
    el('div', { class: 'menu-sep' }), importItem, importNote,
    el('div', { class: 'menu-sep' }), clearWrap,
    el('div', { class: 'menu-sep' }), changeItem);
  host.append(gear, pop);

  const onDoc = (e) => { if (!host.contains(e.target)) close(); };
  function close() { pop.hidden = true; document.removeEventListener('click', onDoc); }
  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) { pop.hidden = false; setTimeout(() => document.addEventListener('click', onDoc), 0); }
    else close();
  });
}

function renderView(id) {
  STATE.view = id;
  const navId = GROUP_OF[id] ? 'group:' + GROUP_OF[id] : id;   // a group child highlights its group tab
  for (const t of document.querySelectorAll('.tab, .subnav-item')) {
    const dv = t.dataset.view;
    t.classList.toggle('active', dv === id || dv === navId);
  }
  closeNavMenus();
  $('#globalSearch').hidden = true;
  const root = $('#viewRoot');
  root.innerHTML = '';
  window.scrollTo(0, 0);
  (VIEWS.find(v => v.id === id) || VIEWS[0]).render(root);
}

/* ---- Browser-history + URL navigation ----
   The current view is reflected in the URL hash (#/shows, #/shows/<slug>) so it's
   shareable and survives refresh, and the device Back button works in-app.
   A nav state is { view } for a tab, or { view:'shows', detail:<slug> } for a detail. */
const slugify = (t) => norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const isView = (id) => VIEWS.some(v => v.id === id);

function stateToHash(s) {
  if (s.view === 'shows' && s.detail) return `#/shows/${s.detail}`;
  return `#/${s.view || 'home'}`;
}
function hashToState() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'shows' && parts[1]) return { view: 'shows', detail: decodeURIComponent(parts[1]) };
  return { view: isView(parts[0]) ? parts[0] : 'home' };
}
function applyState(state) {
  const s = state || hashToState();
  if (s.view === 'shows' && s.detail) {
    const show = STATE.model.shows.find(sh => slugify(sh.title) === s.detail);
    if (show) { openShowDetail(show); return; }
  }
  renderView(isView(s.view) ? s.view : 'home');
}
function navigate(state, replace) {
  history[replace ? 'replaceState' : 'pushState'](state, '', stateToHash(state));
  applyState(state);
}

function viewHead(root, title, subtitle) {
  root.append(el('div', { class: 'view-head' }, [el('h2', { text: title }), subtitle ? el('p', { text: subtitle }) : null]));
}

/* ---- Show poster + navigation helpers ----
   Used by the summary sections (Overview, Stats, Reactions, Ratings) so each show
   row can show its poster (auto-loaded when enrichment is on) and open its detail. */
function knownShowSlug(title) {
  const slug = slugify(title || '');
  if (!slug) return null;
  const m = STATE.model;
  if (!m._showSlugs) m._showSlugs = new Set(m.shows.map(s => slugify(s.title)));
  return m._showSlugs.has(slug) ? slug : null;
}
// A poster box that fills now if cached, else is tagged to be filled once the fetch lands.
function autoPoster(title, seriesId) {
  const box = el('div', { class: 'item-poster' });
  const url = Enrichment.posterFor(title, seriesId);
  if (url) box.append(el('img', { src: url, loading: 'lazy', alt: '' }));
  else box.dataset.poster = Enrichment.resolveKey(title, seriesId);
  return box;
}
function fillPostersIn(rootEl) {
  for (const box of rootEl.querySelectorAll('.item-poster[data-poster]')) {
    const v = Enrichment.getCached(box.dataset.poster);
    if (v && v.img) { box.append(el('img', { src: v.img, loading: 'lazy', alt: '' })); box.removeAttribute('data-poster'); }
  }
}
function ensureShowPosters(items) {
  if (!Enrichment.enabled || !items.length) return;
  const root = $('#viewRoot');
  Enrichment.ensure(items, false).then(n => { if (n > 0) fillPostersIn(root); });
}
// A show row: optional poster + main/right content; navigates to the show when known.
function showLineItem(title, seriesId, mainKids, rightKids) {
  const slug = knownShowSlug(title);
  const kids = [];
  if (Enrichment.enabled) kids.push(autoPoster(title, seriesId));
  kids.push(el('div', { class: 'item-main' }, mainKids));
  if (rightKids && rightKids.length) kids.push(el('div', { class: 'item-right' }, rightKids));
  const item = el('div', { class: 'item' + (slug ? ' clickable' : '') }, kids);
  if (slug) { item.title = 'View episode progress'; item.addEventListener('click', () => navigate({ view: 'shows', detail: slug })); }
  return item;
}
const showPosterItem = (title, seriesId) => ({ seriesId: seriesId || Enrichment.seriesIdByName[norm(title)] || '', title });

/* ===================================================================
   VIEW: Home — headline stats, most-watched shows, marathons + monthly charts
   =================================================================== */
function renderHome(root) {
  const o = STATE.model.overview;
  const p = STATE.model.profile;
  const title = p.displayName ? `${p.displayName}’s archive` : 'Home';
  const subtitle = `Tracked since ${fmtDate(o.firstWatch)} · last activity ${fmtDate(o.lastWatch)}`;
  root.append(el('div', { class: 'view-head with-avatar' }, [
    avatarEl(p.avatar, p.displayName, p.userId && 'avatars/' + p.userId, 'lg'),
    el('div', {}, [el('h2', { text: title }), el('p', { text: subtitle })]),
  ]));

  const cards = [
    // single-accent: only the hero stat (total time in TV) is coral; the rest read neutral
    ['episodesWatched', 'Episodes watched', o.episodesWatched, '', null],
    ['moviesWatched', 'Movies watched', o.moviesWatched, '', null],
    ['seriesRuntime', 'Time in TV', fmtDuration(o.seriesRuntime), 'accent', 'series runtime'],
    ['moviesRuntime', 'Time in film', fmtDuration(o.moviesRuntime), 'accent', 'movie runtime'],
    ['showsFollowed', 'Shows followed', fmtInt(o.showsFollowed), '', `${fmtInt(o.showsTracked)} tracked total`],
    ['moviesTracked', 'Movies tracked', fmtInt(o.moviesTracked), '', null],
    ['reactionsLogged', 'Reactions logged', fmtInt(o.reactionsLogged), '', null],
    ['ratingsLogged', 'Ratings given', fmtInt(o.ratingsLogged), '', 'shows · movies · episodes'],
  ];
  const grid = el('div', { class: 'stat-grid' });
  for (const [, label, value, cls, sub] of cards) {
    grid.append(el('div', { class: 'stat-card' }, [
      el('div', { class: 'stat-value' + (cls ? ' ' + cls : ''), text: typeof value === 'number' ? fmtInt(value) : value }),
      el('div', { class: 'stat-label', text: label }),
      sub ? el('div', { class: 'stat-sub', text: sub }) : null,
    ]));
  }
  root.append(grid);

  // Top shows by episodes watched
  root.append(el('div', { class: 'section-title', text: 'Most-watched shows' }));
  const top = STATE.model.shows.filter(s => s.epWatched > 0).slice(0, 8);
  const list = el('div', { class: 'cards two-col' });
  for (const s of top) {
    list.append(showLineItem(s.title, s.id, [
      el('div', { class: 'item-title', text: s.title }),
      el('div', { class: 'item-meta' }, [ el('span', { html: `<b>${fmtInt(s.epWatched)}</b> episodes` }), s.rating ? el('span', { html: `<i class="ph-fill ph-star" style="color:var(--accent)"></i> ${s.rating}` }) : null ]),
    ]));
  }
  root.append(top.length ? list : el('div', { class: 'empty', text: 'No watch data found.' }));
  ensureShowPosters(top.map(s => showPosterItem(s.title, s.id)));

  // ---- Stats (marathons + monthly charts), folded into Home ----
  const st = STATE.model.stats;
  if (st && st.hasData) {
    if (st.marathons.length) {
      root.append(el('div', { class: 'section-title', text: 'Biggest marathons' }));
      const mcards = el('div', { class: 'cards two-col' });
      for (const m of st.marathons) {
        mcards.append(showLineItem(m.show, null, [
          el('div', { class: 'item-title', text: m.show }),
          el('div', { class: 'item-meta' }, [el('span', { html: `<b>${fmtInt(m.episodes)}</b> episodes in <b>${fmtInt(m.days)}</b> day${m.days === 1 ? '' : 's'}` })]),
        ]));
      }
      root.append(mcards);
      ensureShowPosters(st.marathons.map(m => showPosterItem(m.show)));
    }
    if (st.epByMonth.length) { root.append(el('div', { class: 'section-title', text: 'Episodes watched per month' })); barChart(root, st.epByMonth); }
    if (st.hoursByMonth.length) { root.append(el('div', { class: 'section-title', text: 'Hours watched per month' })); barChart(root, st.hoursByMonth, v => `${fmtInt(v)}h`); }
    if (st.moviesByMonth.length && st.moviesByMonth.some(d => d.value)) { root.append(el('div', { class: 'section-title', text: 'Movies watched per month' })); barChart(root, st.moviesByMonth); }
  }
}

/* ===================================================================
   VIEW: Stats — precomputed marathons & monthly charts (stats-prod-cache)
   =================================================================== */
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (s) => { const [y, mo] = String(s).split('-'); return (y && mo) ? `${MONTHS[+mo] || mo} '${y.slice(2)}` : s; };

function barChart(root, data, fmt) {
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
function buildToolbar(root, opts = {}) {
  const search = el('input', { type: 'search', placeholder: 'Search…', class: 'tb-search' });
  const row1 = el('div', { class: 'tb-row1' }, [search, opts.onExport ? makeExportMenu(opts.onExport) : null]);
  const controls = el('div', { class: 'tb-controls' });
  root.append(el('div', { class: 'toolbar' }, [row1, controls]));
  return { search, controls };
}

/* Export dropdown: a button that opens a small CSV / JSON menu. */
function makeExportMenu(onExport) {
  const wrap = el('div', { class: 'export-menu' });
  const btn = el('button', { class: 'btn secondary', html: '<i class="ph ph-download-simple"></i> Export' });
  const onDoc = (e) => { if (!wrap.contains(e.target)) close(); };
  function close() { pop.hidden = true; document.removeEventListener('click', onDoc); }
  const pick = (fmt) => (e) => { e.stopPropagation(); close(); onExport(fmt); };
  const pop = el('div', { class: 'menu-pop export-pop', hidden: '' }, [
    el('button', { class: 'menu-item', text: 'CSV', onclick: pick('csv') }),
    el('button', { class: 'menu-item', text: 'JSON', onclick: pick('json') }),
  ]);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) { pop.hidden = false; setTimeout(() => document.addEventListener('click', onDoc), 0); } else close();
  });
  wrap.append(btn, pop);
  return wrap;
}

/* ===================================================================
   Shared: filterable / sortable / paginated card list
   =================================================================== */
function listView(root, cfg) {
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
  const sortSel = el('select', { title: 'Sort' });
  for (const s of cfg.sorts) sortSel.append(el('option', { value: s.id, text: s.label }));
  sortSel.value = state.sort;
  let filterSel = null;
  if (cfg.filter) {
    filterSel = el('select', { title: 'Filter' });
    for (const o of cfg.filter.options) filterSel.append(el('option', { value: o.id, text: o.label }));
    filterSel.value = state.filterId;
  }
  const countPill = el('span', { class: 'count-pill' });
  controls.append(...[sortSel, filterSel, countPill].filter(Boolean));

  const container = el('div', { class: 'cards' + (cfg.twoCol ? ' two-col' : '') });
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
    if (!slice.length) { container.append(el('div', { class: 'empty', text: 'Nothing matches your search.' })); }
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
  sortSel.addEventListener('change', () => { state.sort = sortSel.value; state.page = 0; draw(); });
  if (filterSel) filterSel.addEventListener('change', () => { state.filterId = filterSel.value; state.page = 0; draw(); });

  draw();

  // Restore scroll once, when returning to this list (e.g. back from a show).
  if (cfg.stateKey && STATE.pendingScroll && STATE.pendingScroll.key === cfg.stateKey) {
    const y = STATE.pendingScroll.y;
    STATE.pendingScroll = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
}

/* ===================================================================
   VIEW: Shows
   =================================================================== */
function statusBadge(status) {
  const map = { following: ['good', 'Following'], archived: ['dim', 'Archived'], stopped: ['warn', 'Stopped'], watchlist: ['accent', 'Watchlist'], watched: ['good', 'Watched'], rated: ['warn', 'Rated'] };
  const [cls, label] = map[status] || ['dim', status || '—'];
  return el('span', { class: 'badge ' + cls, text: label });
}

function renderShows(root) {
  const shows = STATE.model.shows;
  listView(root, {
    title: 'TV Shows', subtitle: `${fmtInt(shows.length)} shows`,
    items: shows, searchKeys: ['title'], twoCol: true, stateKey: 'shows',
    enrichShows: (slice) => slice.map(s => ({ seriesId: s.id, title: s.title })),
    filter: { default: 'all', options: [
      { id: 'all', label: 'All statuses', test: () => true },
      { id: 'following', label: 'Following', test: s => s.status === 'following' },
      { id: 'archived', label: 'Archived', test: s => s.status === 'archived' },
      { id: 'stopped', label: 'Stopped', test: s => s.status === 'stopped' },
      { id: 'rated', label: 'Rated', test: s => !!s.rating },
    ] },
    sorts: [
      { id: 'recent', label: 'Recently watched', fn: (a, b) => (b.lastWatched?.getTime() || 0) - (a.lastWatched?.getTime() || 0) },
      { id: 'followed', label: 'Recently followed', fn: (a, b) => (b.followedAt?.getTime() || 0) - (a.followedAt?.getTime() || 0) },
      { id: 'rating', label: 'Highest rated', fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
      { id: 'watched', label: 'Most episodes watched', fn: (a, b) => b.epWatched - a.epWatched },
      { id: 'az', label: 'A → Z', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (s) => {
      const kids = [];
      if (Enrichment.enabled) {
        kids.push(zoomImg('item-poster', Enrichment.posterFor(s.title, s.id), s.title, Enrichment.posterFullFor(s.title, s.id)));
      }
      kids.push(el('div', { class: 'item-main' }, [
        el('div', { class: 'item-title', text: s.title }),
        el('div', { class: 'item-meta' }, [
          el('span', { html: `<b>${fmtInt(s.epWatched)}</b> ep watched` }),
          s.rewatches ? el('span', { html: `<b>${fmtInt(s.rewatches)}</b> rewatch` }) : null,
          s.emotionCount ? el('span', { html: `<i class="ph ph-heart"></i> ${fmtInt(s.emotionCount)}` }) : null,
          s.lastWatched ? el('span', { text: `last ${fmtDate(s.lastWatched)}` }) : null,
        ]),
      ]));
      kids.push(el('div', { class: 'item-right' }, [
        s.rating ? ratingChip({ stars: s.rating, label: LEVEL_LABEL[s.rating] || '' }) : null,
        el('div', { html: '' }), statusBadge(s.status),
      ]));
      return el('div', { class: 'item clickable', title: 'View episode progress', onclick: () => navigate({ view: 'shows', detail: slugify(s.title) }) }, kids);
    },
    exportName: 'tvtime-shows',
    exportRow: (s) => ({ title: s.title, status: s.status || '', episodes_watched: s.epWatched, rewatches: s.rewatches, rating: s.rating ?? '', emotion_count: s.emotionCount, seen_episodes: s.seenCount, followed_at: s.followedAt ? s.followedAt.toISOString() : '', last_watched: s.lastWatched ? s.lastWatched.toISOString() : '', sources: (s.sources || []).join('|') }),
  });
}

/* ===================================================================
   Show detail — per-show episode watch progress (opened from Shows).
   Watch counts come from your history; the full episode list & titles
   come from TVmaze (auto if enrichment is on, else one click to load).
   =================================================================== */
const pad2 = (n) => { const s = String(n); return /^\d$/.test(s) ? '0' + s : s; };

function openShowDetail(show) {
  // Remember where the Shows list was scrolled so we can restore it on back.
  STATE.pendingScroll = { key: 'shows', y: window.scrollY || window.pageYOffset || 0 };
  const root = $('#viewRoot');
  root.innerHTML = '';
  window.scrollTo(0, 0);

  root.append(el('div', { class: 'backbar' }, [
    el('button', { class: 'back-btn', text: '‹ Back', onclick: () => history.back() }),
  ]));
  const poster = el('div', { class: 'detail-poster' });
  const setPoster = (url, full) => { poster.innerHTML = ''; if (url) poster.append(zoomImg('detail-poster-fill', url, show.title, full)); };
  root.append(el('div', { class: 'detail-hero' }, [
    poster,
    el('div', { class: 'detail-hero-text' }, [
      el('h2', { text: show.title }),
      el('div', { class: 'detail-sub' }, [
        el('span', { html: `<b>${fmtInt(show.epWatched || 0)}</b> episodes watched` }),
        show.rewatches ? el('span', { html: `<b>${fmtInt(show.rewatches)}</b> rewatches` }) : null,
        show.emotionCount ? el('span', { html: `<i class="ph ph-heart"></i> ${fmtInt(show.emotionCount)}` }) : null,
        show.rating ? ratingChip({ stars: show.rating, label: LEVEL_LABEL[show.rating] || '' }) : null,
        statusBadge(show.status),
      ]),
    ]),
  ]));

  // Per-episode watch dates (each watch + rewatch event) from history.
  const datesByEp = {};
  for (const ev of STATE.model.history) {
    if (ev.type !== 'episode' || norm(ev.title) !== norm(show.title)) continue;
    (datesByEp[`${ev.season}|${ev.episode}`] ||= []).push(ev.date);
  }
  for (const k in datesByEp) datesByEp[k].sort((a, b) => (a ? a.getTime() : 0) - (b ? b.getTime() : 0));

  // Your feelings + star rating on each episode of this show.
  const showKey = norm(show.title);
  const reactsByEp = {};
  for (const r of STATE.model.reactions.list) {
    if (r.kind !== 'episode' || norm(r.title) !== showKey || r.reactionId == null) continue;
    const label = reactionChipText(r.reactionId, r.source);
    (reactsByEp[`${r.season}|${r.episode}`] ||= new Set()).add(label);
  }
  const ratingByEp = {};
  for (const r of STATE.model.ratings.list) {
    if (r.kind === 'episode' && norm(r.title) === showKey) ratingByEp[`${r.season}|${r.episode}`] = r;
  }

  const body = el('div');
  root.append(body);
  const key = Enrichment.keyFor(show.id, show.title);

  const load = () => {
    body.innerHTML = '';
    body.append(el('div', { class: 'enrich-note' }, [ el('div', { class: 'spinner' }), 'Loading from TVmaze…' ]));
    Enrichment.ensure([{ seriesId: show.id, title: show.title }], true).then(() => {
      const v = Enrichment.getCached(key);
      render(v && v.e && Object.keys(v.e).length ? v.e : null, v && v.f);
    });
  };
  const refetch = () => { Enrichment.forget(key); load(); };

  const render = (epMap, failed) => {
    body.innerHTML = '';
    const v = Enrichment.getCached(key);
    setPoster(v && v.img, v && (v.imgO || v.img));
    const note = el('div', { class: 'enrich-note' });
    if (epMap) {
      note.append(el('span', { text: 'Episodes from TVmaze.' }));
      note.append(el('button', { class: 'btn secondary', text: '↻ Refetch', onclick: refetch }));
    } else {
      note.append(el('span', { text: failed ? 'Not found on TVmaze.' : 'Showing your watched episodes.' }));
      note.append(el('button', { class: 'btn secondary', text: failed ? '↻ Retry' : 'Load episodes', onclick: refetch }));
    }
    body.append(note);
    renderSeasons(body, datesByEp, epMap, v && v.i, reactsByEp, v && v.iO, ratingByEp);
  };

  const cached = Enrichment.getCached(key);
  if (cached && cached.full && cached.e && Object.keys(cached.e).length) render(cached.e, false);
  else if (cached && cached.f) render(null, true);
  else if (Enrichment.enabled) load();
  else render(null, false);
}

function renderSeasons(container, datesByEp, epMap, imgMap, reactsByEp, imgFullMap, ratingByEp) {
  const full = !!epMap;
  const seasons = {}; // sNum -> { eNum -> title|null }
  const source = full ? Object.keys(epMap) : Object.keys(datesByEp);
  for (const k of source) { const [s, e] = k.split('|'); (seasons[s] ||= {})[e] = full ? epMap[k] : null; }

  const sNums = Object.keys(seasons).sort((a, b) => Number(a) - Number(b));
  if (!sNums.length) { container.append(el('div', { class: 'empty', text: 'No episode data for this show.' })); return; }

  // absolute-episode offsets across regular seasons (season > 0)
  const absOffset = {}; let running = 0;
  for (const s of sNums) if (Number(s) > 0) { absOffset[s] = running; running += Object.keys(seasons[s]).length; }

  for (const s of sNums) {
    const eNums = Object.keys(seasons[s]).sort((a, b) => Number(a) - Number(b));
    const watched = eNums.filter(e => (datesByEp[`${s}|${e}`] || []).length).length;
    const total = eNums.length;
    const complete = total > 0 && watched === total;
    const det = el('details', { class: 'season' });   // collapsed by default
    det.append(el('summary', {}, [
      el('span', { class: 'season-title', text: Number(s) === 0 ? 'Specials' : `Season ${s}` }),
      el('span', { class: 'season-prog' + (complete ? ' complete' : ''), text: `${watched}/${total}` }),
    ]));
    for (const e of eNums) {
      const dates = datesByEp[`${s}|${e}`] || [];
      const c = dates.length;
      const abs = full && Number(s) > 0 ? absOffset[s] + Number(e) : null;
      const numTxt = `S${pad2(s)} · E${pad2(e)}` + (abs ? ` (E${pad2(abs)})` : '');
      const thumb = imgMap && imgMap[`${s}|${e}`];
      const thumbFull = imgFullMap && imgFullMap[`${s}|${e}`];
      det.append(el('div', { class: 'ep-row' }, [
        zoomImg('ep-thumb', thumb, seasons[s][e] || `Episode ${e}`, thumbFull),
        el('div', { class: 'ep-body' }, [
          el('div', { class: 'ep-num', text: numTxt }),
          el('div', { class: 'ep-title' + (c ? '' : ' unseen'), text: seasons[s][e] || `Episode ${e}` }),
          c ? el('div', { class: 'ep-dates' }, dates.map((d, i) => el('span', { text: (i === 0 ? '▶ ' : '↻ ') + fmtDateTime(d) }))) : null,
          (ratingByEp && ratingByEp[`${s}|${e}`]) ? el('div', { class: 'ep-rating', text: `${ratingByEp[`${s}|${e}`].label} · ${ratingByEp[`${s}|${e}`].stars}★` }) : null,
          (reactsByEp && reactsByEp[`${s}|${e}`]) ? el('div', { class: 'ep-reactions', text: [...reactsByEp[`${s}|${e}`]].join(' · ') }) : null,
        ]),
        c ? el('span', { class: 'count-badge' + (c === 1 ? ' once' : ''), text: `×${c}` }) : el('span', { class: 'unwatched-dot' }),
      ]));
    }
    container.append(det);
  }
}

/* ===================================================================
   VIEW: Movies
   =================================================================== */
function renderMovies(root) {
  const movies = STATE.model.movies;
  listView(root, {
    title: 'Movies', subtitle: `${fmtInt(movies.length)} movies`,
    items: movies, searchKeys: ['title'], twoCol: true, stateKey: 'movies',
    searchText: (mv) => `${mv.title} ${movieTitle(mv.title)}`,
    enrichMovies: (slice) => slice.map(mv => mv.title),
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'watched', label: 'Watched', test: mv => mv.watched },
      { id: 'watchlist', label: 'Watchlist', test: mv => mv.status === 'watchlist' },
      { id: 'rated', label: 'Rated', test: mv => !!mv.rating },
      { id: 'reacted', label: 'Reacted', test: mv => mv.reactions.length > 0 },
    ] },
    sorts: [
      { id: 'recent', label: 'Recently watched', fn: (a, b) => (b.watchedAt?.getTime() || 0) - (a.watchedAt?.getTime() || 0) },
      { id: 'rating', label: 'Highest rated', fn: (a, b) => (b.rating?.stars || 0) - (a.rating?.stars || 0) },
      { id: 'runtime', label: 'Longest', fn: (a, b) => b.runtime - a.runtime },
      { id: 'az', label: 'A → Z', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (mv) => el('div', { class: 'item' }, [
      el('div', { class: 'item-main' }, [
        el('div', { class: 'item-title', text: movieTitle(mv.title) }),
        el('div', { class: 'item-meta' }, [
          movieTitle(mv.title) !== mv.title ? el('span', { text: mv.title }) : null,
          mv.runtime ? el('span', { text: fmtDuration(mv.runtime) }) : null,
          mv.rewatches ? el('span', { text: `${mv.rewatches} rewatch` }) : null,
          ...(mv.watchDates.length
            ? mv.watchDates.map((d, i) => el('span', { class: 'watch-date', text: (i === 0 ? '▶ ' : '↻ ') + fmtDate(d) }))
            : (mv.followedAt ? [el('span', { text: `added ${fmtDate(mv.followedAt)}` })] : [])),
        ]),
        mv.reactions.length ? el('div', { class: 'ep-reactions', text: mv.reactions.join(' · ') }) : null,
      ]),
      el('div', { class: 'item-right' }, [
        mv.rating ? ratingChip(mv.rating) : null,
        el('div', { html: '' }), statusBadge(mv.status),
      ]),
    ]),
    exportName: 'tvtime-movies',
    exportRow: (mv) => ({ title: mv.title, status: mv.status || '', watched: mv.watched, watch_count: mv.watchCount, rewatches: mv.rewatches, runtime_seconds: mv.runtime, rating: mv.rating ? mv.rating.label : '', stars: mv.rating ? mv.rating.stars : '', reactions: mv.reactions.join('|'), watched_at: mv.watchedAt ? mv.watchedAt.toISOString() : '', followed_at: mv.followedAt ? mv.followedAt.toISOString() : '', sources: (mv.sources || []).join('|') }),
  });
}

/* ===================================================================
   VIEW: History (timeline)
   =================================================================== */
function historyItem(ev) {
  const info = ev.type === 'episode' ? Enrichment.epInfo(ev.title, ev.seriesId, ev.season, ev.episode) : null;
  const epName = info && info.name;
  const sub = ev.type === 'episode'
    ? `S${ev.season || '?'}·E${ev.episode || '?'}${epName ? ' · ' + epName : ''}${ev.rewatch ? ' · rewatch' : ''}`
    : `Movie${ev.rewatch ? ' · rewatch' : ''}`;
  const kids = [];
  // Thumbnail slot for both types when enrichment is on: episodes get the image,
  // movies get an empty placeholder so rows stay aligned.
  if (Enrichment.enabled) {
    const img = ev.type === 'episode' && info && info.image ? info.image : null;
    kids.push(zoomImg('item-thumb', img, ev.title, info && info.imageFull));
  }
  kids.push(el('div', { class: 'item-main' }, [
    el('div', { class: 'item-title', text: ev.type === 'movie' ? movieTitle(ev.title) : ev.title }),
    el('div', { class: 'item-meta' }, [
      el('span', { text: sub }),
      ev.runtime ? el('span', { text: fmtDuration(ev.runtime) }) : null,
      el('span', { text: fmtDateTime(ev.date) }),
    ]),
  ]));
  kids.push(el('div', { class: 'item-right' }, [
    el('span', { class: 'badge ' + (ev.type === 'movie' ? 'warn' : 'accent'), html: ev.type === 'movie' ? '<i class="ph ph-film-slate"></i>' : '<i class="ph ph-television"></i>' }),
  ]));
  const slug = ev.type === 'episode' ? knownShowSlug(ev.title) : null;
  const item = el('div', { class: 'item' + (slug ? ' clickable' : '') }, kids);
  if (slug) { item.title = 'View episode progress'; item.addEventListener('click', () => navigate({ view: 'shows', detail: slug })); }
  return item;
}

function renderHistory(root) {
  const events = STATE.model.history;
  const saved = STATE.listState.history || {};
  const state = { q: saved.q || '', type: saved.type || 'all', sort: saved.sort || 'recent', page: saved.page || 0, pageSize: 60 };
  const persist = () => { STATE.listState.history = { q: state.q, type: state.type, sort: state.sort, page: state.page }; };

  viewHead(root, 'Watch history', `${fmtInt(events.length)} watch events`);
  const doExport = (fmt) => {
    const rows = computed().map(e => ({ date: e.date ? e.date.toISOString() : '', type: e.type, rewatch: e.rewatch, title: e.title, season: e.season, episode: e.episode, runtime_seconds: e.runtime }));
    if (fmt === 'csv') download('tvtime-history.csv', toCSV(rows), 'text/csv');
    else download('tvtime-history.json', JSON.stringify(rows, null, 2), 'application/json');
  };
  const { search, controls } = buildToolbar(root, { onExport: doExport });
  search.value = state.q;
  const sortSel = el('select', { title: 'Sort' });
  for (const [v, l] of [['recent', 'Newest first'], ['oldest', 'Oldest first']]) sortSel.append(el('option', { value: v, text: l }));
  sortSel.value = state.sort;
  const typeSel = el('select', { title: 'Filter' });
  for (const [v, l] of [['all', 'All'], ['episode', 'Episodes'], ['movie', 'Movies'], ['rewatch', 'Rewatches only']]) typeSel.append(el('option', { value: v, text: l }));
  typeSel.value = state.type;
  const countPill = el('span', { class: 'count-pill' });
  controls.append(sortSel, typeSel, countPill);

  const container = el('div');
  const pager = el('div', { class: 'pager' });
  root.append(container, pager);

  function computed() {
    let items = events;
    if (state.type === 'rewatch') items = items.filter(e => e.rewatch);
    else if (state.type !== 'all') items = items.filter(e => e.type === state.type);
    if (state.q) {
      const q = norm(state.q);
      items = items.filter(e => norm(e.title).includes(q) || (e.type === 'movie' && norm(movieTitle(e.title)).includes(q)));
    }
    if (state.sort === 'oldest') items = [...items].reverse();   // base list is newest-first
    return items;
  }
  function draw() {
    const items = computed();
    countPill.hidden = items.length === events.length;
    countPill.textContent = `${fmtInt(items.length)} of ${fmtInt(events.length)}`;
    const pages = Math.max(1, Math.ceil(items.length / state.pageSize));
    state.page = Math.min(state.page, pages - 1);
    const slice = items.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
    container.innerHTML = '';
    let lastDay = null;
    const wrap = el('div', { class: 'cards' });
    for (const ev of slice) {
      const day = ev.date ? ev.date.toDateString() : 'Unknown date';
      if (day !== lastDay) { container.append(wrap.childNodes.length ? wrap.cloneNode(true) : document.createComment('')); wrap.innerHTML = ''; container.append(el('div', { class: 'day-divider', text: ev.date ? fmtDate(ev.date) : 'Unknown date' })); lastDay = day; const nw = el('div', { class: 'cards' }); container.append(nw); wrap._cur = nw; }
      (wrap._cur || wrap).append(historyItem(ev));
    }
    pager.innerHTML = '';
    if (pages > 1) {
      pager.append(
        el('button', { text: '‹ Prev', disabled: state.page === 0 ? '' : false, onclick: () => { state.page--; draw(); window.scrollTo(0, 0); } }),
        el('span', { text: `Page ${state.page + 1} of ${pages}` }),
        el('button', { text: 'Next ›', disabled: state.page >= pages - 1 ? '' : false, onclick: () => { state.page++; draw(); window.scrollTo(0, 0); } }),
      );
    }

    // Lazily fetch episode titles/thumbnails for the shows on this page; redraw when they arrive.
    if (Enrichment.enabled) {
      Enrichment.ensure(slice.filter(e => e.type === 'episode'), true)
        .then(n => { if (n > 0 && STATE.view === 'watch-history') draw(); });
    }
    if (MovieMeta.enabled) {
      MovieMeta.ensure(slice.filter(e => e.type === 'movie').map(e => e.title))
        .then(n => { if (n > 0 && STATE.view === 'watch-history') draw(); });
    }
    persist();
  }
  search.addEventListener('input', () => { state.q = search.value; state.page = 0; draw(); });
  sortSel.addEventListener('change', () => { state.sort = sortSel.value; state.page = 0; draw(); });
  typeSel.addEventListener('change', () => { state.type = typeSel.value; state.page = 0; draw(); });
  draw();
}

/* ===================================================================
   VIEW: Ratings — genuine show star ratings (tv_show_rate, 1–5)
   =================================================================== */
// Star + word chip for a rating {stars, label}.
function ratingChip(r) {
  return el('div', { class: 'rating-chip', title: `${r.label} (${r.stars}/5)` }, [
    el('span', { text: r.label }), el('span', { class: 'star', text: ` ${r.stars}★` }),
  ]);
}

function renderRatings(root) {
  const list = STATE.model.ratings.list;
  if (!list.length) {
    viewHead(root, 'Ratings', '');
    root.append(el('div', { class: 'empty', text: 'No ratings.' }));
    return;
  }
  const KIND = { show: 'Show', movie: 'Movie', episode: 'Episode' };
  listView(root, {
    title: 'Ratings', subtitle: `${fmtInt(list.length)} rated`, items: list, stateKey: 'ratings',
    searchText: (r) => `${r.title} ${r.kind === 'movie' ? movieTitle(r.title) : ''}`,
    enrichShows: (slice) => slice.filter(r => r.kind !== 'movie').map(r => showPosterItem(r.title)),
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'show', label: 'Shows', test: r => r.kind === 'show' },
      { id: 'movie', label: 'Movies', test: r => r.kind === 'movie' },
      { id: 'episode', label: 'Episodes', test: r => r.kind === 'episode' },
    ] },
    sorts: [
      { id: 'recent', label: 'Recently rated', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'oldest', label: 'Oldest rated', fn: (a, b) => (a.date?.getTime() || Infinity) - (b.date?.getTime() || Infinity) },
      { id: 'score', label: 'Highest rated', fn: (a, b) => b.stars - a.stars || a.title.localeCompare(b.title) },
      { id: 'az', label: 'A → Z', fn: (a, b) => a.title.localeCompare(b.title) },
      { id: 'kind', label: 'By type', fn: (a, b) => a.kind.localeCompare(b.kind) || b.stars - a.stars },
    ],
    renderItem: (r) => {
      const main = [
        el('div', { class: 'item-title', text: r.kind === 'movie' ? movieTitle(r.title) : r.title }),
        el('div', { class: 'item-meta' }, [
          el('span', { class: 'badge dim', text: KIND[r.kind] || r.kind }),
          r.kind === 'episode' && (r.season || r.episode) ? el('span', { text: `S${r.season || '?'}·E${r.episode || '?'}` }) : null,
          r.date ? el('span', { text: fmtDate(r.date) }) : null,
        ]),
      ];
      // showLineItem gives every row the poster slot (movies get a blank spacer) and
      // opens the show detail for shows/episodes; movies have no detail page.
      return showLineItem(r.title, null, main, [ratingChip(r)]);
    },
    exportName: 'tvtime-ratings',
    exportRow: (r) => ({ kind: r.kind, title: r.title, stars: r.stars, label: r.label, season: r.season ?? '', episode: r.episode ?? '', rated_at: r.date ? r.date.toISOString() : '' }),
  });
}

/* ===================================================================
   VIEW: Reactions — finish-episode / finish-movie reactions
   (vote files + episode_emotion) with per-show totals summary.
   =================================================================== */
function renderReactions(root) {
  const model = STATE.model;
  const items = model.reactions.grouped;   // one row per episode/movie, many feelings each

  // per-show reaction totals summary
  const perShow = Object.entries(model.emotionPerShow).map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
  const titleByKey = {};
  for (const s of model.shows) titleByKey[norm(s.title)] = s.title;

  listView(root, {
    title: 'Reactions',
    subtitle: `${fmtInt(items.length)} reacted`,
    items,
    beforeList: (container) => {
      if (!perShow.length) return;
      container.append(el('div', { class: 'section-title', text: 'Shows you reacted to most' }));
      const cards = el('div', { class: 'cards two-col' });
      for (const r of perShow.slice(0, 8)) {
        const title = titleByKey[r.key] || r.key;
        cards.append(showLineItem(title, null,
          [ el('div', { class: 'item-title', text: title }) ],
          [ el('span', { class: 'badge accent', html: `<i class="ph ph-heart"></i> ${fmtInt(r.count)}` }) ]));
      }
      container.append(cards);
      container.append(el('div', { class: 'section-title', text: 'Every reaction' }));
    },
    stateKey: 'reactions', enrichFull: true,
    searchText: (r) => r.kind === 'movie' ? `${r.title} ${movieTitle(r.title)}` : r.title,
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'episode', label: 'Episodes', test: r => r.kind === 'episode' },
      { id: 'movie', label: 'Movies', test: r => r.kind === 'movie' },
    ] },
    enrichShows: (slice) => slice.filter(r => r.kind === 'episode').map(r => ({ seriesId: Enrichment.seriesIdByName[norm(r.title)], title: r.title })),
    enrichMovies: (slice) => slice.filter(r => r.kind === 'movie').map(r => r.title),
    sorts: [
      // Watch-date proxy; entities with no watch date (reacted without a watch record) sort last.
      { id: 'recent', label: 'Recently watched', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'oldest', label: 'Oldest first', fn: (a, b) => (a.date?.getTime() || Infinity) - (b.date?.getTime() || Infinity) },
      { id: 'most', label: 'Most feelings', fn: (a, b) => b.reactions.length - a.reactions.length },
      { id: 'az', label: 'A → Z', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (r) => {
      const info = r.kind === 'episode' ? Enrichment.epInfo(r.title, null, r.season, r.episode) : null;
      const epName = info && info.name;
      const kids = [];
      if (Enrichment.enabled) {
        const img = r.kind === 'episode' && info && info.image ? info.image : null;
        kids.push(zoomImg('item-thumb', img, r.title, info && info.imageFull));
      }
      kids.push(el('div', { class: 'item-main' }, [
        el('div', { class: 'item-title', text: r.kind === 'movie' ? movieTitle(r.title) : r.title }),
        el('div', { class: 'item-meta' }, [
          el('span', { class: 'badge ' + (r.kind === 'movie' ? 'warn' : 'accent'), text: r.kind }),
          r.kind === 'episode' && (r.season || r.episode) ? el('span', { text: `S${r.season || '?'}·E${r.episode || '?'}${epName ? ' · ' + epName : ''}` }) : null,
          r.date ? el('span', { text: fmtDate(r.date) }) : null,
        ]),
        el('div', { class: 'reaction-chips' }, r.reactions.map(l => el('span', { class: 'badge accent', text: l }))),
      ]));
      const slug = r.kind === 'episode' ? knownShowSlug(r.title) : null;
      const item = el('div', { class: 'item' + (slug ? ' clickable' : '') }, kids);
      if (slug) { item.title = 'View episode progress'; item.addEventListener('click', () => navigate({ view: 'shows', detail: slug })); }
      return item;
    },
    exportName: 'tvtime-reactions',
    exportRow: (r) => ({ kind: r.kind, title: r.title, season: r.season ?? '', episode: r.episode ?? '', feelings: r.reactions.join(' | '), watched_at: r.date ? r.date.toISOString() : '' }),
  });

  // Posters for the "reacted to most" summary (its cards live outside the paginated list).
  ensureShowPosters(perShow.slice(0, 8).map(r => showPosterItem(titleByKey[r.key] || r.key)));
}

/* ===================================================================
   VIEW: Lists
   =================================================================== */
function renderLists(root) {
  const lists = STATE.model.lists;
  const showSlugs = new Set(STATE.model.shows.map(s => slugify(s.title)));   // which chips can open a detail
  viewHead(root, 'Lists', lists.length ? `${lists.length} lists` : '');
  if (!lists.length) { root.append(el('div', { class: 'empty', text: 'No lists found.' })); return; }

  for (const l of lists) {
    const det = el('details', { class: 'list-card' });
    const cover = l.cover
      ? el('img', { class: 'list-cover', src: l.cover, loading: 'lazy', alt: '' })
      : el('div', { class: 'list-cover' });
    const kindLabel = l.kind === 'movie' ? 'movies' : l.kind === 'series' ? 'shows' : 'items';
    det.append(el('summary', {}, [
      cover,
      el('div', { class: 'list-info' }, [
        el('div', { class: 'list-name', text: l.name }),
        el('div', { class: 'list-sub', text: `${fmtInt(l.items.length)} ${kindLabel}` }),
      ]),
      el('span', { class: 'badge ' + (l.isPublic ? 'good' : 'dim'), text: l.isPublic ? 'Public' : 'Private' }),
    ]));
    const chips = el('div', { class: 'list-items' });
    for (const it of l.items) {
      const label = it.title ? (it.type === 'movie' ? movieTitle(it.title) : it.title) : `${it.type || 'item'} ${it.id || it.uuid || '?'}`;
      const slug = it.type === 'series' && it.title ? slugify(it.title) : null;
      const clickable = slug && showSlugs.has(slug);
      const chip = el('span', { class: 'list-item-chip' + (it.title ? '' : ' unknown') + (clickable ? ' clickable' : '') }, [
        el('i', { class: it.type === 'movie' ? 'ph ph-film-slate' : 'ph ph-television' }), ' ' + label,
      ]);
      if (clickable) chip.addEventListener('click', () => navigate({ view: 'shows', detail: slug }));
      chips.append(chip);
    }
    det.append(chips);
    root.append(det);
  }
}

/* ===================================================================
   VIEW: Comments — your posts, with attached images
   =================================================================== */

// Ordered image sources to try for one attachment, best first:
//   clean (no TV Time watermark) before marked, and a local backup before the live
//   CDN copy within each. Ends with an "unavailable" placeholder.
function imageCandidates(m) {
  const out = [];
  const add = (u) => { if (u && !out.includes(u)) out.push(u); };
  add(Backup.urlFor('comments/' + m.id + '-clean'));   // local clean backup (foldered)
  add(Backup.urlFor(m.id + '-clean'));                 // …or legacy flat zip
  add(m.clean);                                             // live clean
  add(Backup.urlFor('comments/' + m.id + '-marked'));  // local marked backup (foldered)
  add(Backup.urlFor(m.id + '-marked'));                // …or legacy flat zip
  add(Backup.urlFor(m.id));                            // …or very old single-file zip
  add(m.url);                                               // live marked
  out.push(BROKEN_IMG);
  return out;
}

function commentImageEl(m) {
  const cands = imageCandidates(m);
  let idx = 0;
  const img = el('img', {
    class: 'cmt-img', loading: 'lazy',
    alt: m.kind === 'gif' ? 'Attached gif' : 'Attached image',
    src: cands[0],
  });
  if (cands[0] === BROKEN_IMG) img.classList.add('broken');
  // Walk down the list as sources fail (e.g. a retired server or a missing variant).
  img.addEventListener('error', () => {
    if (idx < cands.length - 1) { img.src = cands[++idx]; }
    if (cands[idx] === BROKEN_IMG) img.classList.add('broken');
  });
  return el('button', {
    class: 'cmt-img-btn', title: 'View image',
    onclick: () => openLightbox(img.currentSrc || img.src),
  }, [img]);
}

// Open a file picker for a backup zip and import it. cb(err, count) on completion.
function pickBackup(cb) {
  const inp = el('input', { type: 'file', accept: '.zip,application/zip', hidden: '' });
  document.body.append(inp);
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0]; inp.remove();
    if (!f) return;
    try { cb(null, await Backup.importZip(f)); }
    catch (e) { cb(e); }
  });
  inp.click();
}

const COMMENT_ICON = { episode: 'ph-television', show: 'ph-television', series: 'ph-television', movie: 'ph-film-slate', profile: 'ph-user' };

function renderComments(root) {
  const c = STATE.model.comments;
  const subtitle = c.imageCount
    ? `${fmtInt(c.list.length)} comments · ${fmtInt(c.imageCount)} image${c.imageCount === 1 ? '' : 's'}`
    : `${fmtInt(c.list.length)} comments`;

  listView(root, {
    title: 'Comments', subtitle, items: c.list, stateKey: 'comments',
    searchText: (e) => `${e.text} ${e.target}`,
    beforeList: c.imageCount ? (pre) => pre.append(commentBackupBanner()) : null,
    filter: { default: 'all', options: [
      { id: 'all', label: 'All comments', test: () => true },
      { id: 'images', label: 'With image', test: e => e.images.length > 0 },
      { id: 'episode', label: 'On episodes', test: e => e.kind === 'episode' },
      { id: 'show', label: 'On shows', test: e => e.kind === 'show' || e.kind === 'series' },
      { id: 'movie', label: 'On movies', test: e => e.kind === 'movie' },
      { id: 'profile', label: 'On profiles', test: e => e.kind === 'profile' },
      { id: 'replies', label: 'Replies', test: e => e.isReply },
    ] },
    sorts: [
      { id: 'recent', label: 'Newest first', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'oldest', label: 'Oldest first', fn: (a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0) },
      { id: 'likes', label: 'Most liked', fn: (a, b) => b.likes - a.likes },
    ],
    renderItem: (e) => {
      // Header: what it's on (+ S..E.. for episodes), clickable to the show when known.
      const label = e.kind === 'episode' && e.season
        ? `${e.target} · S${pad2(e.season)}E${pad2(e.episode)}`
        : (e.target || '—');
      const targetEl = el('span', { class: 'cmt-target' + (e.slug ? ' clickable' : '') }, [
        el('i', { class: 'ph ' + (COMMENT_ICON[e.kind] || 'ph-chat-circle-text') }), ' ' + label,
      ]);
      if (e.slug) targetEl.addEventListener('click', () => navigate({ view: 'shows', detail: e.slug }));

      const kids = [el('div', { class: 'cmt-head' }, [targetEl, el('span', { class: 'cmt-date', text: fmtDate(e.date) })])];

      if (e.isReply) {
        kids.push(e.parent
          ? el('div', { class: 'cmt-parent' }, [el('i', { class: 'ph ph-arrow-bend-up-left' }), el('span', { text: truncate(e.parent.text, 140) })])
          : el('div', { class: 'cmt-parent muted' }, [el('i', { class: 'ph ph-arrow-bend-up-left' }), el('span', { text: 'Reply — original comment isn’t in the export' })]));
      }

      if (e.text) kids.push(el('div', { class: 'cmt-text', text: e.text }));
      if (e.images.length) kids.push(el('div', { class: 'cmt-images' }, e.images.map(commentImageEl)));

      const meta = [];
      if (e.likes) meta.push(el('span', { html: `<i class="ph-fill ph-heart" style="color:var(--accent)"></i> ${fmtInt(e.likes)}` }));
      if (e.images.length) meta.push(el('span', { html: `<i class="ph ph-image"></i> ${fmtInt(e.images.length)}` }));
      if (meta.length) kids.push(el('div', { class: 'cmt-metaline' }, meta));

      return el('article', { class: 'cmt' }, kids);
    },
    exportName: 'tvtime-comments',
    exportRow: (e) => ({
      date: e.date ? e.date.toISOString() : '', kind: e.kind, on: e.target,
      season: e.season ?? '', episode: e.episode ?? '',
      text: e.text, likes: e.likes, is_reply: e.isReply ? 'yes' : 'no',
      images: e.images.map(m => m.url).join(' '),
    }),
  });
}

// Banner above the comments list: image status + one action.
// With a backup loaded, images come from the local copy, so the action becomes
// "Clear backup"; otherwise it's "Import backup".
function commentBackupBanner() {
  const wrap = el('div', { class: 'cmt-backup' });
  const n = Backup.countComments();

  const readme = 'https://github.com/Remls/TVTimeArchive#extended-backup';
  const status = el('div', { class: 'cmt-backup-status' }, [
    el('div', { class: 'cmt-backup-title' }, [el('i', { class: 'ph ph-images' }), el('strong', { text: 'Comment images' })]),
    n
      ? el('p', { text: `${fmtInt(n)} saved locally.` })
      : el('p', {}, ['Loaded live from TV Time. ',
          el('a', { href: readme, target: '_blank', rel: 'noopener noreferrer', text: 'Back them up' }),
          ' before the servers close.']),
  ]);

  // Redraw the whole view so images swap between local copies and live URLs.
  const refresh = () => { if (STATE.view === 'comments') renderView('comments'); };

  let btn;
  if (n) {
    btn = el('button', { class: 'btn secondary', html: '<i class="ph ph-trash"></i> Clear backup' });
    btn.addEventListener('click', async () => { await Backup.clear(); refresh(); });
  } else {
    btn = el('button', { class: 'btn secondary', html: '<i class="ph ph-upload-simple"></i> Import backup' });
    btn.addEventListener('click', () => pickBackup((err) => {
      if (err) { btn.innerHTML = '<i class="ph ph-warning"></i> ' + (err.message || 'Import failed'); return; }
      refreshExtended(); refresh();
    }));
  }
  wrap.append(status, btn);
  return wrap;
}

/* ===================================================================
   VIEW: Activity — read-only notifications feed
   =================================================================== */
const NOTIF_BADGE_CLASS = { follow: 'accent', mention: 'accent', badge: 'warn', airing: 'good' };

function renderNotifications(root) {
  const { list } = STATE.model.notifications;
  if (!list.length) {
    viewHead(root, 'Notifications', '');
    root.append(el('div', { class: 'empty', text: 'No notifications in this archive.' }));
    return;
  }
  listView(root, {
    title: 'Notifications', subtitle: `${fmtInt(list.length)} notifications`,
    items: list, stateKey: 'notifications',
    searchText: (n) => n.text,
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'like', label: 'Likes', test: n => n.cat === 'like' },
      { id: 'reply', label: 'Replies', test: n => n.cat === 'reply' },
      { id: 'mention', label: 'Mentions', test: n => n.cat === 'mention' },
      { id: 'follow', label: 'Follows', test: n => n.cat === 'follow' },
      { id: 'badge', label: 'Badges', test: n => n.cat === 'badge' },
      { id: 'airing', label: 'Airing', test: n => n.cat === 'airing' },
    ] },
    sorts: [
      { id: 'recent', label: 'Newest first', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'oldest', label: 'Oldest first', fn: (a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0) },
    ],
    renderItem: (n) => {
      const ref = n.img;
      const kids = [];
      if (ref && ref.kind === 'avatar') {
        kids.push(avatarEl(ref.url, (n.text || '').split(/\s+/)[0], n.senderId && 'avatars/' + n.senderId, 'md'));
      } else if (ref) {
        kids.push(el('div', { class: 'notif-thumb' }, [resilientImg(ref.key, ref.url, { alt: '' })]));
      } else {
        kids.push(el('div', { class: 'notif-thumb empty' }));
      }
      kids.push(el('div', { class: 'item-main' }, [
        el('div', { class: 'notif-text', text: n.text || '—' }),
        el('div', { class: 'item-meta' }, [n.date ? el('span', { text: fmtDate(n.date) }) : null]),
      ]));
      kids.push(el('div', { class: 'item-right' }, [
        el('span', { class: 'badge ' + (NOTIF_BADGE_CLASS[n.cat] || ''), text: NOTIF_CAT_LABEL[n.cat] || n.cat }),
      ]));
      return el('div', { class: 'item notif' }, kids);
    },
    exportName: 'tvtime-notifications',
    exportRow: (n) => ({ date: n.date ? n.date.toISOString() : '', type: n.type, category: n.cat, text: n.text }),
  });
}

/* ===================================================================
   VIEW: Badges — earned badges grouped by type
   =================================================================== */
function renderBadges(root) {
  const { list, total } = STATE.model.badges;
  if (!list.length) {
    viewHead(root, 'Badges', '');
    root.append(el('div', { class: 'empty', text: 'No badges in this archive.' }));
    return;
  }
  listView(root, {
    title: 'Badges', subtitle: `${fmtInt(total)} earned · ${fmtInt(list.length)} types`,
    items: list, stateKey: 'badges', twoCol: true,
    searchText: (g) => g.name,
    sorts: [
      { id: 'count', label: 'Most earned', fn: (a, b) => b.count - a.count || (b.last?.getTime() || 0) - (a.last?.getTime() || 0) },
      { id: 'recent', label: 'Recently earned', fn: (a, b) => (b.last?.getTime() || 0) - (a.last?.getTime() || 0) },
      { id: 'az', label: 'A → Z', fn: (a, b) => a.name.localeCompare(b.name) },
    ],
    renderItem: (g) => {
      const art = g.art
        ? el('div', { class: 'badge-art' }, [resilientImg(g.art.key, g.art.image, { alt: '' })])
        : el('div', { class: 'badge-art empty' }, [el('i', { class: 'ph ph-seal-check' })]);
      const head = [
        art,
        el('div', { class: 'item-main' }, [
          el('div', { class: 'item-title', text: g.name }),
          el('div', { class: 'item-meta' }, [
            g.last ? el('span', { text: `last ${fmtDate(g.last)}` }) : null,
            g.count > 1 && g.first ? el('span', { text: `since ${fmtDate(g.first)}` }) : null,
          ]),
        ]),
        el('div', { class: 'item-right' }, [g.count > 1 ? el('div', { class: 'rating-chip', text: `×${fmtInt(g.count)}` }) : null]),
      ];
      // No per-show data (one-off account badges) -> a plain card.
      if (!g.shows.length) return el('div', { class: 'item' }, head);

      // Per-show badge -> expandable card listing the shows it was earned for.
      const det = el('details', { class: 'badge-card' });
      det.append(el('summary', {}, [...head, el('i', { class: 'ph ph-caret-down badge-caret' })]));
      const chips = el('div', { class: 'badge-shows' });
      for (const s of g.shows) {
        const label = s.name || `Show #${s.id}`;
        const slug = s.name ? knownShowSlug(s.name) : null;
        const chip = el('span', { class: 'list-item-chip' + (s.name ? '' : ' unknown') + (slug ? ' clickable' : '') }, [
          el('i', { class: 'ph ph-television' }), ' ' + label,
        ]);
        if (slug) chip.addEventListener('click', () => navigate({ view: 'shows', detail: slug }));
        chips.append(chip);
      }
      det.append(chips);
      return det;
    },
    exportName: 'tvtime-badges',
    exportRow: (g) => ({ badge: g.name, type: g.key, count: g.count, first_earned: g.first ? g.first.toISOString() : '', last_earned: g.last ? g.last.toISOString() : '', shows: g.shows.map(s => s.name || `#${s.id}`).join(' | ') }),
  });
}

/* ===================================================================
   VIEW: Characters — characters you voted for (names/posters from the extended backup)
   =================================================================== */
// Prompt to import the extended backup when names/images haven't been resolved yet.
function extendedNote(unresolved, total) {
  if (!unresolved) return null;
  return el('div', { class: 'cmt-backup' }, [
    el('div', { class: 'cmt-backup-status' }, [
      el('div', { class: 'cmt-backup-title' }, [el('i', { class: 'ph ph-info' }), el('strong', { text: 'Names & images' })]),
      el('p', {}, [`${fmtInt(unresolved)} of ${fmtInt(total)} still show IDs only. `,
        el('a', { href: 'https://github.com/Remls/TVTimeArchive#extended-backup', target: '_blank', rel: 'noopener noreferrer', text: 'Generate an extended backup' }),
        ' and import it (⚙) to fill these in.']),
    ]),
  ]);
}

function renderCharacters(root) {
  const list = STATE.model.characters;
  if (!list.length) {
    viewHead(root, 'Character votes', '');
    root.append(el('div', { class: 'empty', text: 'No character votes in this archive.' }));
    return;
  }
  const unresolved = list.filter(c => !c.name).length;
  listView(root, {
    title: 'Character votes', subtitle: `${fmtInt(list.length)} voted for`, items: list, stateKey: 'character-votes', twoCol: true,
    searchText: (c) => `${c.name || ''} ${c.actor || ''} ${c.shows.join(' ')}`,
    beforeList: unresolved ? (pre) => pre.append(extendedNote(unresolved, list.length)) : null,
    sorts: [
      { id: 'recent', label: 'Recently voted', fn: (a, b) => (b.lastDate?.getTime() || 0) - (a.lastDate?.getTime() || 0) },
      { id: 'votes', label: 'Most voted', fn: (a, b) => b.votes.length - a.votes.length },
      { id: 'az', label: 'A → Z', fn: (a, b) => (a.name || 'zzz~').localeCompare(b.name || 'zzz~') },
    ],
    renderItem: (c) => {
      const psrc = Backup.urlFor('characters/' + c.id) || c.poster || null;
      const shows = el('div', { class: 'char-shows' }, c.shows.map(sn => {
        const slug = knownShowSlug(sn);
        const chip = el('span', { class: 'list-item-chip' + (slug ? ' clickable' : '') }, [el('i', { class: 'ph ph-television' }), ' ' + sn]);
        if (slug) chip.addEventListener('click', () => navigate({ view: 'shows', detail: slug }));
        return chip;
      }));
      return el('div', { class: 'item' }, [
        zoomImg('item-poster', psrc, c.name || `Character #${c.id}`, c.poster),
        el('div', { class: 'item-main' }, [
          el('div', { class: 'item-title', text: c.name || `Character #${c.id}` }),
          el('div', { class: 'item-meta' }, [
            c.actor ? el('span', { text: c.actor }) : null,
            el('span', { html: `<b>${fmtInt(c.votes.length)}</b> vote${c.votes.length === 1 ? '' : 's'}` }),
            c.lastDate ? el('span', { text: fmtDate(c.lastDate) }) : null,
          ]),
          c.shows.length ? shows : null,
        ]),
      ]);
    },
    exportName: 'tvtime-characters',
    exportRow: (c) => ({ id: c.id, name: c.name || '', actor: c.actor || '', shows: c.shows.join(' | '), votes: c.votes.length, last_voted: c.lastDate ? c.lastDate.toISOString() : '' }),
  });
}

/* ===================================================================
   VIEW: Friends — your friends (names/avatars from the extended backup)
   =================================================================== */
function renderFriends(root) {
  const list = STATE.model.friends;
  if (!list.length) {
    viewHead(root, 'Friends', '');
    root.append(el('div', { class: 'empty', text: 'No friends in this archive.' }));
    return;
  }
  const unresolved = list.filter(f => !f.name).length;
  listView(root, {
    title: 'Friends', subtitle: `${fmtInt(list.length)} friends`, items: list, stateKey: 'friends', twoCol: true,
    searchText: (f) => `${f.name || ''} ${f.username || ''}`,
    beforeList: unresolved ? (pre) => pre.append(extendedNote(unresolved, list.length)) : null,
    sorts: [
      { id: 'az', label: 'A → Z', fn: (a, b) => (a.name || 'zzz~').localeCompare(b.name || 'zzz~') },
      { id: 'affinity', label: 'Closest (affinity)', fn: (a, b) => b.affinity - a.affinity },
      { id: 'recent', label: 'Recently added', fn: (a, b) => (b.since?.getTime() || 0) - (a.since?.getTime() || 0) },
    ],
    renderItem: (f) => el('div', { class: 'item' }, [
      avatarEl(f.avatar, f.name || `#${f.id}`, 'friends/' + f.id, 'md'),
      el('div', { class: 'item-main' }, [
        el('div', { class: 'item-title', text: f.name || `Friend #${f.id}` }),
        el('div', { class: 'item-meta' }, [
          f.username ? el('span', { text: '@' + f.username }) : null,
          f.since ? el('span', { text: `since ${fmtDate(f.since)}` }) : null,
          f.affinity ? el('span', { text: `affinity ${fmtInt(f.affinity)}` }) : null,
        ]),
      ]),
    ]),
    exportName: 'tvtime-friends',
    exportRow: (f) => ({ id: f.id, name: f.name || '', username: f.username || '', affinity: f.affinity, since: f.since ? f.since.toISOString() : '' }),
  });
}

/* ===================================================================
   VIEW: Profile
   =================================================================== */
function renderProfile(root) {
  const p = STATE.model.profile;

  // Hero: cover fills the top and fades into the page; avatar + name centred over it.
  const cover = (p.personal || {}).cover;
  const hasCover = nonEmpty(cover) && /^https?:\/\//.test(cover);
  const hero = el('div', { class: 'profile-hero' + (hasCover ? '' : ' no-cover') });
  if (hasCover) hero.append(el('div', { class: 'profile-hero-bg', style: `background-image:url("${cover.replace(/"/g, '%22')}")` }));
  hero.append(el('div', { class: 'profile-hero-body' }, [
    avatarEl(p.avatar, p.displayName, p.userId && 'avatars/' + p.userId, 'xl'),
    el('div', { class: 'profile-hero-name', text: p.displayName || '—' }),
    p.username && p.username !== p.displayName ? el('div', { class: 'profile-hero-sub', text: '@' + p.username }) : null,
  ]));
  root.append(hero);

  root.append(el('div', { class: 'section-title', text: 'Account details' }));
  const rows = [
    ['Name', p.name], ['Username', p.username], ['Email', p.email], ['Language', p.language], ['Timezone', p.timezone],
    ['Member since', fmtDate(p.createdAt)], ['Last opened', fmtDateTime(p.lastOpened)],
    ['Days active', p.daysActive], ['Weeks active', p.weeksActive], ['Months active', p.monthsActive],
  ].filter(([, v]) => nonEmpty(v) && v !== '—');
  const dl = el('dl', { class: 'kv' });
  for (const [k, v] of rows) { dl.append(el('dt', { text: k }), el('dd', { text: v })); }
  root.append(dl);

  // extra personal-data key/values (cover is the hero background, not a row)
  const extra = Object.entries(p.personal || {}).filter(([k, v]) => nonEmpty(v) && k !== 'cover');
  if (extra.length) {
    root.append(el('div', { class: 'section-title', text: 'Personal data' }));
    const dl2 = el('dl', { class: 'kv' });
    for (const [k, v] of extra) { dl2.append(el('dt', { text: k }), el('dd', { text: v })); }
    root.append(dl2);
  }
}

/* ===================================================================
   VIEW: Raw — browse every CSV in the archive as a table
   =================================================================== */
function renderRaw(root) {
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
      el('button', { text: '‹ Prev', disabled: state.page === 0 ? '' : false, onclick: () => { state.page--; draw(); } }),
      el('span', { text: `Page ${state.page + 1} of ${pages}` }),
      el('button', { text: 'Next ›', disabled: state.page >= pages - 1 ? '' : false, onclick: () => { state.page++; draw(); } }),
    );
    persist();
  }
  picker.addEventListener('change', () => { state.file = picker.value; state.q = ''; search.value = ''; state.page = 0; state.sortCol = null; state.sortDir = 1; draw(); });
  search.addEventListener('input', () => { state.q = search.value; state.page = 0; draw(); });
  draw();
}

/* ===================================================================
   Wire up landing screen
   =================================================================== */
function initLanding() {
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
    if (activeLightbox) { const r = activeLightbox; activeLightbox = null; r(); return; }
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
