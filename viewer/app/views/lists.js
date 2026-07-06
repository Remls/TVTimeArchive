import { movieTitle } from '../core/enrich.js';
import { STATE } from '../core/state.js';
import { $, el, fmtInt, slugify } from '../core/util.js';
import { chip, emptyState, viewHead } from '../ui/kit.js';
import { navigate } from '../ui/router.js';

export function renderLists(root) {
  const lists = STATE.model.lists;
  const showSlugs = new Set(STATE.model.shows.map(s => slugify(s.title)));   // which chips can open a detail
  viewHead(root, 'Lists', lists.length ? `${lists.length} lists` : '');
  if (!lists.length) { root.append(emptyState('No lists', { icon: 'ph-list-bullets' })); return; }

  for (const l of lists) {
    const det = el('details', { class: 'list-card' });
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
    ]));
    const chips = el('div', { class: 'list-items' });
    for (const it of l.items) {
      const label = it.title ? (it.type === 'movie' ? movieTitle(it.title) : it.title) : `${it.type || 'item'} ${it.id || it.uuid || '?'}`;
      const slug = it.type === 'series' && it.title ? slugify(it.title) : null;
      const clickable = slug && showSlugs.has(slug);
      chips.append(chip(label, {
        icon: it.type === 'movie' ? 'ph-film-slate' : 'ph-television',
        unknown: !it.title, clickable,
        onClick: clickable ? () => navigate({ view: 'shows', detail: slug }) : null,
      }));
    }
    det.append(chips);
    root.append(det);
  }
}
