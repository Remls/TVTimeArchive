import { STATE } from '../../../app/core/state.js';
import { el, fmtInt } from '../../../app/core/util.js';
import { emptyState, ensureShowPosters, posterCard, viewHead } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { enrichItem, humanizeTag, kindIcon, metaYear, seriesIdOf } from '../kit.js';

/* A smart list is built from a rule rather than held as items, and Refract
   exports the rule but never the members. Filter keys are whatever Refract
   chose to write, so an unrecognised one is humanized rather than dropped. */
const FILTER_LABEL = {
  statuses: 'Status',
  mediaTypes: 'Type',
  genres: 'Genre',
  ratings: 'Rating',
  years: 'Year',
  countries: 'Country',
  moodTags: 'Mood',
  watchContext: 'Watched',
};

function smartRule(filters) {
  const rows = [];
  for (const [key, value] of Object.entries(filters || {})) {
    const vals = (Array.isArray(value) ? value : [value]).filter(v => v !== null && v !== undefined && v !== '');
    if (!vals.length) continue;
    rows.push(el('div', { class: 'rule-row' }, [
      el('span', { class: 'rule-key', text: FILTER_LABEL[key] || humanizeTag(key) }),
      el('span', { class: 'rule-val', text: vals.map(v => humanizeTag(String(v))).join(', ') }),
    ]));
  }
  return rows;
}

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
        title: m ? m.title : it.title, year: metaYear(m), seriesId: seriesIdOf(m),
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
