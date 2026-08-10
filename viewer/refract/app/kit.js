import { el } from '../../app/core/util.js';
import { chip } from '../../app/ui/kit.js';

/* Refract-specific UI helpers shared by its views. */

// TVmaze enrichment disambiguation: only duplicate titles pass their year
// (giving them their own cache slot); everything else shares the plain
// name-keyed cache with the TV Time viewer.
export const metaYear = (m) => (m && m.ambiguous ? m.year : null);

// Enrichment work item: year drives disambiguation, hintYear guards fuzzy matches.
export const enrichItem = (m) => ({ seriesId: '', title: m.title, year: metaYear(m), hintYear: m.year });

// null defers to the caller's default (the TV icon)
export const kindIcon = (m) => (m && m.isAnime ? 'ph-flower-lotus' : null);

// Refract rates on a 1-10 scale; a ten-star bar would drown the rows, so the
// chip is one filled star plus the number.
export function rating10(n) {
  if (!n) return null;
  return el('span', { class: 'rating-chip', title: `Rated ${n}/10`, html: `<i class="ph-fill ph-star"></i> ${n}/10` });
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
   @mentions). The CSV export flattens newlines to double spaces and
   strips [media:…] tags, so lines are recovered by splitting on runs of
   2+ spaces and media never appears.
   ------------------------------------------------------------------- */
const INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\|\|(.+?)\|\||\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)|(^|\s)@([\w.-]+)/;

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
    else if (m[5] != null) nodes.push(link(m[6], m[5]));
    else if (m[7] != null) nodes.push(link(m[7], m[7]));
    else { if (m[8]) nodes.push(m[8]); nodes.push(el('span', { class: 'mention', text: '@' + m[9] })); }
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes;
}

export function reviewText(text, isSpoiler) {
  if (!text) return null;
  const root = el('div', { class: 'review-text' });
  const lines = text.split(/ {2,}/).map(l => l.trim()).filter(Boolean);
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
