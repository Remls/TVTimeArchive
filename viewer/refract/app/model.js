import { slugify } from '../../app/core/util.js';
import { buildV1Model } from './model/v1.js';
import { buildV3Model } from './model/v3.js';

/* -------------------------------------------------------------------
   Refract exports come in two shapes. v1 is four flat CSVs with no ids,
   keyed by filename. v3 is a manifest-led backup of .jsonl sections with
   ids on every row, keyed by section name. Both builders return the same
   model, plus the `format` that produced it.
   ------------------------------------------------------------------- */

export const REFRACT_FILES = ['media.csv', 'episodes.csv', 'lists.csv', 'reviews.csv'];

/* A later Refract release can add sections without bumping the version, so
   the section names decide it when the version string is missing or
   unfamiliar. */
const V3_SECTIONS = ['library', 'episodes', 'diary', 'ratings', 'list_items'];

export function detectFormat(tables, manifest) {
  if (manifest && (String(manifest.formatVersion || '').startsWith('3.') || V3_SECTIONS.some(s => tables[s]))) return 'v3';
  if (REFRACT_FILES.some(f => tables[f])) return 'v1';
  return null;
}

export function buildRefractModel(tables, opts = {}) {
  // partial exports are valid: Refract let you export any subset of its categories back in v1
  const format = detectFormat(tables, opts.manifest);
  if (!format) {
    throw new Error('This doesn\'t look like a Refract export. TV Time exports load at the site root instead.');
  }
  const model = format === 'v3' ? buildV3Model(tables, opts.manifest) : buildV1Model(tables);
  model.format = format;
  return model;
}

// Detail-route lookup: disambiguated slug first, then the plain title slug
// (kit's entityNav only knows plain slugs; it lands on the first duplicate).
export const findBySlug = (list, slug) => list.find(m => m.slug === slug) || list.find(m => slugify(m.title) === slug);
