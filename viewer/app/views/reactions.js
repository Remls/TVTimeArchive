import { Enrichment, movieTitle } from '../core/enrich.js';
import { zoomImg } from '../core/media.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtInt, norm } from '../core/util.js';
import { ensureShowPosters, knownShowSlug, listView, posterCard, showPosterItem } from '../ui/kit.js';
import { navigate } from '../ui/router.js';

export function renderReactions(root) {
  const model = STATE.model;
  const items = model.reactions.grouped;   // one row per episode/movie, many feelings each

  // per-show reaction totals summary
  const perShow = Object.entries(model.emotionPerShow).map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
  const titleByKey = {};
  for (const s of model.shows) titleByKey[norm(s.title)] = s.title;

  listView(root, {
    title: 'Reactions',
    subtitle: `${fmtInt(items.length)} reacted`,
    items,
    beforeList: (container) => {
      if (!perShow.length) return;
      container.append(el('div', { class: 'section-title', text: 'Shows you reacted to most' }));
      const cards = el('div', { class: 'poster-gallery' });
      for (const r of perShow.slice(0, 8)) {
        const title = titleByKey[r.key] || r.key;
        const slug = knownShowSlug(title);
        cards.append(posterCard({
          kind: 'show', title, seriesId: Enrichment.seriesIdByName[norm(title)] || '',
          sub: `${fmtInt(r.count)} feelings`,
          onClick: slug ? () => navigate({ view: 'shows', detail: slug }) : null,
        }));
      }
      container.append(cards);
      container.append(el('div', { class: 'section-title', text: 'Every reaction' }));
    },
    stateKey: 'reactions', enrichFull: true,
    searchText: (r) => r.kind === 'movie' ? `${r.title} ${movieTitle(r.title)}` : r.title,
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'episode', label: 'Episodes', test: r => r.kind === 'episode' },
      { id: 'movie', label: 'Movies', test: r => r.kind === 'movie' },
    ] },
    enrichShows: (slice) => slice.filter(r => r.kind === 'episode').map(r => ({ seriesId: Enrichment.seriesIdByName[norm(r.title)], title: r.title })),
    enrichMovies: (slice) => slice.filter(r => r.kind === 'movie').map(r => r.title),
    sorts: [
      // Watch-date proxy; entities with no watch date (reacted without a watch record) sort last.
      { id: 'recent', label: 'Recently watched', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'oldest', label: 'Oldest first', fn: (a, b) => (a.date?.getTime() || Infinity) - (b.date?.getTime() || Infinity) },
      { id: 'most', label: 'Most feelings', fn: (a, b) => b.reactions.length - a.reactions.length },
      { id: 'az', label: 'A → Z', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (r) => {
      const info = r.kind === 'episode' ? Enrichment.epInfo(r.title, null, r.season, r.episode) : null;
      const epName = info && info.name;
      const kids = [];
      if (Enrichment.enabled) {
        const img = r.kind === 'episode' && info && info.image ? info.image : null;
        kids.push(zoomImg('item-thumb', img, r.title, info && info.imageFull));
      }
      kids.push(el('div', { class: 'item-main' }, [
        el('div', { class: 'item-title', text: r.kind === 'movie' ? movieTitle(r.title) : r.title }),
        el('div', { class: 'item-meta' }, [
          el('span', { class: 'badge ' + (r.kind === 'movie' ? 'warn' : 'accent'), text: r.kind }),
          r.kind === 'episode' && (r.season || r.episode) ? el('span', { text: `S${r.season || '?'}·E${r.episode || '?'}${epName ? ' · ' + epName : ''}` }) : null,
          r.date ? el('span', { text: fmtDate(r.date) }) : null,
        ]),
        el('div', { class: 'reaction-chips' }, r.reactions.map(l => el('span', { class: 'badge accent', text: l }))),
      ]));
      const slug = r.kind === 'episode' ? knownShowSlug(r.title) : null;
      const item = el('div', { class: 'item' + (slug ? ' clickable' : '') }, kids);
      if (slug) { item.title = 'View episode progress'; item.addEventListener('click', () => navigate({ view: 'shows', detail: slug })); }
      return item;
    },
    exportName: 'tvtime-reactions',
    exportRow: (r) => ({ kind: r.kind, title: r.title, season: r.season ?? '', episode: r.episode ?? '', feelings: r.reactions.join(' | '), watched_at: r.date ? r.date.toISOString() : '' }),
  });

  // Posters for the "reacted to most" summary (its cards live outside the paginated list).
  ensureShowPosters(perShow.slice(0, 8).map(r => showPosterItem(titleByKey[r.key] || r.key)));
}
