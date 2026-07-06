import { zoomImg } from '../core/media.js';
import { STATE } from '../core/state.js';
import { Backup } from '../core/storage.js';
import { $, el, fmtDate, fmtInt } from '../core/util.js';
import { chip, emptyState, extendedNote, knownShowSlug, listView, viewHead } from '../ui/kit.js';
import { navigate } from '../ui/router.js';

export function renderCharacters(root) {
  const list = STATE.model.characters;
  if (!list.length) {
    viewHead(root, 'Character votes', '');
    root.append(emptyState('No character votes', { icon: 'ph-users' }));
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
        return chip(sn, { icon: 'ph-television', clickable: !!slug, onClick: slug ? () => navigate({ view: 'shows', detail: slug }) : null });
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
