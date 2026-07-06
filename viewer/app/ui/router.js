import { STATE } from '../core/state.js';
import { $, slugify } from '../core/util.js';
import { GROUP_OF, VIEWS, closeNavMenus } from './shell.js';
import { openShowDetail } from '../views/shows.js';

export function renderView(id) {
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

export const isView = (id) => VIEWS.some(v => v.id === id);

export function stateToHash(s) {
  if (s.view === 'shows' && s.detail) return `#/shows/${s.detail}`;
  return `#/${s.view || 'home'}`;
}

export function hashToState() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'shows' && parts[1]) return { view: 'shows', detail: decodeURIComponent(parts[1]) };
  return { view: isView(parts[0]) ? parts[0] : 'home' };
}

export function applyState(state) {
  const s = state || hashToState();
  if (s.view === 'shows' && s.detail) {
    const show = STATE.model.shows.find(sh => slugify(sh.title) === s.detail);
    if (show) { openShowDetail(show); return; }
  }
  renderView(isView(s.view) ? s.view : 'home');
}

export function navigate(state, replace) {
  history[replace ? 'replaceState' : 'pushState'](state, '', stateToHash(state));
  applyState(state);
}
