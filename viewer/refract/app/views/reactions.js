import { STATE } from '../../../app/core/state.js';
import { el, fmtDate, fmtInt } from '../../../app/core/util.js';
import { listView } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { rating10, tagChips } from '../kit.js';
import { targetNav } from './ratings.js';

const pad2 = (n) => String(n).padStart(2, '0');

/* Refract's closest analog to TV Time reactions: the mood tags (and watch
   contexts) attached to reviews. */
export function renderReactions(root) {
  const reactions = STATE.model.reviews.filter(r => r.moodTags.length || r.watchContext.length);
  listView(root, {
    title: 'Reactions', subtitle: `${fmtInt(reactions.length)} reviews with mood tags`,
    items: reactions, stateKey: 'reactions',
    searchText: (r) => `${r.title} ${r.moodTags.join(' ')} ${r.watchContext.join(' ')}`,
    sorts: [
      { id: 'recent', label: 'Newest first', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (r) => {
      const nav = targetNav(r.target);
      const item = el('div', { class: 'item review-item' + (nav ? ' clickable' : '') }, [
        el('div', { class: 'item-main' }, [
          el('div', { class: 'item-title', text: r.title }),
          el('div', { class: 'item-meta' }, [
            el('span', { text: r.targetType }),
            r.kind === 'episode' && r.season != null ? el('span', { text: `S${pad2(r.season)}E${pad2(r.episode)}` }) : null,
            r.date ? el('span', { text: fmtDate(r.date) }) : null,
          ]),
          el('div', { class: 'detail-chips' }, [
            ...tagChips(r.moodTags, 'ph-sparkle'),
            ...tagChips(r.watchContext, 'ph-users'),
          ]),
        ]),
        el('div', { class: 'item-right' }, [rating10(r.rating)].filter(Boolean)),
      ]);
      if (nav) item.addEventListener('click', () => navigate(nav));
      return item;
    },
    exportName: 'refract-reactions',
    exportRow: (r) => ({ title: r.title, target_type: r.targetType, season: r.season ?? '', episode: r.episode ?? '', mood_tags: r.moodTags.join('|'), watch_context: r.watchContext.join('|'), rating: r.rating ?? '', date: r.date ? r.date.toISOString().slice(0, 10) : '' }),
  });
}
