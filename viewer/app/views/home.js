import { avatarEl } from '../core/media.js';
import { STATE } from '../core/state.js';
import { $, el, fmtDate, fmtDuration, fmtInt } from '../core/util.js';
import { barChart, emptyState, ensureShowPosters, showLineItem, showPosterItem } from '../ui/kit.js';

export function renderHome(root) {
  const o = STATE.model.overview;
  const p = STATE.model.profile;
  const title = p.displayName ? `${p.displayName}’s archive` : 'Home';
  const subtitle = `Tracked since ${fmtDate(o.firstWatch)} · last activity ${fmtDate(o.lastWatch)}`;
  root.append(el('div', { class: 'view-head with-avatar' }, [
    avatarEl(p.avatar, p.displayName, p.userId && 'avatars/' + p.userId, 'lg'),
    el('div', {}, [el('h2', { text: title }), el('p', { text: subtitle })]),
  ]));

  const cards = [
    // single-accent: only the hero stat (total time in TV) is coral; the rest read neutral
    ['episodesWatched', 'Episodes watched', o.episodesWatched, '', null],
    ['moviesWatched', 'Movies watched', o.moviesWatched, '', null],
    ['seriesRuntime', 'Time in TV', fmtDuration(o.seriesRuntime), 'accent', 'series runtime'],
    ['moviesRuntime', 'Time in film', fmtDuration(o.moviesRuntime), 'accent', 'movie runtime'],
    ['showsFollowed', 'Shows followed', fmtInt(o.showsFollowed), '', `${fmtInt(o.showsTracked)} tracked total`],
    ['moviesTracked', 'Movies tracked', fmtInt(o.moviesTracked), '', null],
    ['reactionsLogged', 'Reactions logged', fmtInt(o.reactionsLogged), '', null],
    ['ratingsLogged', 'Ratings given', fmtInt(o.ratingsLogged), '', 'shows · movies · episodes'],
  ];
  const grid = el('div', { class: 'stat-grid' });
  for (const [, label, value, cls, sub] of cards) {
    grid.append(el('div', { class: 'stat-card' }, [
      el('div', { class: 'stat-value' + (cls ? ' ' + cls : ''), text: typeof value === 'number' ? fmtInt(value) : value }),
      el('div', { class: 'stat-label', text: label }),
      sub ? el('div', { class: 'stat-sub', text: sub }) : null,
    ]));
  }
  root.append(grid);

  // Top shows by episodes watched
  root.append(el('div', { class: 'section-title', text: 'Most-watched shows' }));
  const top = STATE.model.shows.filter(s => s.epWatched > 0).slice(0, 8);
  const list = el('div', { class: 'cards two-col' });
  for (const s of top) {
    list.append(showLineItem(s.title, s.id, [
      el('div', { class: 'item-title', text: s.title }),
      el('div', { class: 'item-meta' }, [ el('span', { html: `<b>${fmtInt(s.epWatched)}</b> episodes` }), s.rating ? el('span', { html: `<i class="ph-fill ph-star" style="color:var(--accent)"></i> ${s.rating}` }) : null ]),
    ]));
  }
  root.append(top.length ? list : emptyState('No watch data', { icon: 'ph-television' }));
  ensureShowPosters(top.map(s => showPosterItem(s.title, s.id)));

  // ---- Stats (marathons + monthly charts), folded into Home ----
  const st = STATE.model.stats;
  if (st && st.hasData) {
    if (st.marathons.length) {
      root.append(el('div', { class: 'section-title', text: 'Biggest marathons' }));
      const mcards = el('div', { class: 'cards two-col' });
      for (const m of st.marathons) {
        mcards.append(showLineItem(m.show, null, [
          el('div', { class: 'item-title', text: m.show }),
          el('div', { class: 'item-meta' }, [el('span', { html: `<b>${fmtInt(m.episodes)}</b> episodes in <b>${fmtInt(m.days)}</b> day${m.days === 1 ? '' : 's'}` })]),
        ]));
      }
      root.append(mcards);
      ensureShowPosters(st.marathons.map(m => showPosterItem(m.show)));
    }
    if (st.epByMonth.length) { root.append(el('div', { class: 'section-title', text: 'Episodes watched per month' })); barChart(root, st.epByMonth); }
    if (st.hoursByMonth.length) { root.append(el('div', { class: 'section-title', text: 'Hours watched per month' })); barChart(root, st.hoursByMonth, v => `${fmtInt(v)}h`); }
    if (st.moviesByMonth.length && st.moviesByMonth.some(d => d.value)) { root.append(el('div', { class: 'section-title', text: 'Movies watched per month' })); barChart(root, st.moviesByMonth); }
  }
}
