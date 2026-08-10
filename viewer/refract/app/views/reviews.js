import { STATE } from '../../../app/core/state.js';
import { el, fmtDate, fmtInt } from '../../../app/core/util.js';
import { listView } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { rating10, reviewText, tagChips } from '../kit.js';
import { targetNav } from './ratings.js';

const pad2 = (n) => String(n).padStart(2, '0');

/* Written reviews only; bare ratings live under Ratings and mood tags under
   Reactions. */
export function renderReviews(root) {
  const reviews = STATE.model.reviews.filter(r => r.text);
  listView(root, {
    title: 'Reviews', subtitle: `${fmtInt(reviews.length)} written reviews`,
    items: reviews, stateKey: 'reviews',
    searchText: (r) => `${r.title} ${r.target ? r.target.originalTitle : ''} ${r.text}`,
    sorts: [
      { id: 'recent', label: 'Newest first', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'highest', label: 'Highest rated', fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
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
            r.visibility && r.visibility !== 'public' ? el('span', { text: r.visibility }) : null,
            ...(r.moodTags.length ? tagChips(r.moodTags, 'ph-sparkle') : []),
          ]),
          reviewText(r.text, r.isSpoiler),
        ]),
        el('div', { class: 'item-right' }, [rating10(r.rating)].filter(Boolean)),
      ]);
      if (nav) item.addEventListener('click', (e) => { if (!e.target.closest('.review-text')) navigate(nav); });
      return item;
    },
    exportName: 'refract-reviews',
    exportRow: (r) => ({
      title: r.title, target_type: r.targetType, season: r.season ?? '', episode: r.episode ?? '',
      rating: r.rating ?? '', review: r.text, mood_tags: r.moodTags.join('|'),
      spoiler: r.isSpoiler, visibility: r.visibility, date: r.date ? r.date.toISOString().slice(0, 10) : '',
    }),
  });
}
