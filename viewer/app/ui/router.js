import { APP } from '../core/app.js';
import { STATE } from '../core/state.js';
import { $ } from '../core/util.js';
import { closeNavMenus } from './shell.js';

export function renderView(id) {
  STATE.view = id;
  const navId = APP.groupOf[id] ? 'group:' + APP.groupOf[id] : id;   // a group child highlights its group tab
  for (const t of document.querySelectorAll('.tab, .subnav-item')) {
    const dv = t.dataset.view;
    t.classList.toggle('active', dv === id || dv === navId);
  }
  closeNavMenus();
  $('#globalSearch').hidden = true;
  const root = $('#viewRoot');
  root.innerHTML = '';
  window.scrollTo(0, 0);
  (APP.views.find(v => v.id === id) || APP.views[0]).render(root);
}

export const isView = (id) => APP.views.some(v => v.id === id);

export function stateToHash(s) {
  if (APP.detail[s.view] && s.detail) return `#/${s.view}/${s.detail}`;
  return `#/${s.view || 'home'}`;
}

export function hashToState() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (APP.detail[parts[0]] && parts[1]) return { view: parts[0], detail: decodeURIComponent(parts[1]) };
  return { view: isView(parts[0]) ? parts[0] : 'home' };
}

export function applyState(state) {
  const s = state || hashToState();
  const d = s.detail && APP.detail[s.view];
  if (d) {
    const item = d.find(s.detail);
    if (item) { d.open(item); return; }
  }
  renderView(isView(s.view) ? s.view : 'home');
}

export function navigate(state, replace) {
  history[replace ? 'replaceState' : 'pushState'](state, '', stateToHash(state));
  applyState(state);
}
