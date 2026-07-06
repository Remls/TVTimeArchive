import { BROKEN_IMG, openLightbox } from '../core/media.js';
import { STATE } from '../core/state.js';
import { Backup } from '../core/storage.js';
import { $, el, fmtDate, fmtInt, truncate } from '../core/util.js';
import { refreshExtended } from '../model/model.js';
import { backupNote, entityNav, listView } from '../ui/kit.js';
import { navigate, renderView } from '../ui/router.js';
import { pad2 } from './shows.js';

// Ordered image sources to try for one attachment, best first:
//   clean (no TV Time watermark) before marked, and a local backup before the live
//   CDN copy within each. Ends with an "unavailable" placeholder.
export function imageCandidates(m) {
  const out = [];
  const add = (u) => { if (u && !out.includes(u)) out.push(u); };
  add(Backup.urlFor('comments/' + m.id + '-clean'));   // local clean backup (foldered)
  add(Backup.urlFor(m.id + '-clean'));                 // …or legacy flat zip
  add(m.clean);                                             // live clean
  add(Backup.urlFor('comments/' + m.id + '-marked'));  // local marked backup (foldered)
  add(Backup.urlFor(m.id + '-marked'));                // …or legacy flat zip
  add(Backup.urlFor(m.id));                            // …or very old single-file zip
  add(m.url);                                               // live marked
  out.push(BROKEN_IMG);
  return out;
}

export function commentImageEl(m) {
  const cands = imageCandidates(m);
  let idx = 0;
  const img = el('img', {
    class: 'cmt-img', loading: 'lazy',
    alt: m.kind === 'gif' ? 'Attached gif' : 'Attached image',
    src: cands[0],
  });
  if (cands[0] === BROKEN_IMG) img.classList.add('broken');
  // Walk down the list as sources fail (e.g. a retired server or a missing variant).
  img.addEventListener('error', () => {
    if (idx < cands.length - 1) { img.src = cands[++idx]; }
    if (cands[idx] === BROKEN_IMG) img.classList.add('broken');
  });
  return el('button', {
    class: 'cmt-img-btn', title: 'View image',
    onclick: () => openLightbox(img.currentSrc || img.src),
  }, [img]);
}

// Open a file picker for a backup zip and import it. cb(err, count) on completion.
export function pickBackup(cb) {
  const inp = el('input', { type: 'file', accept: '.zip,application/zip', hidden: '' });
  document.body.append(inp);
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0]; inp.remove();
    if (!f) return;
    try { cb(null, await Backup.importZip(f)); }
    catch (e) { cb(e); }
  });
  inp.click();
}

export const COMMENT_ICON = { episode: 'ph-television', show: 'ph-television', series: 'ph-television', movie: 'ph-film-slate', profile: 'ph-user' };

/* One comment, rendered as a card. Shared by the Comments view and the detail pages.
   opts.compact drops the "what it's on" header (used where the context is already shown,
   e.g. under an episode in the show detail). */
export function commentCard(e, opts = {}) {
  const head = [];
  if (!opts.compact) {
    const label = e.kind === 'episode' && e.season
      ? `${e.target} S${pad2(e.season)}E${pad2(e.episode)}`
      : (e.target || '-');
    const nav = entityNav(e.kind, e.target);
    const targetEl = el('span', { class: 'cmt-target' + (nav ? ' clickable' : '') }, [
      el('i', { class: 'ph ' + (COMMENT_ICON[e.kind] || 'ph-chat-circle-text') }), ' ' + label,
    ]);
    if (nav) targetEl.addEventListener('click', () => navigate(nav));
    head.push(targetEl);
  }
  head.push(el('span', { class: 'cmt-date', text: fmtDate(e.date) }));

  const kids = [el('div', { class: 'cmt-head' }, head)];

  // Always mark replies (even in the compact show-detail view) so it's clear a comment
  // is a reply to another comment, including your own.
  if (e.isReply) {
    kids.push(e.parent
      ? el('div', { class: 'cmt-parent' }, [el('i', { class: 'ph ph-arrow-bend-up-left' }), el('span', { text: truncate(e.parent.text, 140) })])
      : el('div', { class: 'cmt-parent muted' }, [el('i', { class: 'ph ph-arrow-bend-up-left' }), el('span', { text: 'Reply to a comment that isn’t in the export' })]));
  }

  if (e.text) kids.push(el('div', { class: 'cmt-text', text: e.text }));
  if (e.images.length) kids.push(el('div', { class: 'cmt-images' }, e.images.map(commentImageEl)));

  // Only the like count is worth a meta line; images are always singular and shown inline.
  if (e.likes) kids.push(el('div', { class: 'cmt-metaline' }, [
    el('span', { html: `<i class="ph-fill ph-heart" style="color:var(--accent)"></i> ${fmtInt(e.likes)}` }),
  ]));

  return el('article', { class: 'cmt' }, kids);
}

