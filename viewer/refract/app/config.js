import { STATE } from '../../app/core/state.js';
import { makeArchiveStore } from '../../app/core/storage.js';
import { renderRaw } from '../../app/views/raw.js';
import { buildRefractModel, findBySlug } from './model.js';
import { renderHistory } from './views/history.js';
import { renderHome } from './views/home.js';
import { renderLists } from './views/lists.js';
import { openMovieDetail, renderMovies } from './views/movies.js';
import { renderRatings } from './views/ratings.js';
import { renderReactions } from './views/reactions.js';
import { renderReviews } from './views/reviews.js';
import { openShowDetail, renderAnime, renderShows } from './views/shows.js';

// Shows and Anime are separate nav views over the same entity pool, so both
// route to the same detail opener.
const showDetail = { find: (slug) => findBySlug(STATE.model.shows, slug), open: openShowDetail };

export const REFRACT_APP = {
  brand: { title: 'Refract Archive' },
  views: [
    { id: 'home',   label: 'Home',   icon: 'ph-house', render: renderHome },
    // Watch group
    { id: 'shows',  label: 'TV Shows', icon: 'ph-television', render: renderShows },
    { id: 'anime',  label: 'Anime',  icon: 'ph-flower-lotus', render: renderAnime },
    { id: 'movies', label: 'Movies', icon: 'ph-film-slate', render: renderMovies },
    { id: 'watch-history', label: 'Watch history', icon: 'ph-clock-counter-clockwise', render: renderHistory },
    { id: 'lists',  label: 'Lists',  icon: 'ph-list-bullets', render: renderLists },
    // Ratings group
    { id: 'ratings', label: 'Ratings', icon: 'ph-star', render: renderRatings },
    { id: 'reactions', label: 'Reactions', icon: 'ph-heart', render: renderReactions },
    { id: 'reviews', label: 'Reviews', icon: 'ph-note-pencil', render: renderReviews },
    { id: 'raw',    label: 'All data', icon: 'ph-database', render: renderRaw },
  ],
  groups: {
    watch:   { label: 'Watch',   icon: 'ph-play-circle', children: ['shows', 'anime', 'movies', 'watch-history', 'lists'] },
    ratings: { label: 'Ratings', icon: 'ph-star',        children: ['ratings', 'reactions', 'reviews'] },
  },
  detail: {
    shows: showDetail,
    anime: showDetail,
    movies: { find: (slug) => findBySlug(STATE.model.movies, slug), open: openMovieDetail },
  },
  buildModel: buildRefractModel,
  archive: makeArchiveStore('refract-archive'),
  statuses: {
    completed:   ['good', 'Completed'],
    up_to_date:  ['good', 'Up to date'],
    in_progress: ['accent', 'Watching'],
    planned:     ['dim', 'Planned'],
    on_hold:     ['warn', 'On hold'],
    dropped:     ['warn', 'Dropped'],
  },
  settingsExtras: null,
  crossLink: { label: 'Open TV Time Archive', href: '../' },
};
