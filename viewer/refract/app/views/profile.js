import { avatarEl } from '../../../app/core/media.js';
import { STATE } from '../../../app/core/state.js';
import { el, fmtDate, fmtInt, nonEmpty } from '../../../app/core/util.js';
import { countryNames, humanizeTag } from '../kit.js';

/* Your Refract account settings. The export carries 80-odd fields, most of
   them notification toggles, so they are grouped rather than listed flat. */

const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : null);
const listOf = (v) => (Array.isArray(v) && v.length ? v.join(', ') : null);
// "notifListCopies" -> "In-app list copies"
const notifLabel = (k) => `${k.startsWith('push') ? 'Push' : 'In-app'} `
  + k.replace(/^(notif|push)/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

const kvBlock = (rows) => {
  const dl = el('dl', { class: 'kv' });
  for (const [k, v] of rows.filter(([, v]) => nonEmpty(v))) dl.append(el('dt', { text: k }), el('dd', { text: String(v) }));
  return dl.children.length ? dl : null;
};

const section = (root, title, rows) => {
  const dl = kvBlock(rows);
  if (!dl) return;
  root.append(el('div', { class: 'section-title', text: title }), dl);
};

export function renderProfile(root) {
  const p = STATE.model.profile;

  const hero = el('div', { class: 'profile-hero' + (p.banner ? '' : ' no-cover') });
  if (p.banner) hero.append(el('div', { class: 'profile-hero-bg', style: `background-image:url("${p.banner.replace(/"/g, '%22')}")` }));
  hero.append(el('div', { class: 'profile-hero-body' }, [
    avatarEl(p.avatar, p.displayName, null, 'xl'),
    el('div', { class: 'profile-hero-name', text: p.displayName || '-' }),
    p.username && p.username !== p.displayName ? el('div', { class: 'profile-hero-sub', text: '@' + p.username }) : null,
    p.bio ? el('div', { class: 'profile-hero-sub', text: p.bio }) : null,
  ]));
  root.append(hero);

  section(root, 'Account', [
    ['Name', p.name],
    ['Username', p.username],
    ['Country', countryNames([p.country, p.countrySecondary].filter(Boolean))],
    ['Timezone', p.timezone],
    ['Language', p.locale],
    ['Understood languages', listOf(p.understoodLanguages)],
    ['Private account', yesNo(p.isPrivate)],
    ['Profile visible to', p.profileVisibility ? humanizeTag(p.profileVisibility) : null],
  ]);

  section(root, 'Refract', [
    // Cosmetic ids, shown verbatim: the export carries no display names for them.
    ['Equipped title', p.equippedTitle],
    ['Equipped badge', p.equippedBadge],
    ['Equipped frame', p.equippedFrame],
    ['Featured list', p.featuredList],
    ['Home layout', p.homeLayout ? humanizeTag(p.homeLayout) : null],
    ['Home sections', listOf((p.homeSectionLayout || {}).order)],
    ['Hidden sections', listOf((p.homeSectionLayout || {}).hidden)],
    ['Name colour', (p.nameStyle || {}).colorId],
  ]);

  section(root, 'Preferences', [
    ['Tracking', [p.mediaTypeTvShows && 'TV shows', p.mediaTypeAnime && 'Anime', p.mediaTypeMovies && 'Movies'].filter(Boolean).join(', ')],
    ['Show specials', yesNo(p.showSpecials)],
    ['Include adult titles', yesNo(p.includeAdult)],
    ['Always show spoilers', yesNo(p.alwaysShowSpoilers)],
    ['Hide seen by default', yesNo(p.hideSeenDefault)],
    ['Start on next episode', yesNo(p.startOnNext)],
    ['Prompt to rate', yesNo(p.autoRatePrompt)],
    ['Default mark date', p.defaultMarkDate ? humanizeTag(p.defaultMarkDate) : null],
    ['Air-date offset', p.airDateOffset === 0 ? 'None' : p.airDateOffset],
    ['Streaming types', listOf(p.streamingTypes)],
    ['Haptics', yesNo(p.hapticsEnabled)],
  ]);

  // 30-odd in-app and push toggles: worth keeping, not worth the room by default.
  const notif = Object.keys(p).filter(k => /^(notif|push)/.test(k)).sort();
  const notifRows = kvBlock([
    ['Quiet hours', yesNo(p.quietHoursEnabled)],
    ['Quiet from', p.quietHoursEnabled ? p.quietHoursFrom : null],
    ['Quiet to', p.quietHoursEnabled ? p.quietHoursTo : null],
    ...notif.map(k => [notifLabel(k), yesNo(p[k])]),
  ]);
  if (notifRows) {
    root.append(el('details', { class: 'kv-group' }, [
      el('summary', {}, [
        el('i', { class: 'ph ph-caret-right kv-caret' }),
        el('span', { text: 'Notifications' }),
        el('span', { class: 'kv-count', text: `${notif.filter(k => p[k]).length} of ${notif.length} on` }),
      ]),
      notifRows,
    ]));
  }

  const b = p.backup;
  section(root, 'This backup', [
    ['Created', b && b.generatedAt ? fmtDate(b.generatedAt) : null],
    ['Format version', b && b.formatVersion],
    ['Sections', b && b.sections],
    ['Includes archived sections', b ? yesNo(b.includeArchived) : null],
  ]);
}
