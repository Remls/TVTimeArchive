import { Enrichment, MovieMeta } from '../core/enrich.js';
import { avatarEl } from '../core/media.js';
import { STATE, UI } from '../core/state.js';
import { Backup, IDB } from '../core/storage.js';
import { $, el, fmtInt } from '../core/util.js';
import { refreshExtended } from '../model/model.js';
import { showChooser } from './landing.js';
import { applyState, hashToState, navigate } from './router.js';
import { renderBadges } from '../views/badges.js';
import { renderCharacters } from '../views/characters.js';
import { pickBackup, renderComments } from '../views/comments.js';
import { renderFriends } from '../views/friends.js';
import { renderHistory } from '../views/history.js';
import { renderHome } from '../views/home.js';
import { renderLists } from '../views/lists.js';
import { renderMovies } from '../views/movies.js';
import { renderNotifications } from '../views/notifications.js';
import { renderProfile } from '../views/profile.js';
import { renderRatings } from '../views/ratings.js';
import { renderRaw } from '../views/raw.js';
import { renderReactions } from '../views/reactions.js';
import { renderShows } from '../views/shows.js';

export const VIEWS = [
  { id: 'home',     label: 'Home',     icon: 'ph-house', render: renderHome },
  // Watch group
  { id: 'shows',    label: 'Shows',    icon: 'ph-television', render: renderShows },
  { id: 'movies',   label: 'Movies',   icon: 'ph-film-slate', render: renderMovies },
  { id: 'watch-history', label: 'Watch history', icon: 'ph-clock-counter-clockwise', render: renderHistory },
  { id: 'lists',    label: 'Lists',    icon: 'ph-list-bullets', render: renderLists },
  // Ratings group
  { id: 'ratings',  label: 'Ratings',  icon: 'ph-star', render: renderRatings },
  { id: 'reactions', label: 'Reactions', icon: 'ph-heart', render: renderReactions },
  { id: 'character-votes', label: 'Character votes', icon: 'ph-mask-happy', render: renderCharacters },
  // Community group
  { id: 'comments', label: 'Comments', icon: 'ph-chat-circle-text', render: renderComments },
  { id: 'notifications', label: 'Notifications', icon: 'ph-bell', render: renderNotifications },
  { id: 'friends',  label: 'Friends',  icon: 'ph-users', render: renderFriends },
  { id: 'badges',   label: 'Badges',   icon: 'ph-medal', render: renderBadges },
  { id: 'profile',  label: 'Profile',  icon: 'ph-user', render: renderProfile },
  { id: 'raw',      label: 'All data', icon: 'ph-database', render: renderRaw },
];

// Views collapsed under one top-level tab. Children must be a contiguous run in VIEWS.
// Desktop: children nest under the group in the sidebar. Mobile: tapping the group tab
// opens a popup menu. The URL uses each child's own id (#/ratings), reflecting the sub-view.
export const GROUPS = {
  watch:     { label: 'Watch',     icon: 'ph-play-circle',  children: ['shows', 'movies', 'watch-history', 'lists'] },
  ratings:   { label: 'Ratings',   icon: 'ph-star',         children: ['ratings', 'reactions', 'character-votes'] },
  community: { label: 'Community', icon: 'ph-users-three',  children: ['comments', 'notifications', 'friends', 'badges'] },
};

export const GROUP_OF = {};   // childViewId -> groupId
for (const [gid, g] of Object.entries(GROUPS)) for (const c of g.children) GROUP_OF[c] = gid;

