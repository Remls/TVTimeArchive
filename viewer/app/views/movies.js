import { movieTitle } from '../core/enrich.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtDuration, fmtInt } from '../core/util.js';
import { listView, ratingChip, statusBadge } from '../ui/kit.js';

export function renderMovies(root) {
  const movies = STATE.model.movies;
  listView(root, {
    title: 'Movies', subtitle: `${fmtInt(movies.length)} movies`,
    items: movies, searchKeys: ['title'], twoCol: true, stateKey: 'movies',
    searchText: (mv) => `${mv.title} ${movieTitle(mv.title)}`,
    enrichMovies: (slice) => slice.map(mv => mv.title),
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'watched', label: 'Watched', test: mv => mv.watched },
      { id: 'watchlist', label: 'Watchlist', test: mv => mv.status === 'watchlist' },
      { id: 'rated', label: 'Rated', test: mv => !!mv.rating },
      { id: 'reacted', label: 'Reacted', test: mv => mv.reactions.length > 0 },
    ] },
    sorts: [
      { id: 'recent', label: 'Recently watched', fn: (a, b) => (b.watchedAt?.getTime() || 0) - (a.watchedAt?.getTime() || 0) },
      { id: 'rating', label: 'Highest rated', fn: (a, b) => (b.rating?.stars || 0) - (a.rating?.stars || 0) },
      { id: 'runtime', label: 'Longest', fn: (a, b) => b.runtime - a.runtime },
      { id: 'az', label: 'A → Z', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (mv) => el('div', { class: 'item' }, [
      el('div', { class: 'item-main' }, [
        el('div', { class: 'item-title', text: movieTitle(mv.title) }),
        el('div', { class: 'item-meta' }, [
          movieTitle(mv.title) !== mv.title ? el('span', { text: mv.title }) : null,
          mv.runtime ? el('span', { text: fmtDuration(mv.runtime) }) : null,
          mv.rewatches ? el('span', { text: `${mv.rewatches} rewatch` }) : null,
          ...(mv.watchDates.length
            ? mv.watchDates.map((d, i) => el('span', { class: 'watch-date', text: (i === 0 ? '▶ ' : '↻ ') + fmtDate(d) }))
            : (mv.followedAt ? [el('span', { text: `added ${fmtDate(mv.followedAt)}` })] : [])),
        ]),
        mv.reactions.length ? el('div', { class: 'ep-reactions', text: mv.reactions.join(' · ') }) : null,
      ]),
      el('div', { class: 'item-right' }, [
        mv.rating ? ratingChip(mv.rating) : null,
        el('div', { html: '' }), statusBadge(mv.status),
      ]),
    ]),
    exportName: 'tvtime-movies',
    exportRow: (mv) => ({ title: mv.title, status: mv.status || '', watched: mv.watched, watch_count: mv.watchCount, rewatches: mv.rewatches, runtime_seconds: mv.runtime, rating: mv.rating ? mv.rating.label : '', stars: mv.rating ? mv.rating.stars : '', reactions: mv.reactions.join('|'), watched_at: mv.watchedAt ? mv.watchedAt.toISOString() : '', followed_at: mv.followedAt ? mv.followedAt.toISOString() : '', sources: (mv.sources || []).join('|') }),
  });
}
