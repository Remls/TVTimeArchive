import { avatarEl, resilientImg } from '../core/media.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtInt } from '../core/util.js';
import { NOTIF_CAT_LABEL } from '../model/model.js';
import { emptyState, listView, viewHead } from '../ui/kit.js';

export const NOTIF_BADGE_CLASS = { follow: 'accent', mention: 'accent', badge: 'warn', airing: 'good' };

export function renderNotifications(root) {
  const { list } = STATE.model.notifications;
  if (!list.length) {
    viewHead(root, 'Notifications', '');
    root.append(emptyState('No notifications', { icon: 'ph-bell' }));
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