export function renderComments(root) {
  const c = STATE.model.comments;
  const subtitle = c.imageCount
    ? `${fmtInt(c.list.length)} comments, ${fmtInt(c.imageCount)} image${c.imageCount === 1 ? '' : 's'}`
    : `${fmtInt(c.list.length)} comments`;

  listView(root, {
    title: 'Comments', subtitle, items: c.list, stateKey: 'comments',
    searchText: (e) => `${e.text} ${e.target}`,
    beforeList: c.imageCount ? (pre) => pre.append(commentBackupBanner()) : null,
    filter: { default: 'all', options: [
      { id: 'all', label: 'All comments', test: () => true },
      { id: 'images', label: 'With image', test: e => e.images.length > 0 },
      { id: 'episode', label: 'On episodes', test: e => e.kind === 'episode' },
      { id: 'show', label: 'On shows', test: e => e.kind === 'show' || e.kind === 'series' },
      { id: 'movie', label: 'On movies', test: e => e.kind === 'movie' },
      { id: 'profile', label: 'On profiles', test: e => e.kind === 'profile' },
      { id: 'replies', label: 'Replies', test: e => e.isReply },
    ] },
    sorts: [
      { id: 'recent', label: 'Newest first', fn: (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) },
      { id: 'oldest', label: 'Oldest first', fn: (a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0) },
      { id: 'likes', label: 'Most liked', fn: (a, b) => b.likes - a.likes },
    ],
    renderItem: commentCard,
    exportName: 'tvtime-comments',
    exportRow: (e) => ({
      date: e.date ? e.date.toISOString() : '', kind: e.kind, on: e.target,
      season: e.season ?? '', episode: e.episode ?? '',
      text: e.text, likes: e.likes, is_reply: e.isReply ? 'yes' : 'no',
      images: e.images.map(m => m.url).join(' '),
    }),
  });
}

// Banner above the comments list: image status + one action.
// With a backup loaded, images come from the local copy, so the action becomes
// "Clear backup"; otherwise it's "Import backup".
export function commentBackupBanner() {
  const n = Backup.countComments();
  const readme = 'https://github.com/Remls/TVTimeArchive#extended-backup';
  const body = n
    ? `${fmtInt(n)} saved locally.`
    : ['Loaded live from TV Time. ',
        el('a', { href: readme, target: '_blank', rel: 'noopener noreferrer', text: 'Back them up' }),
        ' before the servers close.'];

  // Redraw the whole view so images swap between local copies and live URLs.
  const refresh = () => { if (STATE.view === 'comments') renderView('comments'); };

  let btn;
  if (n) {
    btn = el('button', { class: 'btn secondary', html: '<i class="ph ph-trash"></i> Clear backup' });
    btn.addEventListener('click', async () => { await Backup.clear(); refresh(); });
  } else {
    btn = el('button', { class: 'btn secondary', html: '<i class="ph ph-upload-simple"></i> Import backup' });
    btn.addEventListener('click', () => pickBackup((err) => {
      if (err) { btn.innerHTML = '<i class="ph ph-warning"></i> ' + (err.message || 'Import failed'); return; }
      refreshExtended(); refresh();
    }));
  }
  return backupNote({ icon: 'ph-images', title: 'Comment images', body, action: btn });
}
