import { $ } from './util.js';

// Ratings: one 5-level star scale, shared by episodes, movies AND shows. Different app
// eras used different ids for the same level (anchored by TV Time's stable `old_id`:
// old7=bad, old6=meh, old8=okay, old1=good, old3=wow).  id -> [stars 1-5, label]
export const RATING_LABELS = {
  1: [1, 'Bad'],  16: [1, 'Bad'],
  2: [2, 'Meh'],  17: [2, 'Meh'],  27: [2, 'Meh'],
  4: [3, 'Okay'], 18: [3, 'Okay'], 28: [3, 'Okay'],
  5: [4, 'Good'], 19: [4, 'Good'], 29: [4, 'Good'],
  3: [5, 'Wow'],  20: [5, 'Wow'],
};

// Emotions: the modern "How did you feel?" 12-set (ids 28-39) plus the older
// emoji-grid reactions (ids 2-27) that predate it.  id -> [emoji, label]
export const EMOTION_LABELS = {
  28: ['😵', 'Shocked'], 29: ['😤', 'Frustrated'], 30: ['😭', 'Sad'],       31: ['🤔', 'Reflective'],
  32: ['🥺', 'Touched'], 33: ['😆', 'Amused'],     34: ['😱', 'Scared'],    35: ['😑', 'Bored'],
  36: ['😌', 'Understood'], 37: ['🤩', 'Thrilled'], 38: ['🙃', 'Confused'], 39: ['😬', 'Tense'],
  // legacy emoji-grid reactions (custom / android / native grids)
  2: ['😠', 'Angry'],    4: ['😑', 'Bored'],    5: ['🙃', 'Confused'],  6: ['🤩', 'Excited'],
  7: ['😀', 'Happy'],    10: ['😭', 'Sad'],     11: ['😱', 'Scared'],   12: ['😵', 'Shocked'],
  13: ['😀', 'Happy'],   14: ['🙃', 'Confused'], 15: ['😭', 'Sad'],     16: ['😱', 'Scared'],
  17: ['😠', 'Angry'],   18: ['😵', 'Shocked'],  19: ['🤩', 'Excited'], 20: ['😑', 'Bored'],
  21: ['🙃', 'Confusing'], 22: ['😱', 'Scary'], 23: ['😤', 'Frustrating'], 24: ['😵', 'Shocking'],
  25: ['🤩', 'Exciting'], 26: ['😑', 'Boring'], 27: ['😤', 'Frustrated'],
};

export const STARS = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

// Is this reaction a star rating (vs an emotion)? Decided by its source file.
export const isRatingSource = (source = '') => /^ratings/.test(source);

export function reactionChipText(id, source = '') {
  if (id == null) return null;
  if (isRatingSource(source)) {
    const r = RATING_LABELS[id];
    return r ? `${STARS(r[0])} ${r[1]}` : `rating #${id}`;
  }
  const e = EMOTION_LABELS[id];
  return e ? `${e[0]} ${e[1]}` : `reaction #${id}`;
}

// vote_key is "<entityId>-<userId>-<reactionId>"; take the segment after the user id.
export function reactionIdFromKey(key, uid) {
  const p = String(key || '').split('-');
  const i = p.lastIndexOf(String(uid));
  const seg = (i >= 0 && i + 1 < p.length) ? p[i + 1] : p[p.length - 1];
  return /^\d+$/.test(seg) ? Number(seg) : null;
}

/* ---------------- Show star ratings ----------------
   tv_show_rate.csv — the only genuine numeric rating (1–5 scale). */
/* ---------------- Ratings ----------------
   The 5-level star rating (Bad/Meh/Okay/Good/Wow) the user gave — the SAME scale for
   shows, movies and episodes. Show-level from tv_show_rate.csv; episode/movie from the
   ratings-* vote files (id decoded via RATING_LABELS, scoped to rating sources). One
   rating per entity — the export keeps historical clicks, so on conflict keep highest. */
export const LEVEL_LABEL = [null, 'Bad', 'Meh', 'Okay', 'Good', 'Wow'];

// episode_emotion.csv is TV Time's OLD combined table — it stores the rating in the
// same emotion_id field, using the original id scheme (old7=bad … old3=wow). Ids that
// aren't emotions are these ratings. id -> [stars, label].
export const OLD_EMOTION_RATING = { 7: [1, 'Bad'], 6: [2, 'Meh'], 8: [3, 'Okay'], 1: [4, 'Good'], 3: [5, 'Wow'] };
