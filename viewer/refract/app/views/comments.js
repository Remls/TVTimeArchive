import { STATE } from '../../../app/core/state.js';
import { fmtInt } from '../../../app/core/util.js';
import { listView } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { commentCard } from '../kit.js';
import { targetNav } from './ratings.js';


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
    renderItem: (c) => commentCard(c, { nav: targetNav(c.target), onNav: navigate }),
    exportName: 'refract-comments',
    exportRow: (c) => ({
      date: c.date ? c.date.toISOString().slice(0, 10) : '', target_type: c.targetType, title: c.title,
      season: c.season ?? '', episode: c.episode ?? '', comment: c.text, source: c.source,
    }),
  });
}
