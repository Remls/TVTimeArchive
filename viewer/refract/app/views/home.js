import { STATE } from '../../../app/core/state.js';
import { el, fmtDate, fmtInt } from '../../../app/core/util.js';
import { barChart, chip, emptyState, ensureShowPosters, posterCard, viewHead } from '../../../app/ui/kit.js';
import { navigate } from '../../../app/ui/router.js';
import { enrichItem, kindIcon, metaYear, moodText } from '../kit.js';

const MONTHS_SHOWN = 24;   // most-recent months in the episodes chart; older data stays in Watch history

export function renderHome(root) {
  const m = STATE.model;
  const st = m.stats;
  viewHead(root, 'Your Refract archive',
    st.firstWatch ? `Tracked since ${fmtDate(st.firstWatch)}, last activity ${fmtDate(st.lastWatch)}` : '');

  const cards = [
    // the two watched totals are the hero stats; the rest read neutral
    ['Episodes watched', fmtInt(st.episodesWatched), 'accent'],
    ['Movies watched', fmtInt(st.moviesWatched), 'accent'],
    ['TV shows tracked', fmtInt(st.tvShows), ''],
    ['Anime tracked', fmtInt(st.anime), ''],
    ['Movies tracked', fmtInt(st.movies), ''],
    ['Lists created', fmtInt(st.lists), ''],
    ['Ratings given', fmtInt(st.ratings), ''],
  ];
  const grid = el('div', { class: 'stat-grid' });
  for (const [label, value, cls] of cards) {
    grid.append(el('div', { class: 'stat-card' }, [
      el('div', { class: 'stat-value' + (cls ? ' ' + cls : ''), text: value }),
      el('div', { class: 'stat-label', text: label }),
    ]));
  }
  root.append(grid);

  root.append(el('div', { class: 'section-title', text: 'Most-watched shows' }));
  const top = [...m.shows].sort((a, b) => b.epWatched - a.epWatched).filter(s => s.epWatched > 0).slice(0, 8);
  const gallery = el('div', { class: 'poster-gallery' });
  for (const s of top) {
    gallery.append(posterCard({
      kind: 'show', kindIcon: kindIcon(s), title: s.title, year: metaYear(s), status: s.status, rating: s.rating,
      sub: `${fmtInt(s.epWatched)} episodes`,
      onClick: () => navigate({ view: s.isAnime ? 'anime' : 'shows', detail: s.slug }),
    }));
  }
  root.append(top.length ? gallery : emptyState('No watch data', { icon: 'ph-television' }));
  ensureShowPosters(top.map(enrichItem));

  const monthKeys = [...st.epByMonth.keys()].sort();
  if (monthKeys.length) {
    // contiguous window ending at the most recent month with data, zero months included
    const [ly, lm] = monthKeys[monthKeys.length - 1].split('-').map(Number);
    const shown = [];
    for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
      const d = new Date(ly, lm - 1 - i, 1);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (k >= monthKeys[0]) shown.push({ label: k, value: st.epByMonth.get(k) || 0 });
    }
    const truncated = shown.length && shown[0].label > monthKeys[0];
    root.append(el('div', { class: 'section-title', text: `Episodes watched per month${truncated ? ` (last ${MONTHS_SHOWN} months)` : ''}` }));
    barChart(root, shown);
  }

  const yearKeys = [...st.moviesByYear.keys()].sort();
  if (yearKeys.length) {
    root.append(el('div', { class: 'section-title', text: 'Movies watched per year' }));
    barChart(root, yearKeys.map(k => ({ label: k, value: st.moviesByYear.get(k) })));
  }

  if (st.ratingHist.size) {
    root.append(el('div', { class: 'section-title', text: 'Your ratings' }));
    barChart(root, [...Array(10).keys()].map(i => 10 - i).map(n => ({ label: `${n}/10`, value: st.ratingHist.get(n) || 0 })));
  }

  if (st.topMoods.length) {
    root.append(el('div', { class: 'section-title', text: 'Most-used mood tags' }));
    root.append(el('div', { class: 'detail-chips' }, st.topMoods.slice(0, 12).map(([tag, n]) => chip(`${moodText(tag)} (${n})`))));
  }
}
