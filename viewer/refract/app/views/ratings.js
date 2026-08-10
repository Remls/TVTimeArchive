import { Enrichment } from '../../../app/core/enrich.js';
import { STATE } from '../../../app/core/state.js';
import { el, fmtDate, fmtInt } from '../../../app/core/util.js';
import { listView } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { kindIcon, metaYear, rating10 } from '../kit.js';

const pad2 = (n) => String(n).padStart(2, '0');

const kindBadge = (r) => (r.kind === 'movie'
  ? ['warn', 'ph-film-slate']
  : (kindIcon(r.target) ? ['anime', kindIcon(r.target)] : ['accent', 'ph-television']));

export function targetNav(target) {
  if (!target || !target.slug) return null;
  return { view: target.isMovie ? 'movies' : (target.isAnime ? 'anime' : 'shows'), detail: target.slug };
}

export function renderRatings(root) {
  const ratings = STATE.model.ratings;
  listView(root, {
    title: 'Ratings', subtitle: `${fmtInt(ratings.length)} ratings`,
    items: ratings, stateKey: 'ratings',
    searchText: (r) => `${r.title} ${r.target ? r.target.originalTitle : ''}`,
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'show', label: 'Shows & anime', test: r => r.kind === 'show' },
      { id: 'episode', label: 'Episodes', test: r => r.kind === 'episode' },
      { id: 'movie', label: 'Movies', test: r => r.kind === 'movie' },
    ] },
    sorts: [
      { id: 'recent', label: 'Newest first', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'highest', label: 'Highest rated', fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
      { id: 'lowest', label: 'Lowest rated', fn: (a, b) => (a.rating || 0) - (b.rating || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (r) => {
      const nav = targetNav(r.target);
      const [badgeCls, badgeIcon] = kindBadge(r);
      const kids = [];
      if (Enrichment.enabled && r.kind !== 'movie') {
        const yr = metaYear(r.target);
        const info = r.kind === 'episode' ? Enrichment.epInfo(r.title, '', r.season, r.episode, yr) : null;
        const url = (info && info.image) || Enrichment.posterFor(r.title, '', yr);
        kids.push(el('div', { class: 'item-thumb' }, url ? [el('img', { src: url, loading: 'lazy', alt: '' })] : []));
      }
      kids.push(el('div', { class: 'item-main' }, [
        el('div', { class: 'item-title', text: r.title }),
        el('div', { class: 'item-meta' }, [
          r.kind === 'episode' && r.season != null ? el('span', { text: `S${pad2(r.season)}E${pad2(r.episode)}` }) : null,
          r.date ? el('span', { text: fmtDate(r.date) }) : null,
        ]),
      ]));
      kids.push(el('div', { class: 'item-right' }, [
        rating10(r.rating),
        el('span', { class: 'badge ' + badgeCls, html: `<i class="ph ${badgeIcon}"></i>` }),
      ]));
      const item = el('div', { class: 'item' + (nav ? ' clickable' : '') }, kids);
      if (nav) item.addEventListener('click', () => navigate(nav));
      return item;
    },
    exportName: 'refract-ratings',
    exportRow: (r) => ({ title: r.title, kind: r.kind, season: r.season ?? '', episode: r.episode ?? '', rating: r.rating, date: r.date ? r.date.toISOString().slice(0, 10) : '', source: r.source }),
  });
}
