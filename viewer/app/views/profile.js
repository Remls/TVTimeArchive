import { avatarEl } from '../core/media.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtDateTime, nonEmpty } from '../core/util.js';

export function renderProfile(root) {
  const p = STATE.model.profile;

  // Hero: cover fills the top and fades into the page; avatar + name centred over it.
  const cover = (p.personal || {}).cover;
  const hasCover = nonEmpty(cover) && /^https?:\/\//.test(cover);
  const hero = el('div', { class: 'profile-hero' + (hasCover ? '' : ' no-cover') });
  if (hasCover) hero.append(el('div', { class: 'profile-hero-bg', style: `background-image:url("${cover.replace(/"/g, '%22')}")` }));
  hero.append(el('div', { class: 'profile-hero-body' }, [
    avatarEl(p.avatar, p.displayName, p.userId && 'avatars/' + p.userId, 'xl'),
    el('div', { class: 'profile-hero-name', text: p.displayName || '-' }),
    p.username && p.username !== p.displayName ? el('div', { class: 'profile-hero-sub', text: '@' + p.username }) : null,
  ]));
  root.append(hero);

  root.append(el('div', { class: 'section-title', text: 'Account details' }));
  const rows = [
    ['Name', p.name], ['Username', p.username], ['Email', p.email], ['Language', p.language], ['Timezone', p.timezone],
    ['Member since', fmtDate(p.createdAt)], ['Last opened', fmtDateTime(p.lastOpened)],
    ['Days active', p.daysActive], ['Weeks active', p.weeksActive], ['Months active', p.monthsActive],
  ].filter(([, v]) => nonEmpty(v) && v !== '-');
  const dl = el('dl', { class: 'kv' });
  for (const [k, v] of rows) { dl.append(el('dt', { text: k }), el('dd', { text: v })); }
  root.append(dl);

  // extra personal-data key/values (cover is the hero background, not a row)
  const extra = Object.entries(p.personal || {}).filter(([k, v]) => nonEmpty(v) && k !== 'cover');
  if (extra.length) {
    root.append(el('div', { class: 'section-title', text: 'Personal data' }));
    const dl2 = el('dl', { class: 'kv' });
    for (const [k, v] of extra) { dl2.append(el('dt', { text: k }), el('dd', { text: v })); }
    root.append(dl2);
  }
}
