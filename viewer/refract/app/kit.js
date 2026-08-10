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

// Review text hidden behind a blur until tapped when the author marked it a spoiler.
export function reviewText(text, isSpoiler) {
  if (!text) return null;
  const node = el('div', { class: 'review-text' + (isSpoiler ? ' spoiler' : ''), text });
  if (isSpoiler) {
    node.title = 'Marked as a spoiler. Click to reveal.';
    node.addEventListener('click', () => { node.classList.toggle('revealed'); }, { once: false });
  }
  return node;
}
