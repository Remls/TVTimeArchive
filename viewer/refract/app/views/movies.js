import { movieTitle } from '../../../app/core/enrich.js';
import { STATE } from '../../../app/core/state.js';
import { $, el, fmtDate, fmtInt } from '../../../app/core/util.js';
import { detailScaffold, listView, posterCard, statusBadge } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { countryNames, rating10 } from '../kit.js';
import { reviewCard } from './shows.js';

// English display title: the export's own Title when present, else a cached
// Wikidata lookup on the original title.
const displayTitle = (mv) => (mv.titleWasExplicit ? mv.title : movieTitle(mv.title));

export function renderMovies(root) {
  const movies = STATE.model.movies;
  listView(root, {
    title: 'Movies', subtitle: `${fmtInt(movies.length)} movies`,
    items: movies, gallery: true, stateKey: 'movies',
    searchText: (mv) => `${mv.title} ${mv.originalTitle} ${displayTitle(mv)}`,
    enrichMovies: (slice) => slice.filter(mv => !mv.titleWasExplicit).map(mv => mv.title),
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'completed', label: 'Watched', test: mv => mv.status === 'completed' || !!mv.watchedDate },
      { id: 'planned', label: 'Planned', test: mv => mv.status === 'planned' },
      { id: 'dropped', label: 'Dropped', test: mv => mv.status === 'dropped' },
      { id: 'rated', label: 'Rated', test: mv => !!mv.rating },
    ] },
    sorts: [
      { id: 'recent', label: 'Recently watched', fn: (a, b) => (b.watchedDate?.getTime() || 0) - (a.watchedDate?.getTime() || 0) },
      { id: 'rating', label: 'Highest rated', fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
      { id: 'year', label: 'Newest', fn: (a, b) => (b.year || 0) - (a.year || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (mv) => {
      const en = displayTitle(mv);
      return posterCard({
        kind: 'movie', title: en,
        secondary: en !== mv.originalTitle && mv.originalTitle ? mv.originalTitle : null,
        status: mv.status, rating: mv.rating,
        sub: mv.year ? String(mv.year) : null,
        onClick: () => navigate({ view: 'movies', detail: mv.slug }),
      });
    },
    exportName: 'refract-movies',
    exportRow: (mv) => ({
      title: mv.title, original_title: mv.originalTitle, year: mv.year ?? '',
      countries: mv.countries.join('|'), status: mv.status, rating: mv.rating ?? '',
      watched_date: mv.watchedDate ? mv.watchedDate.toISOString() : '',
      sources: mv.sources.join('|'),
    }),
  });
}

export function openMovieDetail(mv) {
  STATE.pendingScroll = { key: 'movies', y: window.scrollY || window.pageYOffset || 0 };
  const en = displayTitle(mv);
  const { body } = detailScaffold($('#viewRoot'), {
    title: en, kind: 'movie',
    subKids: [
      mv.year ? el('span', { text: String(mv.year) }) : null,
      mv.countries.length ? el('span', { text: countryNames(mv.countries) }) : null,
      mv.watchedDate ? el('span', { html: `<i class="ph ph-play"></i> ${fmtDate(mv.watchedDate)}` }) : null,
      rating10(mv.rating),
      statusBadge(mv.status),
    ],
  });

  if (mv.originalTitle && mv.originalTitle !== en) body.append(el('div', { class: 'detail-orig', text: mv.originalTitle }));

  if (mv.reviews.length) {
    body.append(el('div', { class: 'section-title', text: mv.reviews.length === 1 ? '1 review' : `${fmtInt(mv.reviews.length)} reviews` }));
    for (const r of mv.reviews) body.append(reviewCard(r));
  }
}
