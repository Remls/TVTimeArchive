import { APP } from '../../../app/core/app.js';
import { STATE } from '../../../app/core/state.js';
import { el, fmtInt } from '../../../app/core/util.js';
import { emptyState, ensureShowPosters, posterCard, viewHead } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { enrichItem, humanizeTag, kindIcon, metaYear, seriesIdOf } from '../kit.js';

/* A smart list is built from a rule rather than held as items, and Refract
   exports the rule but never the members. Filter keys are whatever Refract
   chose to write, so an unrecognised one is humanized rather than dropped. */
const FILTER_LABEL = {
  mediaTypes: 'Media type',
  statuses: 'Status',
  itemRating: 'Public rating',   // Refract calls it Item Rating: "the poster (TMDB / public score)"
  userRating: 'Your rating',
  genres: 'Genres',
  year: 'Release year',
  addedWithinDays: 'Added within',
  countries: 'Country',
  moodTags: 'Mood',
  watchContext: 'Watched',
};

// Refract's filter sheet names these differently to the raw values it stores.
const VALUE_LABEL = { movie: 'Movies', tv: 'TV Shows', anime: 'Anime' };

// The sheet offers these as presets rather than a day count.
const ADDED_WITHIN = { 7: '7 days', 30: '30 days', 90: '3 months', 180: '6 months', 365: '1 year' };

// The order Refract's own filter sheet lists them in; anything else follows.
const FILTER_ORDER = ['mediaTypes', 'statuses', 'itemRating', 'userRating', 'genres', 'year', 'addedWithinDays', 'countries', 'moodTags', 'watchContext'];

// Two grid cells rather than a row, so the key column sizes to its widest label.
const ruleRow = (key, text) => [
  el('span', { class: 'rule-key', text: FILTER_LABEL[key] || humanizeTag(key) }),
  el('span', { class: 'rule-val', text }),
];

export function smartRuleText(filters) {
  const rest = { ...(filters || {}) };
  const text = {};
  /* Min and Max are two ends of one bound, so they read as a single range.
     Either end can be absent, and so can the whole pair. */
  for (const base of new Set(Object.keys(rest).filter(k => /(Min|Max)$/.test(k)).map(k => k.slice(0, -3)))) {
    const lo = rest[base + 'Min'], hi = rest[base + 'Max'];
    delete rest[base + 'Min']; delete rest[base + 'Max'];
    if (lo != null && hi != null) text[base] = `${lo} to ${hi}`;
    else if (lo != null) text[base] = `${lo} and up`;
    else if (hi != null) text[base] = `up to ${hi}`;
  }
  if (rest.addedWithinDays != null) {
    const d = rest.addedWithinDays;
    text.addedWithinDays = ADDED_WITHIN[d] || (d === 1 ? '1 day' : `${fmtInt(d)} days`);
    delete rest.addedWithinDays;
  }
  for (const [key, value] of Object.entries(rest)) {
    const vals = (Array.isArray(value) ? value : [value]).filter(v => v !== null && v !== undefined && v !== '');
    // Refract writes them in its own order, which reads as unsorted. Statuses
    // take the same labels the status badges use rather than their raw values.
    const label = (v) => (key === 'statuses' && (APP.statuses[v] || [])[1])
      || VALUE_LABEL[String(v)] || humanizeTag(String(v));
    if (vals.length) text[key] = vals.map(label).sort((a, b) => a.localeCompare(b)).join(', ');
  }
  const keys = Object.keys(text).sort((a, b) => {
    const ia = FILTER_ORDER.indexOf(a), ib = FILTER_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map(k => [k, text[k]]);
}

const smartRule = (filters) => smartRuleText(filters).flatMap(([k, t]) => ruleRow(k, t));

export function renderLists(root) {
  const lists = STATE.model.lists;
  viewHead(root, 'Lists', lists.length ? `${lists.length} lists` : '');
  if (!lists.length) { root.append(emptyState('No lists', { icon: 'ph-list-bullets' })); return; }

  const posterItems = [];
  for (const l of lists) {
    const det = el('details', { class: 'list-card', open: '' });
    det.append(el('summary', {}, [
      el('div', { class: 'list-info' }, [
        el('div', { class: 'list-name', text: l.name }),
        el('div', { class: 'list-sub', text: l.isSmartList && !l.items.length ? 'Smart list' : `${fmtInt(l.items.length)} items` }),
      ]),
      el('span', { class: 'badge ' + (l.isPublic ? 'good' : 'dim'), text: l.isPublic ? 'Public' : 'Private' }),
      el('i', { class: 'ph ph-caret-right list-caret' }),
    ]));
    if (l.description) det.append(el('p', { class: 'list-desc', text: l.description }));
    if (l.isSmartList) {
      const rule = smartRule(l.smartFilters);
      det.append(el('div', { class: 'smart-note' }, [
        el('div', { class: 'smart-head' }, [
          el('i', { class: 'ph ph-funnel' }),
          el('span', { text: 'Smart list' }),
        ]),
        el('p', { text: 'Refract fills this list from a rule as your library changes, so its contents are not part of the export. The rule itself is:' }),
        rule.length ? el('div', { class: 'rule-list' }, rule) : el('p', { class: 'rule-empty', text: 'No rule was exported.' }),
      ]));
    }
    const gallery = el('div', { class: 'poster-gallery' });
    for (const it of l.items) {
      const m = it.media;
      if (m && !m.isMovie) posterItems.push(enrichItem(m));
      const card = posterCard({
        kind: m && m.isMovie ? 'movie' : 'show', kindIcon: kindIcon(m),
        title: m ? m.title : it.title, year: metaYear(m), seriesId: seriesIdOf(m), poster: m ? m.poster : '',
        sub: [it.year || (m && m.year), it.note].filter(Boolean).join(', '),
        onClick: m ? () => navigate({ view: m.isMovie ? 'movies' : (m.isAnime ? 'anime' : 'shows'), detail: m.slug }) : null,
      });
      // Refract lists are ordered; Position is zero-indexed in the export
      card.querySelector('.poster-card-art').append(el('span', { class: 'poster-num', text: String(it.position + 1) }));
      gallery.append(card);
    }
    if (l.items.length) det.append(gallery);
    root.append(det);
  }
  ensureShowPosters(posterItems);
}
