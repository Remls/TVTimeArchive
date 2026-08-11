import { APP } from '../core/app.js';
import { Enrichment, MovieMeta } from '../core/enrich.js';
import { avatarEl } from '../core/media.js';
import { STATE, UI } from '../core/state.js';
import { Backup } from '../core/storage.js';
import { $, el, fmtInt } from '../core/util.js';
import { showChooser } from './landing.js';
import { applyState, hashToState, navigate } from './router.js';

export function buildChrome() {
  // desktop brand rail (inserted once)
  if (!$('.brand-rail')) {
    const rail = el('div', { class: 'brand-rail' }, [el('img', { class: 'brand-mark small', src: 'favicon.svg', alt: '', width: 22, height: 22 }), APP.brand.title]);
    $('#app').prepend(rail);
  }
  const bar = $('#tabbar');
  bar.innerHTML = '';
  const prof = STATE.model && STATE.model.profile;
  const hasAvatar = prof && (prof.avatar || (prof.userId && Backup.urlFor('avatars/' + prof.userId)));
  const seenGroup = new Set();
  const activeNav = APP.groupOf[STATE.view] ? 'group:' + APP.groupOf[STATE.view] : STATE.view;
  const isDesktop = () => window.matchMedia('(min-width: 860px)').matches;
  for (const v of APP.views) {
    const gid = APP.groupOf[v.id];
    if (gid) {
      if (seenGroup.has(gid)) continue;   // one tab per group, at its first child's slot
      seenGroup.add(gid);
      const g = APP.groups[gid], navId = 'group:' + gid;
      const groupTab = el('button', { class: 'tab group' + (activeNav === navId ? ' active' : ''), 'data-view': navId },
        [el('i', { class: 'ph ' + g.icon + ' tab-ico' }), el('span', { text: g.label }), el('i', { class: 'ph ph-caret-down nav-caret' })]);
      const sub = el('div', { class: 'subnav' });
      for (const cid of g.children) {
        const cv = APP.views.find(x => x.id === cid); if (!cv) continue;
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
  buildInfoButtons();
}

/* Topbar About button: a dropdown with the same copy as the landing footer,
   instead of jumping straight to the external pages. */
const extLink = (href, kids) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, kids);

function buildInfoButtons() {
  const host = $('#aboutHost');
  if (!host) return;
  host.innerHTML = '';
  const btn = el('button', { class: 'icon-btn', title: 'About this tool', 'aria-label': 'About this tool' }, [el('i', { class: 'ph ph-info' })]);
  const pop = el('div', { class: 'menu-pop', hidden: '' }, [
    el('div', { class: 'menu-info' }, [
      'Created by ', extLink('https://remls.io', ['Remls']), '.', el('br'),
      'This project is open source on ',
      extLink('https://github.com/Remls/TVTimeArchive', [el('i', { class: 'ph ph-github-logo' }), ' GitHub']), '.',
    ]),
    el('div', { class: 'menu-sep' }),
    el('div', { class: 'menu-info' }, [
      'This tool is free to use, and will always remain that way.', el('br'),
      'If you found it useful, consider supporting me on ',
      extLink('https://ko-fi.com/remls', [el('i', { class: 'ph ph-coffee' }), ' Ko-fi']), '.',
    ]),
  ]);
  const onDoc = (e) => { if (!host.contains(e.target)) close(); };
  function close() { pop.hidden = true; document.removeEventListener('click', onDoc); if (UI.activePopup === close) UI.activePopup = null; }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) {
      if (UI.activePopup) UI.activePopup();
      pop.hidden = false; UI.activePopup = close;
      setTimeout(() => document.addEventListener('click', onDoc), 0);
    } else close();
  });
  host.append(btn, pop);
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
  APP.archive.clear();   // "Change source .zip file" also forgets the stored archive
  STATE.tables = {}; STATE.model = null; STATE.listState = {}; STATE.pendingScroll = null;
  history.replaceState(null, '', location.pathname + location.search);   // drop the #/… hash
  $('#app').hidden = true; $('#landing').hidden = false;
  $('#fileInput').value = ''; $('#landingError').hidden = true;
  showChooser();
}

/* Topbar settings menu: auto-load toggles, per-app extras, cache clear, change file. */
export function buildSettingsMenu() {
  const host = $('#settingsHost');
  host.innerHTML = '';
  const gear = el('button', { class: 'settings-btn', title: 'Settings', 'aria-label': 'Settings' }, [el('i', { class: 'ph ph-gear' })]);
  const pop = el('div', { class: 'menu-pop', hidden: '' });
  const sep = () => el('div', { class: 'menu-sep' });
  const refresh = () => applyState(history.state || hashToState());

  const sw = el('span', { class: 'switch' + (Enrichment.enabled ? ' on' : '') });
  const toggleItem = el('button', { class: 'menu-item' }, [el('span', { text: 'Auto-load show metadata' }), sw]);
  toggleItem.addEventListener('click', (e) => {
    e.stopPropagation();
    Enrichment.enabled = !Enrichment.enabled;
    try { localStorage.setItem('tvt.enrich', Enrichment.enabled ? '1' : '0'); } catch {}
    sw.classList.toggle('on', Enrichment.enabled);
    refresh();
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
    refresh();
  });
  const movieNote = el('div', { class: 'menu-note' }, [el('i', { class: 'ph ph-warning-circle' }), el('span', { text: 'This data is fetched from the Wikidata API, and may not be accurate.' })]);

  // Umbrella "Clear cache…", expands to per-cache clears, each confirm-gated.
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
      refresh();
    });
    return item;
  };

  // App-specific settings entries (e.g. the TV Time extended-backup import).
  const extras = APP.settingsExtras ? APP.settingsExtras({ makeClear, refresh }) : null;

  clearSub.append(
    makeClear('Show metadata', 'Clear cached show metadata? This cache is shared by the TV Time and Refract viewers.', () => Enrichment.clearCache()),
    makeClear('Movie titles', 'Clear cached movie titles? This cache is shared by the TV Time and Refract viewers.', () => MovieMeta.clearCache()),
    ...((extras && extras.clears) || []),
  );
  clearToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSub.hidden = !clearSub.hidden;
    clearToggle.querySelector('.menu-caret').classList.toggle('open', !clearSub.hidden);
  });
  clearWrap.append(clearToggle, clearSub);

  const changeItem = el('button', { class: 'menu-item' }, [el('span', { text: 'Change source .zip file' })]);
  changeItem.addEventListener('click', () => {
    if (!confirm('This forgets the loaded archive (cached metadata stays). Continue?')) return;
    close(); resetApp();
  });

  pop.append(toggleItem, note, sep(), movieToggle, movieNote);
  const extraItems = (extras && extras.items) || [];
  if (extraItems.length) pop.append(sep(), ...extraItems);
  pop.append(sep(), clearWrap, sep(), changeItem);
  if (APP.crossLink) {
    // new tab so an installed PWA doesn't render the sibling app inside its own window
    pop.append(sep(), el('a', { class: 'menu-item', href: APP.crossLink.href, target: '_blank' }, [
      el('span', { text: APP.crossLink.label }),
      el('i', { class: 'ph ph-arrow-square-out menu-caret' }),
    ]));
  }
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
