import { movieTitle } from '../core/enrich.js';
import { STATE } from '../core/state.js';
import { el, fmtInt } from '../core/util.js';
import { emptyState, ensureShowPosters, entityNav, posterCard, showPosterItem, viewHead } from '../ui/kit.js';
import { navigate } from '../ui/router.js';

export function renderLists(root) {
  const lists = STATE.model.lists;
  viewHead(root, 'Lists', lists.length ? `${lists.length} lists` : '');
  if (!lists.length) { root.append(emptyState('No lists', { icon: 'ph-list-bullets' })); return; }

  const posterItems = [];
  for (const l of lists) {
    const det = el('details', { class: 'list-card', open: '' });
    const cover = l.cover
      ? el('img', { class: 'list-cover', src: l.cover, loading: 'lazy', alt: '' })
      : el('div', { class: 'list-cover' });
    const kindLabel = l.kind === 'movie' ? 'movies' : l.kind === 'series' ? 'shows' : 'items';
    det.append(el('summary', {}, [
      cover,
      el('div', { class: 'list-info' }, [
        el('div', { class: 'list-name', text: l.name }),
        el('div', { class: 'list-sub', text: `${fmtInt(l.items.length)} ${kindLabel}` }),
      ]),
      el('span', { class: 'badge ' + (l.isPublic ? 'good' : 'dim'), text: l.isPublic ? 'Public' : 'Private' }),
      el('i', { class: 'ph ph-caret-right list-caret' }),
    ]));
    const gallery = el('div', { class: 'poster-gallery' });
    for (const it of l.items) {
      const isMovie = it.type === 'movie';
      const label = it.title ? (isMovie ? movieTitle(it.title) : it.title) : `${it.type || 'item'} ${it.id || it.uuid || '?'}`;
      const nav = it.title ? entityNav(isMovie ? 'movie' : 'show', it.title) : null;
      if (it.type === 'series' && it.title) posterItems.push(showPosterItem(it.title));
      gallery.append(posterCard({
        kind: isMovie ? 'movie' : 'show', title: label,
        onClick: nav ? () => navigate(nav) : null,
      }));
    }
    det.append(gallery);
    root.append(det);
  }
  ensureShowPosters(posterItems);
}
