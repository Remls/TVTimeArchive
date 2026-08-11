/* -------------------------------------------------------------------
   Per-app configuration. Two apps share this codebase (the TV Time
   viewer at / and the Refract viewer at /refract); each page calls
   configureApp() with its own config before initLanding(). One app per
   page, mirroring the STATE singleton.
   ------------------------------------------------------------------- */
export const APP = {
  brand: { title: '' },
  views: [],     // [{ id, label, icon, render }]
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
