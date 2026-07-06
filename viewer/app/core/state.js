/* -------------------------------------------------------------------
   Global state
   ------------------------------------------------------------------- */
export const STATE = {
  tables: {},   // filename -> { fields:[], rows:[] }
  model: null,  // derived, curated datasets
  view: 'home',
  listState: {},      // stateKey -> { q, sort, page } preserved across navigation
  pendingScroll: null,// { key, y } — restore scroll once when a list re-renders
};

export const UI = { activePopup: null, activeLightbox: null };

/* helper to read a table safely */
export const T = (name) => (STATE.tables[name] || { fields: [], rows: [] }).rows;

export const has = (name) => !!STATE.tables[name];
