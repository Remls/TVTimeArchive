import { UI } from './state.js';
import { Backup } from './storage.js';
import { $, el } from './util.js';

// Inline "image unavailable" placeholder, shown when an image is neither backed
// up locally nor reachable on the (possibly retired) server.
export const BROKEN_IMG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">' +
  '<rect width="320" height="180" rx="10" fill="#241c15"/>' +
  '<rect x="1" y="1" width="318" height="178" rx="9" fill="none" stroke="#2f261e"/>' +
  '<g fill="none" stroke="#6f6456" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="120" y="62" width="80" height="60" rx="6"/>' +
  '<path d="M120 104 l20 -18 l16 14 l18 -20 l26 24"/>' +
  '<circle cx="146" cy="82" r="6"/>' +
  '<path d="M112 54 l96 76" stroke="#8a5040"/>' +
  '</g>' +
  '<text x="160" y="150" text-anchor="middle" font-family="Instrument Sans, Helvetica, Arial, sans-serif" font-size="14" fill="#a89e92">Image unavailable</text>' +
  '</svg>'
);

export function openLightbox(src) {
  if (UI.activeLightbox) return;
  const img = el('img', { src, alt: '' });
  const overlay = el('div', { class: 'lightbox' }, [img]);
  const onKey = (e) => { if (e.key === 'Escape') history.back(); };
  const remove = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  overlay.addEventListener('click', () => history.back());   // -> popstate -> close
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  history.pushState({ lightbox: true }, '');
  UI.activeLightbox = remove;
}

// A circular user avatar. Prefers a local backup (by full key, e.g. "avatars/<id>" or
// "friends/<id>"), then the live CloudFront picture, then initials.
export function avatarEl(url, name, backupKey, cls) {
  const wrap = el('span', { class: 'avatar' + (cls ? ' ' + cls : '') });
  const local = backupKey ? Backup.urlFor(backupKey) : null;
  const src = local || (url || '').trim();
  const fallback = () => wrap.append(el('span', { class: 'avatar-fallback', text: (name || '').trim().slice(0, 1).toUpperCase() || '?' }));
  if (src) {
    const img = el('img', { src, alt: name ? `${name} avatar` : '', loading: 'lazy' });
    if (!local) img.addEventListener('error', () => { img.remove(); if (!wrap.querySelector('.avatar-fallback')) fallback(); });
    wrap.append(img);
  } else {
    fallback();
  }
  return wrap;
}

// A plain <img> that tries a local backup (by key) then a live URL, then a placeholder.
// Same local-then-live rule as everything else; used for badge art, posters, etc.
export function resilientImg(backupKey, liveUrl, opts = {}) {
  const local = backupKey ? Backup.urlFor(backupKey) : null;
  const url = (liveUrl || '').trim();
  const img = el('img', { src: local || url || BROKEN_IMG, loading: 'lazy', alt: opts.alt || '', class: opts.class || '' });
  if (!local) {
    if (!url) img.classList.add('broken');
    else img.addEventListener('error', () => { if (img.src !== BROKEN_IMG) { img.src = BROKEN_IMG; img.classList.add('broken'); } });
  }
  return img;
}

// Resolve a notification's image to a { key, url }, the backup key (folder-namespaced)
// and the live URL. The task-4 backup script mirrors this so local copies line up.
export function notifImageRef(r) {
  const url = (r.image || '').trim();
  if (!url) return null;
  const av = url.match(/\/user\/(\d+)\/profile_picture/);
  if (av) return { key: 'avatars/' + av[1], url, kind: 'avatar' };
  if (r.type === 'badge-unlocked') {
    const b = (r.url || '').match(/badge_id=([^&]+)/);
    return { key: b ? 'badges/' + b[1] : null, url, kind: 'badge' };
  }
  return { key: null, url, kind: 'other' };   // show posters etc., live-only for now
}

// A sized image box (poster / thumbnail / cover) that opens full-size on click.
// `cls` sizes the frame; `src` is the thumbnail; `fullSrc` (optional) is the higher-res
// image shown in the lightbox. With no src it's an empty placeholder of that shape.
export function zoomImg(cls, src, alt, fullSrc) {
  if (!src) return el('div', { class: cls });
  const img = el('img', { src, loading: 'lazy', alt: alt || '' });
  return el('button', {
    class: cls + ' img-zoom', title: 'View image',
    onclick: (e) => { e.stopPropagation(); openLightbox(fullSrc || img.currentSrc || img.src); },
  }, [img]);
}
