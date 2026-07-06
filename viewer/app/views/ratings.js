import { movieTitle } from '../core/enrich.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtInt } from '../core/util.js';
import { emptyState, listView, ratingChip, showLineItem, showPosterItem, viewHead } from '../ui/kit.js';

export function renderRatings(root) {
  const list = STATE.model.ratings.list;
  if (!list.length) {
    viewHead(root, 'Ratings', '');
    root.append(emptyState('No ratings', { icon: 'ph-star' }));
    return;
  }
  const KIND = { show: 'Show', movie: 'Movie', episode: 'Episode' };
  listView(root, {
    title: 'Ratings', subtitle: `${fmtInt(list.length)} rated`, items: list, stateKey: 'ratings',
    searchText: (r) => `${r.title} ${r.kind === 'movie' ? movieTitle(r.title) : ''}`,
    enrichShows: (slice) => slice.filter(r => r.kind !== 'movie').map(r => showPosterItem(r.title)),
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'show', label: 'Shows', test: r => r.kind === 'show' },
      { id: 'movie', label: 'Movies', test: r => r.kind === 'movie' },
      { id: 'episode', label: 'Episodes', test: r => r.kind === 'episode' },
    ] },
    sorts: [
      { id: 'recent', label: 'Recently rated', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'oldest', label: 'Oldest rated', fn: (a, b) => (a.date?.getTime() || Infinity) - (b.date?.getTime() || Infinity) },
      { id: 'score', label: 'Highest rated', fn: (a, b) => b.stars - a.stars || a.title.localeCompare(b.title) },
      { id: 'az', label: 'A → Z', fn: (a, b) => a.title.localeCompare(b.title) },
      { id: 'kind', label: 'By type', fn: (a, b) => a.kind.localeCompare(b.kind) || b.stars - a.stars },
    ],
    renderItem: (r) => {
      const main = [
        el('div', { class: 'item-title', text: r.kind === 'movie' ? movieTitle(r.title) : r.title }),
        el('div', { class: 'item-meta' }, [
          el('span', { class: 'badge dim', text: KIND[r.kind] || r.kind }),
          r.kind === 'episode' && (r.season || r.episode) ? el('span', { text: `S${r.season || '?'}E${r.episode || '?'}` }) : null,
          r.date ? el('span', { text: fmtDate(r.date) }) : null,
        ]),
      ];
      // showLineItem gives every row the poster slot (movies get a blank spacer) and
      // opens the show detail for shows/episodes, or the movie detail for movies.
      return showLineItem(r.title, null, main, [ratingChip(r)], r.kind);
    },
    exportName: 'tvtime-ratings',
    exportRow: (r) => ({ kind: r.kind, title: r.title, stars: r.stars, label: r.label, season: r.season ?? '', episode: r.episode ?? '', rated_at: r.date ? r.date.toISOString() : '' }),
  });
}
