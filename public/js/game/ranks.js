// Ranks (design 7.6). OWNER: Gameplay engineer. Pure.
//
// rankFor(mode, score) returns 1..5 (Apprentice, Warrior, Ninja, Master, Legend). The rank names live in
// ui/strings.en.js; the thresholds are tuning constants in CONFIG.ranks (lower bounds of ranks 2 to 5).

import { CONFIG } from './config.js';

/**
 * @param {'classic'|'arcade'|'zen'|'practice'} mode
 * @param {number} score
 * @returns {1|2|3|4|5}
 */
export function rankFor(mode, score) {
  const bounds = CONFIG.ranks[mode];
  if (!bounds || !Number.isFinite(score)) return 1;
  let rank = 1;
  for (let i = 0; i < bounds.length; i++) {
    if (score >= bounds[i]) rank = i + 2;
  }
  return rank;
}
