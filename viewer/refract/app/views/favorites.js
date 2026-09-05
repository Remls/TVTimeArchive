import { STATE } from '../../../app/core/state.js';
import { fmtInt } from '../../../app/core/util.js';
import { listView, posterCard } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { enrichItem, kindIcon, metaYear, seriesIdOf } from '../kit.js';

/* The titles you starred in Refract, in the order it shows them. */
export function renderFavorites(root) {
  const favorites = STATE.model.favorites;
  listView(root, {
    title: 'Favourites', subtitle: `${fmtInt(favorites.length)} favourites`,
    items: favorites, gallery: true, stateKey: 'favorites',
    searchText: (f) => `${f.title} ${f.target ? f.target.originalTitle : ''}`,
    enrichShows: (slice) => slice.filter(f => f.target && !f.target.isMovie).map(f => enrichItem(f.target)),
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'show', label: 'Shows', test: f => f.kind === 'show' },
      { id: 'movie', label: 'Movies', test: f => f.kind === 'movie' },
    ] },
    sorts: [
      { id: 'order', label: 'Refract order', fn: () => 0 },
      { id: 'recent', label: 'Recently added', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (f) => {
      const m = f.target;
      return posterCard({
        kind: f.kind === 'movie' ? 'movie' : 'show', kindIcon: kindIcon(m),
        title: f.title, year: metaYear(m), seriesId: seriesIdOf(m), poster: m ? m.poster : '',
        secondary: m && m.originalTitle && m.originalTitle !== f.title ? m.originalTitle : null,
        status: m ? m.status : '', rating: m ? m.rating : null,
        sub: m && m.year ? String(m.year) : null,
        onClick: m ? () => navigate({ view: m.isMovie ? 'movies' : 'shows', detail: m.slug }) : null,
      });
    },
    exportName: 'refract-favourites',
    exportRow: (f) => ({
      title: f.title, kind: f.kind, year: f.target ? (f.target.year ?? '') : '',
      added: f.date ? f.date.toISOString().slice(0, 10) : '',
    }),
  });
}
