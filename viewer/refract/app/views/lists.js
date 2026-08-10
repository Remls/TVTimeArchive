import { STATE } from '../../../app/core/state.js';
import { el, fmtInt } from '../../../app/core/util.js';
import { emptyState, ensureShowPosters, posterCard, viewHead } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { enrichItem, kindIcon, metaYear } from '../kit.js';

export function renderLists(root) {
  const lists = STATE.model.lists;
  viewHead(root, 'Lists', lists.length ? `${lists.length} lists` : '');
  if (!lists.length) { root.append(emptyState('No lists', { icon: 'ph-list-bullets' })); return; }

  const posterItems = [];
  for (const l of lists) {
    const det = el('details', { class: 'list-card', open: '' });
    det.append(el('summary', {}, [
      el('div', { class: 'list-info' }, [
        el('div', { class: 'list-name', text: l.name }),
        el('div', { class: 'list-sub', text: `${fmtInt(l.items.length)} items` }),
      ]),
      el('span', { class: 'badge ' + (l.isPublic ? 'good' : 'dim'), text: l.isPublic ? 'Public' : 'Private' }),
      el('i', { class: 'ph ph-caret-right list-caret' }),
    ]));
    if (l.description) det.append(el('p', { class: 'list-desc', text: l.description }));
    const gallery = el('div', { class: 'poster-gallery' });
    for (const it of l.items) {
      const m = it.media;
      if (m && !m.isMovie) posterItems.push(enrichItem(m));
      const card = posterCard({
        kind: m && m.isMovie ? 'movie' : 'show', kindIcon: kindIcon(m),
        title: m ? m.title : it.title, year: metaYear(m),
        sub: [it.year || (m && m.year), it.note].filter(Boolean).join(', '),
        onClick: m ? () => navigate({ view: m.isMovie ? 'movies' : (m.isAnime ? 'anime' : 'shows'), detail: m.slug }) : null,
      });
      // Refract lists are ordered; Position is zero-indexed in the export
      card.querySelector('.poster-card-art').append(el('span', { class: 'poster-num', text: String(it.position + 1) }));
      gallery.append(card);
    }
    det.append(gallery);
    root.append(det);
  }
  ensureShowPosters(posterItems);
}