export function buildChrome() {
  // desktop brand rail (inserted once)
  if (!$('.brand-rail')) {
    const rail = el('div', { class: 'brand-rail' }, [el('img', { class: 'brand-mark small', src: 'favicon.svg', alt: '', width: 22, height: 22 }), 'TV Time Archive']);
    $('#app').prepend(rail);
  }
  const bar = $('#tabbar');
  bar.innerHTML = '';
  const prof = STATE.model && STATE.model.profile;
  const hasAvatar = prof && (prof.avatar || (prof.userId && Backup.urlFor('avatars/' + prof.userId)));
  const seenGroup = new Set();
  const activeNav = GROUP_OF[STATE.view] ? 'group:' + GROUP_OF[STATE.view] : STATE.view;
  const isDesktop = () => window.matchMedia('(min-width: 860px)').matches;
  for (const v of VIEWS) {
    const gid = GROUP_OF[v.id];
    if (gid) {
      if (seenGroup.has(gid)) continue;   // one tab per group, at its first child's slot
      seenGroup.add(gid);
      const g = GROUPS[gid], navId = 'group:' + gid;
      const groupTab = el('button', { class: 'tab group' + (activeNav === navId ? ' active' : ''), 'data-view': navId },
        [el('i', { class: 'ph ' + g.icon + ' tab-ico' }), el('span', { text: g.label }), el('i', { class: 'ph ph-caret-down nav-caret' })]);
      const sub = el('div', { class: 'subnav' });
      for (const cid of g.children) {
        const cv = VIEWS.find(x => x.id === cid); if (!cv) continue;
        const item = el('button', { class: 'subnav-item' + (STATE.view === cid ? ' active' : ''), 'data-view': cid },
          [el('i', { class: 'ph ' + cv.icon }), el('span', { text: cv.label })]);
        item.addEventListener('click', () => { closeNavMenus(); navigate({ view: cid }); });
        sub.append(item);
      }
      groupTab.addEventListener('click', () => {
        // Desktop: enter the group (children nest via CSS). Mobile: toggle the popup.
        if (isDesktop()) { closeNavMenus(); navigate({ view: g.children[0] }); }
        else {
          const isOpen = navPopup && navPopup.tab === groupTab;
          closeNavMenus();
          if (!isOpen) openNavMenu(groupTab, sub);
        }
      });
      bar.append(groupTab, sub);
      continue;
    }
    // The Profile tab shows your avatar (when available) instead of the generic icon.
    const icon = (v.id === 'profile' && hasAvatar)
      ? avatarEl(prof.avatar, prof.displayName, prof.userId && 'avatars/' + prof.userId, 'tab-avatar')
      : el('i', { class: 'ph ' + v.icon + ' tab-ico' });
    bar.append(el('button', {
      class: 'tab' + (activeNav === v.id ? ' active' : ''),
      'data-view': v.id,
      onclick: () => { closeNavMenus(); navigate({ view: v.id }); },
    }, [icon, el('span', { text: v.label })]));
  }
  buildSettingsMenu();
}

// Mobile nav popup: move the group's subnav to <body> (escaping the tabbar's
// backdrop-filter containing block) and anchor it above the tab.
export let navPopup = null;

export function openNavMenu(tab, sub) {
  document.body.appendChild(sub);
  sub.classList.add('floating');
  tab.classList.add('menu-open');
  const r = tab.getBoundingClientRect();
  sub.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 200)) + 'px';
  sub.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  navPopup = { tab, sub };
}

export function closeNavMenus() {
  if (!navPopup) return;
  const { tab, sub } = navPopup;
  tab.classList.remove('menu-open');
  sub.classList.remove('floating');
  sub.style.left = sub.style.bottom = '';
  tab.after(sub);   // restore it into the tabbar (for the desktop nested layout)
  navPopup = null;
}

export function resetApp() {
  IDB.clear();   // "Change source .zip file" also forgets the stored archive
  STATE.tables = {}; STATE.model = null; STATE.listState = {}; STATE.pendingScroll = null;
  history.replaceState(null, '', location.pathname + location.search);   // drop the #/… hash
  $('#app').hidden = true; $('#landing').hidden = false;
  $('#fileInput').value = ''; $('#landingError').hidden = true;
  showChooser();
}

