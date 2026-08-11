import { Enrichment } from './core/enrich.js';
import { STATE } from './core/state.js';
import { Backup, Extended, IDB } from './core/storage.js';
import { el, fmtInt, norm, slugify } from './core/util.js';
import { buildModel, refreshExtended } from './model/model.js';
import { renderBadges } from './views/badges.js';
import { renderCharacters } from './views/characters.js';
import { pickBackup, renderComments } from './views/comments.js';
import { renderFriends } from './views/friends.js';
import { renderHistory } from './views/history.js';
import { renderHome } from './views/home.js';
import { renderLists } from './views/lists.js';
import { openMovieDetail, renderMovies } from './views/movies.js';
import { renderNotifications } from './views/notifications.js';
import { renderProfile } from './views/profile.js';
import { renderRatings } from './views/ratings.js';
import { renderRaw } from './views/raw.js';
import { renderReactions } from './views/reactions.js';
import { openShowDetail, renderShows } from './views/shows.js';

const VIEWS = [
  { id: 'home',     label: 'Home',     icon: 'ph-house', render: renderHome },
  // Watch group
  { id: 'shows',    label: 'Shows',    icon: 'ph-television', render: renderShows },
  { id: 'movies',   label: 'Movies',   icon: 'ph-film-slate', render: renderMovies },
  { id: 'watch-history', label: 'Watch history', icon: 'ph-clock-counter-clockwise', render: renderHistory },
  { id: 'lists',    label: 'Lists',    icon: 'ph-list-bullets', render: renderLists },
  // Ratings group
  { id: 'ratings',  label: 'Ratings',  icon: 'ph-star', render: renderRatings },
  { id: 'reactions', label: 'Reactions', icon: 'ph-heart', render: renderReactions },
  { id: 'character-votes', label: 'Character votes', icon: 'ph-mask-happy', render: renderCharacters },
  // Community group
  { id: 'comments', label: 'Comments', icon: 'ph-chat-circle-text', render: renderComments },
  { id: 'notifications', label: 'Notifications', icon: 'ph-bell', render: renderNotifications },
  { id: 'friends',  label: 'Friends',  icon: 'ph-users', render: renderFriends },
  { id: 'badges',   label: 'Badges',   icon: 'ph-medal', render: renderBadges },
  { id: 'profile',  label: 'Profile',  icon: 'ph-user', render: renderProfile },
  { id: 'raw',      label: 'All data', icon: 'ph-database', render: renderRaw },
];

// Views collapsed under one top-level tab. Children must be a contiguous run in VIEWS.
// Desktop: children nest under the group in the sidebar. Mobile: tapping the group tab
// opens a popup menu. The URL uses each child's own id (#/ratings), reflecting the sub-view.
const GROUPS = {
  watch:     { label: 'Watch',     icon: 'ph-play-circle',  children: ['shows', 'movies', 'watch-history', 'lists'] },
  ratings:   { label: 'Ratings',   icon: 'ph-star',         children: ['ratings', 'reactions', 'character-votes'] },
  community: { label: 'Community', icon: 'ph-users-three',  children: ['comments', 'notifications', 'friends', 'badges'] },
};

// A Refract export also parses as "a zip of CSVs"; catch it before the model
// builder produces an empty archive and point at the right viewer instead.
function buildTvTimeModel(tables) {
  if (tables['media.csv'] && tables['episodes.csv'] && !tables['user.csv']) {
    throw new Error('this looks like a Refract export. Load it at /refract instead.');
  }
  return buildModel(tables);
}

function settingsExtras({ makeClear, refresh }) {
  // Extended backup: import the zip made by extended-backup.py (images + resolved names).
  const IMPORT_LABEL = 'Import extended backup…';
  const importItem = el('button', { class: 'menu-item' }, [el('span', { text: IMPORT_LABEL })]);
  importItem.addEventListener('click', (e) => {
    e.stopPropagation();
    pickBackup((err, count) => {
      importItem.firstChild.textContent = err ? (err.message || 'Import failed') : `Imported ${fmtInt(count)} ✓`;
      setTimeout(() => { importItem.firstChild.textContent = IMPORT_LABEL; }, 1800);
      if (!err) { refreshExtended(); refresh(); }
    });
  });
  const importNote = el('div', { class: 'menu-note' }, [el('i', { class: 'ph ph-info' }), el('span', {}, [
    'Comment images, avatars, badges, characters & friends. Generate it with extended-backup.py, see the ',
    el('a', { href: 'https://github.com/Remls/TVTimeArchive#extended-backup', target: '_blank', rel: 'noopener noreferrer', text: 'README' }), '.',
  ])]);
  return {
    items: [importItem, importNote],
    clears: [makeClear('Imported backup', 'Clear the imported backup (images + resolved names) from this browser?', () => Backup.clear())],
  };
}

export const TVTIME_APP = {
  brand: { title: 'TV Time Archive' },
  views: VIEWS,
  groups: GROUPS,
  detail: {
    shows:  { find: (slug) => STATE.model.shows.find(s => slugify(s.title) === slug), open: openShowDetail },
    movies: { find: (slug) => STATE.model.movies.find(m => slugify(m.title) === slug), open: openMovieDetail },
  },
  buildModel: buildTvTimeModel,
  archive: IDB,
  beforeModel: () => Extended.load(),   // imported character/friend names, if any
  afterModel: async (model) => {
    // Index show titles -> TheTVDB id so name-only views (Reactions) can hit the enrichment cache.
    Enrichment.seriesIdByName = {};
    for (const s of model.shows) if (s.id) Enrichment.seriesIdByName[norm(s.title)] = s.id;
    // Load any locally-backed-up comment images so they render from local copies.
    await Backup.init();
  },
  statuses: {
    following: ['good', 'Following'], archived: ['dim', 'Archived'], stopped: ['warn', 'Stopped'],
    watchlist: ['accent', 'Watchlist'], watched: ['good', 'Watched'], rated: ['warn', 'Rated'],
  },
  settingsExtras,
  crossLink: { label: 'Open Refract Archive', href: 'refract/' },
};
