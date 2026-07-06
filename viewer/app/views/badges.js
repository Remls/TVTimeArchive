import { resilientImg } from '../core/media.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtInt } from '../core/util.js';
import { chip, emptyState, knownShowSlug, listView, viewHead } from '../ui/kit.js';
import { navigate } from '../ui/router.js';

export function renderBadges(root) {
  const { list, total } = STATE.model.badges;
  if (!list.length) {
    viewHead(root, 'Badges', '');
    root.append(emptyState('No badges', { icon: 'ph-seal-check' }));
    return;
  }
  listView(root, {
    title: 'Badges', subtitle: `${fmtInt(total)} earned, ${fmtInt(list.length)} types`,
    items: list, stateKey: 'badges', twoCol: true,
    searchText: (g) => g.name,
    sorts: [
      { id: 'count', label: 'Most earned', fn: (a, b) => b.count - a.count || (b.last?.getTime() || 0) - (a.last?.getTime() || 0) },
      { id: 'recent', label: 'Recently earned', fn: (a, b) => (b.last?.getTime() || 0) - (a.last?.getTime() || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.name.localeCompare(b.name) },
    ],
    renderItem: (g) => {
      const art = g.art
        ? el('div', { class: 'badge-art' }, [resilientImg(g.art.key, g.art.image, { alt: '' })])
        : el('div', { class: 'badge-art empty' }, [el('i', { class: 'ph ph-seal-check' })]);
      const head = [
        art,
        el('div', { class: 'item-main' }, [
          el('div', { class: 'item-title', text: g.name }),
          el('div', { class: 'item-meta' }, [
            g.last ? el('span', { text: `last ${fmtDate(g.last)}` }) : null,
            g.count > 1 && g.first ? el('span', { text: `since ${fmtDate(g.first)}` }) : null,
          ]),
        ]),
        el('div', { class: 'item-right' }, [g.count > 1 ? el('div', { class: 'rating-chip', text: `×${fmtInt(g.count)}` }) : null]),
      ];
      // No per-show data (one-off account badges) -> a plain card.
      if (!g.shows.length) return el('div', { class: 'item' }, head);

      // Per-show badge -> expandable card listing the shows it was earned for.
      const det = el('details', { class: 'badge-card' });
      det.append(el('summary', {}, [...head, el('i', { class: 'ph ph-caret-down badge-caret' })]));
      const chips = el('div', { class: 'badge-shows' });
      for (const s of g.shows) {
        const label = s.name || `Show #${s.id}`;
        const slug = s.name ? knownShowSlug(s.name) : null;
        chips.append(chip(label, {
          icon: 'ph-television', unknown: !s.name, clickable: !!slug,
          onClick: slug ? () => navigate({ view: 'shows', detail: slug }) : null,
        }));
      }
      det.append(chips);
      return det;
    },
    exportName: 'tvtime-badges',
    exportRow: (g) => ({ badge: g.name, type: g.key, count: g.count, first_earned: g.first ? g.first.toISOString() : '', last_earned: g.last ? g.last.toISOString() : '', shows: g.shows.map(s => s.name || `#${s.id}`).join(' | ') }),
  });
}
