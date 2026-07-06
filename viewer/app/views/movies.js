import { movieTitle } from '../core/enrich.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtDuration, fmtInt, norm, slugify } from '../core/util.js';
import { chip, detailScaffold, listView, posterCard, ratingChip, statusBadge } from '../ui/kit.js';
import { navigate } from '../ui/router.js';
import { commentCard } from './comments.js';

export function renderMovies(root) {
  const movies = STATE.model.movies;
  listView(root, {
    title: 'Movies', subtitle: `${fmtInt(movies.length)} movies`,
    items: movies, searchKeys: ['title'], gallery: true, stateKey: 'movies',
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
    renderItem: (mv) => {
      const en = movieTitle(mv.title);
      return posterCard({
        kind: 'movie', title: en,
        secondary: en !== mv.title ? mv.title : null,
        status: mv.status, rating: mv.rating && mv.rating.stars,
        sub: mv.runtime ? fmtDuration(mv.runtime) : null,
        onClick: () => navigate({ view: 'movies', detail: slugify(mv.title) }),
      });
    },
    exportName: 'tvtime-movies',
    exportRow: (mv) => ({ title: mv.title, status: mv.status || '', watched: mv.watched, watch_count: mv.watchCount, rewatches: mv.rewatches, runtime_seconds: mv.runtime, rating: mv.rating ? mv.rating.label : '', stars: mv.rating ? mv.rating.stars : '', reactions: mv.reactions.join('|'), watched_at: mv.watchedAt ? mv.watchedAt.toISOString() : '', followed_at: mv.followedAt ? mv.followedAt.toISOString() : '', sources: (mv.sources || []).join('|') }),
  });
}

export function openMovieDetail(mv) {
  STATE.pendingScroll = { key: 'movies', y: window.scrollY || window.pageYOffset || 0 };
  const en = movieTitle(mv.title);
  const { body } = detailScaffold($('#viewRoot'), {
    title: en, kind: 'movie',
    subKids: [
      mv.runtime ? el('span', { text: fmtDuration(mv.runtime) }) : null,
      mv.watchCount ? el('span', { html: `<b>${fmtInt(mv.watchCount)}</b> watch${mv.watchCount === 1 ? '' : 'es'}` }) : null,
      mv.rating ? ratingChip(mv.rating) : null,
      statusBadge(mv.status),
    ],
  });

  if (en !== mv.title) body.append(el('div', { class: 'detail-orig', text: mv.title }));

  const section = (t) => body.append(el('div', { class: 'section-title', text: t }));

  if (mv.watchDates.length) {
    section('Watch history');
    body.append(el('div', { class: 'detail-dates' }, mv.watchDates.map((d, i) => el('div', { class: 'detail-date' }, [
      el('i', { class: 'ph ' + (i === 0 ? 'ph-play-circle' : 'ph-arrow-clockwise') }), ' ' + fmtDate(d),
    ]))));
  }

  if (mv.reactions.length) {
    section('Reactions');
    body.append(el('div', { class: 'detail-chips' }, mv.reactions.map(r => chip(r))));
  }

  const cmts = STATE.model.comments.list.filter(e => e.kind === 'movie' && norm(e.target) === norm(mv.title));
  if (cmts.length) {
    section(cmts.length === 1 ? '1 comment' : `${fmtInt(cmts.length)} comments`);
    body.append(el('div', { class: 'cmt-list' }, cmts.map(commentCard)));
  }
}
