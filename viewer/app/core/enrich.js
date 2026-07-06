import { $, norm } from './util.js';

/* -------------------------------------------------------------------
   Global loading indicator — the top bar animates while any async
   work (currently TVmaze fetches) is in flight.
   ------------------------------------------------------------------- */
export const Progress = {
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
export const Enrichment = {
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
export const FILM_P31 = new Set(['Q11424', 'Q24856', 'Q202866', 'Q29168811', 'Q506240', 'Q24862', 'Q20650540', 'Q24869', 'Q130232', 'Q17517379', 'Q842256', 'Q59755569', 'Q18011172', 'Q353834', 'Q157443', 'Q1054574']);

export const WD = 'https://www.wikidata.org/w/api.php?format=json&origin=*&';

export const MovieMeta = {
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
export const movieTitle = (title) => MovieMeta.titleFor(title) || title;
