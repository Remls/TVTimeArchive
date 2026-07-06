import { $ } from './util.js';

/* -------------------------------------------------------------------
   Local persistence of the loaded archive via IndexedDB (never uploaded).
   Stores the original .zip blob so it can be re-parsed on the next visit.
   ------------------------------------------------------------------- */
export const IDB = {
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
export const Backup = {
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
export const Extended = {
  characters: {},   // show_character_id -> { id, name, actor_name, poster, votes }
  friends: {},      // friend_id -> { id, name, username, avatar }
  load() {
    this.characters = {}; this.friends = {};
    try { for (const c of JSON.parse(localStorage.getItem('tvt.characters') || '[]')) this.characters[String(c.id)] = c; } catch {}
    try { for (const f of JSON.parse(localStorage.getItem('tvt.friends') || '[]')) this.friends[String(f.id)] = f; } catch {}
  },
};
