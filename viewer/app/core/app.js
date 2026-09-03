/* -------------------------------------------------------------------
   Per-app configuration. Two apps share this codebase (the TV Time
   viewer at / and the Refract viewer at /refract); each page calls
   configureApp() with its own config before initLanding(). One app per
   page, mirroring the STATE singleton.
   ------------------------------------------------------------------- */
import { STATE } from './state.js';

export const APP = {
  brand: { title: '' },
  views: [],     // [{ id, label, icon, render, available?(model), fallback? }]
  groups: {},    // groupId -> { label, icon, children:[viewId] } (children contiguous in views)
  groupOf: {},   // viewId -> groupId (derived)
  detail: {},    // viewId -> { find(slug), open(item) } for #/<view>/<slug> routes
  buildModel: null,   // (tables) -> model
  archive: null,      // { put, get, clear } per-app zip store (storage.makeArchiveStore)
  beforeModel: null,  // () -> void, before buildModel
  afterModel: null,   // async (model) -> void, after buildModel
  statuses: {},       // status -> [badgeClass, label] for kit.statusBadge
  settingsExtras: null, // ({ makeClear, refresh }) -> { items:[], clears:[] } | null
  crossLink: null,    // { label, href } -> settings entry that opens the sibling viewer
};

export function configureApp(cfg) {
  Object.assign(APP, cfg);
  APP.groupOf = {};
  for (const [gid, g] of Object.entries(APP.groups || {})) for (const c of g.children) APP.groupOf[c] = gid;
}

/* The views the loaded export actually supports. A view without an `available`
   predicate always shows; one whose data the export doesn't carry (Anime, which
   only Refract v1 distinguishes) is left out of the nav and the router. */
export const activeViews = () => APP.views.filter(v => !v.available || (STATE.model && v.available(STATE.model)));

// Where to send a request for a view this export doesn't have.
export const viewFallback = (id) => {
  const v = APP.views.find(x => x.id === id);
  return (v && v.fallback) || 'home';
};
