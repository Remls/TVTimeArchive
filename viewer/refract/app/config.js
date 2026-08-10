import { makeArchiveStore } from '../../app/core/storage.js';
import { renderRaw } from '../../app/views/raw.js';

function buildRefractModel(tables) {
  if (!tables['media.csv']) {
    throw new Error('this doesn’t look like a Refract export (no media.csv). TV Time exports load at the site root instead.');
  }
  return {};
}

export const REFRACT_APP = {
  brand: { title: 'Refract Archive' },
  views: [
    { id: 'raw', label: 'All data', icon: 'ph-database', render: renderRaw },
  ],
  groups: {},
  detail: {},
  buildModel: buildRefractModel,
  archive: makeArchiveStore('refract-archive'),
  statuses: {
    completed:   ['good', 'Completed'],
    up_to_date:  ['good', 'Up to date'],
    in_progress: ['accent', 'Watching'],
    planned:     ['dim', 'Planned'],
    on_hold:     ['warn', 'On hold'],
    dropped:     ['warn', 'Dropped'],
  },
  settingsExtras: null,
};
