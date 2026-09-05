import { STATE } from '../../../app/core/state.js';
import { fmtDate } from '../../../app/core/dates.js';
import { el, fmtInt } from '../../../app/core/util.js';
import { listView } from '../../../app/ui/kit.js';
import { refractIcon } from '../kit.js';

/* Refract's badges, recovered from the milestone posts. A badge climbs tiers
   rather than repeating, so a card lists every tier it has reached. */

/* Refract's ladder, named and coloured as its own Achievements screen does.
   Unique is a class of its own rather than a rung, and takes the app accent. */
const TIER = {
  1: ['Wood', '#a9744f'],
  2: ['Iron', '#9aa0a6'],
  3: ['Silver', '#c8cdd3'],
  4: ['Gold', '#efb420'],
  5: ['Platinum', '#ffffff'],
};
const tierLabel = (t) => (t.unique ? ['Unique', 'var(--accent)'] : TIER[t.tier] || [`Tier ${t.tier ?? '?'}`, '']);
const rankOf = (g) => (g.unique ? 99 : g.tier || 0);
export function renderBadges(root) {
  const badges = STATE.model.badges;
  const awards = badges.reduce((n, g) => n + g.tiers.length, 0);
  listView(root, {
    // "awards", not "badges earned": Refract posts no milestone for the first
    // (Wood) tier, so a badge only ever seen at Wood is missing here entirely.
    title: 'Badges', subtitle: `${fmtInt(awards)} awards across ${fmtInt(badges.length)} badges`,
    items: badges, stateKey: 'badges', twoCol: true,
    searchText: (g) => g.title,
    sorts: [
      { id: 'recent', label: 'Recently earned', fn: (a, b) => (b.last?.getTime() || 0) - (a.last?.getTime() || 0) },
      { id: 'tier', label: 'Highest tier', fn: (a, b) => rankOf(b) - rankOf(a) || (b.last?.getTime() || 0) - (a.last?.getTime() || 0) },
      { id: 'az', label: 'Alphabetical', fn: (a, b) => a.title.localeCompare(b.title) },
    ],
    renderItem: (g) => el('div', { class: 'item' }, [
      el('span', { class: 'item-ico' }, [el('i', { class: 'ph ' + refractIcon(g.icon) })]),
      el('div', { class: 'item-main' }, [
        el('div', { class: 'item-title', text: g.title }),
        // Highest tier first, so the one currently held reads off the top line.
        el('div', { class: 'badge-tiers' }, g.tiers.slice().reverse().map(t => {
          const [name, color] = tierLabel(t);
          return el('div', { class: 'badge-tier' }, [
            el('span', { class: 'badge-tier-n', style: color ? `color:${color}` : '', text: name }),
            el('span', { text: fmtDate(t.at) }),
          ]);
        })),
      ]),
    ]),
    exportName: 'refract-badges',
    exportRow: (g) => ({
      badge: g.title, badge_key: g.key, tier: g.unique ? 'Unique' : (TIER[g.tier]?.[0] ?? ''), awards: g.tiers.length,
      first_earned: g.first ? g.first.toISOString() : '', last_earned: g.last ? g.last.toISOString() : '',
      tiers: g.tiers.map(t => `${tierLabel(t)[0]} ${t.at ? t.at.toISOString().slice(0, 10) : ''}`).join(' | '),
    }),
  });
}
