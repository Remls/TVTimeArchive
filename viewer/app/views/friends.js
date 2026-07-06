import { avatarEl } from '../core/media.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtInt } from '../core/util.js';
import { emptyState, extendedNote, listView, viewHead } from '../ui/kit.js';

export function renderFriends(root) {
  const list = STATE.model.friends;
  if (!list.length) {
    viewHead(root, 'Friends', '');
    root.append(emptyState('No friends', { icon: 'ph-users' }));
    return;
  }
  const unresolved = list.filter(f => !f.name).length;
  listView(root, {
    title: 'Friends', subtitle: `${fmtInt(list.length)} friends`, items: list, stateKey: 'friends', twoCol: true,
    searchText: (f) => `${f.name || ''} ${f.username || ''}`,
    beforeList: unresolved ? (pre) => pre.append(extendedNote(unresolved, list.length)) : null,
    sorts: [
      { id: 'az', label: 'Alphabetical', fn: (a, b) => (a.name || 'zzz~').localeCompare(b.name || 'zzz~') },
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
