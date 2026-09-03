import { STATE } from '../../../app/core/state.js';
import { el, fmtDate, fmtInt } from '../../../app/core/util.js';
import { listView } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { reviewText } from '../kit.js';
import { targetNav } from './ratings.js';

const pad2 = (n) => String(n).padStart(2, '0');

/* Comments you left on shows, movies and episodes. Kept in the export for your
   records only: Refract never re-publishes them when a backup is restored. */
export function renderComments(root) {
  const comments = STATE.model.comments;
  listView(root, {
    title: 'Comments', subtitle: `${fmtInt(comments.length)} comments`,
    items: comments, stateKey: 'comments',
    searchText: (c) => `${c.title} ${c.text}`,
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'episode', label: 'Episodes', test: c => c.kind === 'episode' },
      { id: 'show', label: 'Shows', test: c => c.kind === 'show' },
      { id: 'movie', label: 'Movies', test: c => c.kind === 'movie' },
    ] },
    sorts: [
      { id: 'recent', label: 'Newest first', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'oldest', label: 'Oldest first', fn: (a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (c) => {
      const nav = targetNav(c.target);
      const item = el('div', { class: 'item review-item' + (nav ? ' clickable' : '') }, [
        el('div', { class: 'item-main' }, [
          el('div', { class: 'item-title', text: c.title }),
          el('div', { class: 'item-meta' }, [
            el('span', { text: c.targetType }),
            c.season != null ? el('span', { text: `S${pad2(c.season)}E${pad2(c.episode)}` }) : null,
            c.date ? el('span', { text: fmtDate(c.date) }) : null,
            c.editedAt ? el('span', { text: 'edited' }) : null,
          ]),
          reviewText(c.text, c.isSpoiler),
        ]),
      ]);
      if (nav) item.addEventListener('click', (e) => { if (!e.target.closest('.review-text')) navigate(nav); });
      return item;
    },
    exportName: 'refract-comments',
    exportRow: (c) => ({
      date: c.date ? c.date.toISOString().slice(0, 10) : '', target_type: c.targetType, title: c.title,
      season: c.season ?? '', episode: c.episode ?? '', comment: c.text, source: c.source,
    }),
  });
}
