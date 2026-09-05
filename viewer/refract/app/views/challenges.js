import { STATE } from '../../../app/core/state.js';
import { fmtDate } from '../../../app/core/dates.js';
import { el, fmtInt } from '../../../app/core/util.js';
import { listView } from '../../../app/ui/kit.js';

/* Refract's timed challenges, recovered from posts.jsonl. The export records
   the join and the completion but never the goal or the progress, so a
   challenge is only ever "joined" or "completed" here. */

/* Refract names its icons after its own set; these are the Phosphor
   equivalents, with a rosette for anything not seen in an export yet. */
const ICON = {
  rocket: 'ph-rocket-launch',
  compass: 'ph-compass',
  calendar: 'ph-calendar-blank',
  'play-circle': 'ph-play-circle',
  star: 'ph-star',
  edit: 'ph-pencil-simple',
  trophy: 'ph-trophy',
  flame: 'ph-fire',
};
const iconOf = (name) => ICON[name] || 'ph-target';

export function renderChallenges(root) {
  const challenges = STATE.model.challenges;
  const done = challenges.filter(c => c.completedAt).length;
  listView(root, {
    title: 'Challenges',
    subtitle: `${fmtInt(done)} of ${fmtInt(challenges.length)} completed`,
    items: challenges, stateKey: 'challenges',
    searchText: (c) => c.title,
    filter: { default: 'all', options: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'completed', label: 'Completed', test: c => !!c.completedAt },
      { id: 'joined', label: 'Not completed', test: c => !c.completedAt },
    ] },
    sorts: [
      { id: 'recent', label: 'Newest first', fn: (a, b) => (b.completedAt || b.joinedAt || 0) - (a.completedAt || a.joinedAt || 0) },
      { id: 'oldest', label: 'Oldest first', fn: (a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (c) => el('div', { class: 'item' }, [
      // Refract gives every challenge its own colour; it tints the icon only.
      el('span', { class: 'challenge-ico', style: c.color ? `color:${c.color}` : '' }, [el('i', { class: 'ph ' + iconOf(c.icon) })]),
      el('div', { class: 'item-main' }, [
        el('div', { class: 'item-title', text: c.title }),
        el('div', { class: 'item-meta' }, [
          c.joinedAt ? el('span', { text: `joined ${fmtDate(c.joinedAt)}` }) : null,
          c.completedAt ? el('span', { text: `completed ${fmtDate(c.completedAt)}` }) : null,
        ]),
      ]),
      el('div', { class: 'item-right' }, [
        c.completedAt
          ? el('span', { class: 'badge good', html: '<i class="ph ph-check-circle"></i> Completed' })
          : el('span', { class: 'badge dim', text: 'In progress' }),
      ]),
    ]),
    exportName: 'refract-challenges',
    exportRow: (c) => ({
      title: c.title, challenge_id: c.id,
      joined: c.joinedAt ? c.joinedAt.toISOString().slice(0, 10) : '',
      completed: c.completedAt ? c.completedAt.toISOString().slice(0, 10) : '',
    }),
  });
}