/* Topbar settings menu: auto-load toggle, cache clear, change file. */
export function buildSettingsMenu() {
  const host = $('#settingsHost');
  host.innerHTML = '';
  const gear = el('button', { class: 'settings-btn', title: 'Settings', 'aria-label': 'Settings' }, [el('i', { class: 'ph ph-gear' })]);
  const pop = el('div', { class: 'menu-pop', hidden: '' });

  const sw = el('span', { class: 'switch' + (Enrichment.enabled ? ' on' : '') });
  const toggleItem = el('button', { class: 'menu-item' }, [el('span', { text: 'Auto-load show metadata' }), sw]);
  toggleItem.addEventListener('click', (e) => {
    e.stopPropagation();
    Enrichment.enabled = !Enrichment.enabled;
    try { localStorage.setItem('tvt.enrich', Enrichment.enabled ? '1' : '0'); } catch {}
    sw.classList.toggle('on', Enrichment.enabled);
    applyState(history.state || hashToState());
  });
  const note = el('div', { class: 'menu-note' }, [el('i', { class: 'ph ph-warning-circle' }), el('span', { text: 'This data is fetched from the TVMaze API.' })]);

  // Movie titles via Wikidata (separate opt-in + cache)
  const msw = el('span', { class: 'switch' + (MovieMeta.enabled ? ' on' : '') });
  const movieToggle = el('button', { class: 'menu-item' }, [el('span', { text: 'Auto-load movie titles' }), msw]);
  movieToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    MovieMeta.enabled = !MovieMeta.enabled;
    try { localStorage.setItem('tvt.movies', MovieMeta.enabled ? '1' : '0'); } catch {}
    msw.classList.toggle('on', MovieMeta.enabled);
    applyState(history.state || hashToState());
  });
  const movieNote = el('div', { class: 'menu-note' }, [el('i', { class: 'ph ph-warning-circle' }), el('span', { text: 'This data is fetched from the Wikidata API, and may not be accurate.' })]);

  // Extended backup: import the zip made by extended-backup.py (images + resolved names).
  const IMPORT_LABEL = 'Import extended backup…';
  const importItem = el('button', { class: 'menu-item' }, [el('span', { text: IMPORT_LABEL })]);
  importItem.addEventListener('click', (e) => {
    e.stopPropagation();
    pickBackup((err, count) => {
      importItem.firstChild.textContent = err ? (err.message || 'Import failed') : `Imported ${fmtInt(count)} ✓`;
      setTimeout(() => { importItem.firstChild.textContent = IMPORT_LABEL; }, 1800);
      if (!err) { refreshExtended(); applyState(history.state || hashToState()); }
    });
  });
  const importNote = el('div', { class: 'menu-note' }, [el('i', { class: 'ph ph-info' }), el('span', {}, [
    'Comment images, avatars, badges, characters & friends. Generate it with extended-backup.py — see the ',
    el('a', { href: 'https://github.com/Remls/TVTimeArchive#extended-backup', target: '_blank', rel: 'noopener noreferrer', text: 'README' }), '.',
  ])]);

  // Umbrella "Clear cache…" — expands to per-cache clears, each confirm-gated.
  const clearWrap = el('div', { class: 'menu-sub-wrap' });
  const clearToggle = el('button', { class: 'menu-item' }, [el('span', { text: 'Clear cache…' }), el('i', { class: 'ph ph-caret-right menu-caret' })]);
  const clearSub = el('div', { class: 'menu-sub', hidden: '' });
  const makeClear = (label, confirmMsg, fn) => {
    const item = el('button', { class: 'menu-item sub' }, [el('span', { text: label })]);
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(confirmMsg)) return;
      const n = await fn();
      item.firstChild.textContent = n ? `Cleared ${fmtInt(n)} ✓` : 'Nothing to clear';
      setTimeout(() => { item.firstChild.textContent = label; }, 1500);
      applyState(history.state || hashToState());
    });
    return item;
  };
  clearSub.append(
    makeClear('Show metadata', 'Clear cached show metadata?', () => Enrichment.clearCache()),
    makeClear('Movie titles', 'Clear cached movie titles?', () => MovieMeta.clearCache()),
    makeClear('Imported backup', 'Clear the imported backup (images + resolved names) from this browser?', () => Backup.clear()),
  );
  clearToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSub.hidden = !clearSub.hidden;
    clearToggle.querySelector('.menu-caret').classList.toggle('open', !clearSub.hidden);
  });
  clearWrap.append(clearToggle, clearSub);

  const changeItem = el('button', { class: 'menu-item' }, [el('span', { text: 'Change source .zip file' })]);
  changeItem.addEventListener('click', () => {
    if (!confirm('This forgets the loaded archive (cached metadata and comment images stay). Continue?')) return;
    close(); resetApp();
  });

  pop.append(toggleItem, note, el('div', { class: 'menu-sep' }), movieToggle, movieNote,
    el('div', { class: 'menu-sep' }), importItem, importNote,
    el('div', { class: 'menu-sep' }), clearWrap,
    el('div', { class: 'menu-sep' }), changeItem);
  host.append(gear, pop);

  const onDoc = (e) => { if (!host.contains(e.target)) close(); };
  function close() { pop.hidden = true; document.removeEventListener('click', onDoc); if (UI.activePopup === close) UI.activePopup = null; }
  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) {
      if (UI.activePopup) UI.activePopup();
      pop.hidden = false; UI.activePopup = close;
      setTimeout(() => document.addEventListener('click', onDoc), 0);
    }
    else close();
  });
}
