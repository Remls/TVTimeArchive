import { openLightbox } from '../../app/core/media.js';
import { el } from '../../app/core/util.js';
import { chip } from '../../app/ui/kit.js';

/* Refract-specific UI helpers shared by its views. */

// TVmaze enrichment disambiguation: only duplicate titles pass their year
// (giving them their own cache slot); everything else shares the plain
// name-keyed cache with the TV Time viewer.
export const metaYear = (m) => (m && m.ambiguous ? m.year : null);

// v3 carries a TheTVDB id, which TVmaze looks up directly and which shares the
// TV Time viewer's cache keys. v1 has no ids, so it keeps searching by name.
export const seriesIdOf = (m) => (m && m.tvdbId ? String(m.tvdbId) : '');

// Enrichment work item: year drives disambiguation, hintYear guards fuzzy matches.
export const enrichItem = (m) => ({ seriesId: seriesIdOf(m), title: m.title, year: metaYear(m), hintYear: m.year });

// null defers to the caller's default (the TV icon)
export const kindIcon = (m) => (m && m.isAnime ? 'ph-flower-lotus' : null);

// Refract rates on a 1-10 scale; a ten-star bar would drown the rows, so the
// rating renders as one star with the number inside.
export function rating10(n) {
  if (!n) return null;
  return el('span', { class: 'star-num', title: `Rated ${n}/10` }, [
    el('i', { class: 'ph-fill ph-star' }),
    el('b', { text: n }),
  ]);
}

// ISO 3166 codes (single or "; "-separated) to display names, best-effort.
const regionNames = (() => {
  try { return new Intl.DisplayNames(undefined, { type: 'region' }); } catch { return null; }
})();
export function countryNames(codes) {
  if (!codes || !codes.length) return '';
  return codes.map(c => { try { return (regionNames && regionNames.of(c)) || c; } catch { return c; } }).join(', ');
}

// Mood tags and watch contexts arrive as snake_case tokens ("fun_ride").
export const humanizeTag = (t) => (t || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export const tagChips = (tags, icon) => tags.map(t => chip(humanizeTag(t), { icon }));

// Refract's own emoji for each mood tag; tags it doesn't know keep a sparkle icon.
const MOOD_EMOJI = {
  mind_bending: '🎭', mindbending: '🎭', plot_twist: '🤯', slow_burn: '🐌', stunning: '🎨',
  hilarious: '😂', fun_ride: '🍿', terrifying: '😱', dark: '💀',
  wholesome: '🥰', masterpiece: '🔥', heartbreaking: '💔', frustrating: '😤',
  overhyped: '🏆', boring: '😴', underrated: '💎',
};
export const moodText = (t) => (MOOD_EMOJI[t] ? MOOD_EMOJI[t] + ' ' : '') + humanizeTag(t);
export const moodChips = (tags) => tags.map(t => (MOOD_EMOJI[t] ? chip(moodText(t)) : chip(humanizeTag(t), { icon: 'ph-sparkle' })));

/* -------------------------------------------------------------------
   Review text rendering. Refract reviews use a markdown subset (bold,
   italic, strikethrough, ||inline spoilers||, links, quotes, lists,
   @mentions).
   Only a real newline breaks a line. The v1 CSV flattened its newlines to
   runs of spaces, which are left as spaces, so a v1 review renders as one
   paragraph. v1 also stripped [media:…] tags; v3 keeps them, and the image
   they name is not in the export. Their uuid does resolve on Refract's CDN,
   so they load from there and fall back to a marker when it 404s (older or
   animated uploads do).
   ------------------------------------------------------------------- */
const INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\|\|(.+?)\|\||\[media:([^\]]+)\]|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)|(^|\s)@([\w.-]+)/;

/* The export names an attached image only by uuid. This path is not documented
   anywhere; it was derived from the one absolute URL the export does carry
   (profile.bannerUrl) and confirmed against the CDN, so it is best-effort and
   the chip stands in whenever it fails. */
const MEDIA_URL = (id) => `https://cdn.getrefract.app/media/${encodeURIComponent(id)}.jpg`;

function mediaEl(id) {
  const wrap = el('span', { class: 'cmt-images' });
  const img = el('img', { class: 'cmt-img', src: MEDIA_URL(id), loading: 'lazy', alt: 'Attached image' });
  const btn = el('button', {
    class: 'cmt-img-btn', title: 'View image',
    onclick: (e) => { e.stopPropagation(); openLightbox(img.currentSrc || img.src); },
  }, [img]);
  img.addEventListener('error', () => { btn.replaceWith(chip('Image', { icon: 'ph-image' })); });
  wrap.append(btn);
  return wrap;
}

const link = (href, label) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: label });

const spoilerSpan = (content) => {
  const s = el('span', { class: 'spoiler-inline', title: 'Spoiler. Click to reveal.' }, inline(content));
  s.addEventListener('click', (e) => { e.stopPropagation(); s.classList.toggle('revealed'); });
  return s;
};

function inline(text) {
  const nodes = [];
  let rest = text;
  while (rest) {
    const m = rest.match(INLINE_RE);
    if (!m) { nodes.push(rest); break; }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    if (m[1] != null) nodes.push(el('strong', {}, inline(m[1])));
    else if (m[2] != null) nodes.push(el('em', {}, inline(m[2])));
    else if (m[3] != null) nodes.push(el('s', {}, inline(m[3])));
    else if (m[4] != null) nodes.push(spoilerSpan(m[4]));
    else if (m[5] != null) nodes.push(mediaEl(m[5]));
    else if (m[6] != null) nodes.push(link(m[7], m[6]));
    else if (m[8] != null) nodes.push(link(m[8], m[8]));
    else { if (m[9]) nodes.push(m[9]); nodes.push(el('span', { class: 'mention', text: '@' + m[10] })); }
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes;
}

export function reviewText(text, isSpoiler) {
  if (!text) return null;
  const root = el('div', { class: 'review-text' });
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  let i = 0;
  const run = (test, make, strip) => {
    const box = make();
    while (i < lines.length && test(lines[i])) { box.append(el(box.tagName === 'BLOCKQUOTE' ? 'p' : 'li', {}, inline(strip(lines[i])))); i++; }
    root.append(box);
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line === '---') { root.append(el('div', { class: 'text-rule' })); i++; }
    else if (line.startsWith('> ')) run(l => l.startsWith('> '), () => el('blockquote', { class: 'text-quote' }), l => l.slice(2));
    else if (/^- /.test(line)) run(l => /^- /.test(l), () => el('ul'), l => l.slice(2));
    else if (/^\d+\. /.test(line)) run(l => /^\d+\. /.test(l), () => el('ol'), l => l.replace(/^\d+\. /, ''));
    else { root.append(el('p', {}, inline(line))); i++; }
  }
  // whole-review spoiler flag with no inline markers: blur everything (legacy reviews)
  if (isSpoiler && !text.includes('||')) {
    root.classList.add('spoiler');
    root.title = 'Marked as a spoiler. Click to reveal.';
    root.addEventListener('click', (e) => { e.stopPropagation(); root.classList.toggle('revealed'); });
  }
  return root;
}
