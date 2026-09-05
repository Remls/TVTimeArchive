import { STATE } from '../../../app/core/state.js';
import { fmtDate } from '../../../app/core/dates.js';
import { el, fmtInt } from '../../../app/core/util.js';
import { listView } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { rating10 } from '../kit.js';
import { targetNav } from './ratings.js';

/* Refract's own activity log: what you did and when, as distinct from the
   Watch history's one row per viewing. */

const ACTION_FILTERS = [
  { id: 'all', label: 'All activity', test: () => true },
  { id: 'episode', label: 'Watched', test: d => d.action === 'episode' },
  { id: 'completed', label: 'Completed', test: d => d.action === 'completed' },
  { id: 'rewatch', label: 'Rewatched', test: d => d.action === 'rewatch' },
  { id: 'rated', label: 'Rated', test: d => d.action === 'rated' },
  { id: 'added', label: 'Added', test: d => d.action === 'added' },
];

const ACTION_BADGE = {
  completed: ['good', 'ph-check-circle'],
  rewatch: ['gold', 'ph-arrow-clockwise'],
  episode: ['accent', 'ph-play'],
  rated: ['accent', 'ph-star'],
  added: ['dim', 'ph-plus'],
};

export function renderDiary(root) {
  const diary = STATE.model.diary;
  listView(root, {
    title: 'Diary', subtitle: `${fmtInt(diary.length)} entries`,
    items: diary, stateKey: 'diary',
    searchText: (d) => `${d.title} ${d.label} ${d.note}`,
    filter: { default: 'all', options: ACTION_FILTERS },
    sorts: [
      { id: 'recent', label: 'Newest first', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'oldest', label: 'Oldest first', fn: (a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (d) => {
      const nav = targetNav(d.target);
      const [badgeCls, badgeIcon] = ACTION_BADGE[d.action] || ['dim', 'ph-dot'];
      const item = el('div', { class: 'item' + (nav ? ' clickable' : '') }, [
        el('div', { class: 'item-main' }, [
          el('div', { class: 'item-title', text: d.title }),
          el('div', { class: 'item-meta' }, [
            el('span', { text: d.label }),
            d.note ? el('span', { text: d.note }) : null,
            d.date ? el('span', { text: fmtDate(d.date, { time: true }) }) : null,
            d.imported ? el('span', { text: 'imported' }) : null,
            d.userSetDate ? el('span', { text: 'date set by hand' }) : null,
          ]),
        ]),
        el('div', { class: 'item-right' }, [
          rating10(d.rating),
          el('span', { class: 'badge ' + badgeCls, html: `<i class="ph ${badgeIcon}"></i>` }),
        ].filter(Boolean)),
      ]);
      if (nav) item.addEventListener('click', () => navigate(nav));
      return item;
    },
    exportName: 'refract-diary',
    exportRow: (d) => ({
      date: d.date ? d.date.toISOString().slice(0, 10) : '', action: d.action, title: d.title,
      rating: d.rating ?? '', note: d.note, imported: d.imported,
    }),
  });
}
