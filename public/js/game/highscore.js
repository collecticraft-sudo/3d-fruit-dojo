// High-score data helpers (design 7.4, 7.5). OWNER: Gameplay engineer. Pure: no storage, no clock, no exceptions.
//
// The Presentation's storage layer (ui/storage.js) owns the localStorage access; these helpers hold the rules so they
// can be tested without a browser: what counts as a new record, how a result merges into the stored best table, how a
// possibly corrupted stored value is sanitised, and how result numbers are formatted.
//
// Shape of the table: { classic: {score, combo, date}|null, arcade: ..., zen: ... } with `date` an ISO string.

import { CONFIG } from './config.js';

export const BEST_MODES = Object.freeze(['classic', 'arcade', 'zen']);

/** An empty best table (a fresh object every call). */
export function emptyBest() {
  return { classic: null, arcade: null, zen: null };
}

const isCount = (v) => Number.isFinite(v) && v >= 0;

/**
 * Sanitise a best table read from storage (untrusted JSON): unknown modes and malformed records are dropped, numbers
 * are floored and clamped to >= 0, a bad date becomes ''.
 */
export function sanitizeBest(raw) {
  const out = emptyBest();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const mode of BEST_MODES) {
    const r = raw[mode];
    if (r === null || typeof r !== 'object' || !isCount(r.score)) continue;
    out[mode] = {
      score: Math.floor(r.score),
      combo: isCount(r.combo) ? Math.floor(r.combo) : 0,
      date: typeof r.date === 'string' ? r.date : '',
    };
  }
  return out;
}

/** New record: strictly greater than the stored best and above 0 (design 7.4). */
export function isNewBest(previous, score) {
  if (!Number.isFinite(score) || score <= 0) return false;
  return previous === null || previous === undefined || score > previous.score;
}

/**
 * Merge a finished round into the table without mutating it.
 * The best score and the best combo are tracked independently; the date follows the best score.
 * @param {object} table   result of sanitizeBest / emptyBest
 * @param {'classic'|'arcade'|'zen'} mode
 * @param {{score:number, combo:number}} result
 * @param {string} dateIso
 * @returns {{table:object, isNewBest:boolean, best:{score:number, combo:number, date:string}|null}}
 */
export function updateBest(table, mode, result, dateIso) {
  const next = { ...sanitizeBest(table) };
  if (!BEST_MODES.includes(mode)) return { table: next, isNewBest: false, best: null };
  const prev = next[mode];
  const score = isCount(result?.score) ? Math.floor(result.score) : 0;
  const combo = isCount(result?.combo) ? Math.floor(result.combo) : 0;
  const record = isNewBest(prev, score);
  const best = {
    score: prev ? Math.max(prev.score, score) : score,
    combo: prev ? Math.max(prev.combo, combo) : combo,
    date: record || !prev ? dateIso : prev.date,
  };
  next[mode] = best;
  return { table: next, isNewBest: record, best };
}

/** Accuracy 0..1 (or null) as a whole percent, null when nothing was thrown ("-" on the results screen). */
export function accuracyPercent(accuracy) {
  return Number.isFinite(accuracy) ? Math.round(accuracy * 100) : null;
}

/** Round length as m:ss (design 7.4 "Duration"). */
export function formatDuration(durationS) {
  const total = Math.max(0, Math.floor(Number.isFinite(durationS) ? durationS : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Cumulative play time reminder rule (design 15.1): true once `playMs` reaches the reminder threshold. */
export function breakReminderDue(playMsSinceBreak) {
  return Number.isFinite(playMsSinceBreak) && playMsSinceBreak >= CONFIG.breaks.reminderAfterMs;
}
