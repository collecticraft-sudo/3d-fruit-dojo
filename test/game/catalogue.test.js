import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/index.js';
import { CATALOGUE, objectSpec, FRUIT_IDS, POWERUP_IDS, FRUIT_BY_ID } from '../../public/js/game/catalogue.js';

test('the catalogue lists all 16 object types with radius, hit radius and base score (design 4.1 to 4.4)', () => {
  assert.equal(CATALOGUE.length, 16);
  assert.deepEqual(CATALOGUE.map((s) => s.kind).reduce((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {}), { fruit: 10, golden: 1, bomb: 1, powerup: 4 });
  const expected = {
    // hitR = round(r x 1.55) + 14 blade half width (golden: round(r x 1.6) + 14, medallion: round(r x 1.5) + 14, bomb: round(r x 0.85) + 0)
    'fruit:watermelon': [92, 157, 10], 'fruit:pineapple': [82, 141, 10], 'fruit:apple': [68, 119, 15], 'fruit:orange': [68, 119, 15],
    'fruit:pear': [66, 116, 15], 'fruit:peach': [64, 113, 15], 'fruit:lemon': [60, 107, 20], 'fruit:kiwi': [58, 104, 20],
    'fruit:strawberry': [52, 95, 25], 'fruit:cherry': [48, 88, 30],
    'golden:golden': [64, 116, 100], 'bomb:bomb': [64, 54, 0],
    'powerup:freeze': [62, 107, 0], 'powerup:frenzy': [62, 107, 0], 'powerup:double': [62, 107, 0], 'powerup:clock': [62, 107, 0],
  };
  for (const s of CATALOGUE) assert.deepEqual([s.r, s.hitR, s.score], expected[`${s.kind}:${s.type}`], `${s.kind}:${s.type}`);
  assert.ok(Object.isFrozen(CATALOGUE) && CATALOGUE.every((s) => Object.isFrozen(s)));
  assert.deepEqual(FRUIT_IDS, CONFIG.fruits.map((f) => f.id));
  assert.deepEqual(POWERUP_IDS, ['freeze', 'frenzy', 'double', 'clock']);
  assert.equal(FRUIT_BY_ID.cherry.score, 30);
});

test('objectSpec throws for anything that is not in the catalogue', () => {
  assert.equal(objectSpec('fruit', 'apple').hitR, 119);
  assert.throws(() => objectSpec('fruit', 'durian'), RangeError);
  assert.throws(() => objectSpec('bomb', 'apple'), RangeError);
  assert.throws(() => objectSpec('powerup', 'roll'), RangeError);
  assert.throws(() => objectSpec('ufo', 'x'), RangeError);
});
