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
import { renderDiary } from './views/diary.js';
import { renderFavorites } from './views/favorites.js';
import { renderProfile } from './views/profile.js';
import { renderComments } from './views/comments.js';
import { renderChallenges } from './views/challenges.js';
import { renderBadges } from './views/badges.js';

// Shows and Anime are separate nav views over the same entity pool, so both
// route to the same detail opener.
const showDetail = { find: (slug) => findBySlug(STATE.model.shows, slug), open: openShowDetail };

const hasAnime = (model) => model.shows.some(s => s.isAnime);
const has = (key) => (model) => (model[key] || []).length > 0;

export const REFRACT_APP = {
  views: [
    { id: 'home',   label: 'Home',   icon: 'ph-house', render: renderHome },
    // Watch group
    { id: 'shows',  label: 'TV Shows', icon: 'ph-television', render: renderShows },
    // v1 tags each title Anime or TV Show; v3 dropped the distinction and nothing
    // in that export restores it, so the split only exists where the data does.
    { id: 'anime',  label: 'Anime',  icon: 'ph-flower-lotus', render: renderAnime, available: hasAnime, fallback: 'shows' },
    { id: 'movies', label: 'Movies', icon: 'ph-film-slate', render: renderMovies },
    { id: 'watch-history', label: 'Watch history', icon: 'ph-clock-counter-clockwise', render: renderHistory },
    { id: 'diary',  label: 'Diary',  icon: 'ph-notebook', render: renderDiary, available: has('diary') },
    { id: 'favorites', label: 'Favourites', icon: 'ph-star', render: renderFavorites, available: has('favorites') },
    { id: 'lists',  label: 'Lists',  icon: 'ph-list-bullets', render: renderLists },
    // Ratings group
    { id: 'ratings', label: 'Ratings', icon: 'ph-star', render: renderRatings },
    { id: 'reactions', label: 'Reactions', icon: 'ph-heart', render: renderReactions },
    { id: 'reviews', label: 'Reviews', icon: 'ph-note-pencil', render: renderReviews },
    { id: 'comments', label: 'Comments', icon: 'ph-chat-circle-text', render: renderComments, available: has('comments') },
    { id: 'challenges', label: 'Challenges', icon: 'ph-target', render: renderChallenges, available: has('challenges') },
    { id: 'badges', label: 'Badges', icon: 'ph-medal', render: renderBadges, available: has('badges') },
    { id: 'profile', label: 'Profile', icon: 'ph-user', render: renderProfile, available: (m) => !!m.profile },
    { id: 'raw',    label: 'All data', icon: 'ph-database', render: renderRaw },
  ],
  groups: {
    watch:   { label: 'Watch',   icon: 'ph-play-circle', children: ['shows', 'anime', 'movies', 'watch-history', 'diary', 'favorites', 'lists'] },
    ratings: { label: 'Ratings', icon: 'ph-star',        children: ['ratings', 'reactions', 'reviews'] },
    community: { label: 'Community', icon: 'ph-users-three', children: ['comments', 'challenges', 'badges'] },
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
  crossLink: { label: 'Open TV Time Archive Viewer', href: '../' },
};
