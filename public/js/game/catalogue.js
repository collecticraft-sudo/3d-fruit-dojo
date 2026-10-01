// Object catalogue (design 4): every collidable of the game as one flat, frozen list. OWNER: Gameplay engineer. Pure.
//
// The numbers live in CONFIG (fruits, golden, bomb, powerups, hitMul, hit); this module only derives the lookups the rest of
// game/ needs, so radius, hit radius and score are computed in exactly one place.

import { CONFIG } from './config.js';
import { hitRadius } from './physics.js';

export const FRUIT_IDS = Object.freeze(CONFIG.fruits.map((f) => f.id));
export const POWERUP_IDS = Object.freeze(['freeze', 'frenzy', 'double', 'clock']);

export const FRUIT_BY_ID = Object.freeze(Object.fromEntries(CONFIG.fruits.map((f) => [f.id, f])));

/**
 * @typedef {Object} ObjectSpec
 * @property {'fruit'|'golden'|'bomb'|'powerup'} kind
 * @property {string} type    fruit id | 'golden' | 'bomb' | power-up id
 * @property {number} r       visual body radius (px)
 * @property {number} hitR    collision radius (px): round(r x hitMul) + blade half width (capsule, physics.hitRadius)
 * @property {number} score   base points when cut (0 for bombs and medallions)
 */

const make = (kind, type, r, score) => Object.freeze({ kind, type, r, hitR: hitRadius(kind, r), score });

/** All 16 object types: 10 fruit, the golden apple, the bomb and the 4 medallions. */
export const CATALOGUE = Object.freeze([
  ...CONFIG.fruits.map((f) => make('fruit', f.id, f.r, f.score)),
  make('golden', 'golden', CONFIG.golden.r, CONFIG.golden.score),
  make('bomb', 'bomb', CONFIG.bomb.r, 0),
  ...POWERUP_IDS.map((id) => make('powerup', id, CONFIG.powerups[id].r, 0)),
]);

const INDEX = new Map(CATALOGUE.map((s) => [`${s.kind}:${s.type}`, s]));

/** Look up an object type; throws RangeError for anything that is not in the catalogue. */
export function objectSpec(kind, type) {
  const spec = INDEX.get(`${kind}:${type}`);
  if (!spec) throw new RangeError(`unknown object "${kind}:${type}"`);
  return spec;
}
