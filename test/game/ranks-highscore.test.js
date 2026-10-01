import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankFor, CONFIG, emptyBest, sanitizeBest, isNewBest, updateBest, accuracyPercent, formatDuration, breakReminderDue, BEST_MODES,
} from '../../public/js/game/index.js';

test('rankFor: design 7.6 boundaries for every mode (Apprentice .. Legend = 1..5)', () => {
  const table = {
    classic: [[0, 1], [799, 1], [800, 2], [1999, 2], [2000, 3], [3999, 3], [4000, 4], [6999, 4], [7000, 5], [99999, 5]],
    arcade: [[0, 1], [599, 1], [600, 2], [1299, 2], [1300, 3], [2199, 3], [2200, 4], [3199, 4], [3200, 5]],
    zen: [[0, 1], [599, 1], [600, 2], [1199, 2], [1200, 3], [1899, 3], [1900, 4], [2599, 4], [2600, 5]],
  };
  for (const [mode, rows] of Object.entries(table)) for (const [score, rank] of rows) assert.equal(rankFor(mode, score), rank, `${mode} ${score}`);
  assert.equal(rankFor('classic', -5), 1);
  assert.equal(rankFor('classic', NaN), 1);
  assert.equal(rankFor('practice', 5000), 1);
  assert.equal(rankFor('nonsense', 5000), 1);
  for (const mode of BEST_MODES) assert.deepEqual([...CONFIG.ranks[mode]], [...CONFIG.ranks[mode]].sort((a, b) => a - b));
});

test('isNewBest: strictly greater than the stored best and above 0', () => {
  assert.equal(isNewBest(null, 0), false);
  assert.equal(isNewBest(null, 1), true);
  assert.equal(isNewBest(undefined, 50), true);
  assert.equal(isNewBest({ score: 100, combo: 3, date: 'x' }, 100), false);
  assert.equal(isNewBest({ score: 100, combo: 3, date: 'x' }, 101), true);
  assert.equal(isNewBest({ score: 100, combo: 3, date: 'x' }, NaN), false);
});

test('updateBest: pure merge, best score and best combo tracked separately, date follows the best score', () => {
  const start = emptyBest();
  const r1 = updateBest(start, 'arcade', { score: 500, combo: 3 }, '2026-09-30T10:00:00.000Z');
  assert.deepEqual(r1.best, { score: 500, combo: 3, date: '2026-09-30T10:00:00.000Z' });
  assert.equal(r1.isNewBest, true);
  assert.deepEqual(start, emptyBest(), 'the input table is not mutated');
  const r2 = updateBest(r1.table, 'arcade', { score: 400, combo: 6 }, '2026-10-01T10:00:00.000Z');
  assert.equal(r2.isNewBest, false);
  assert.deepEqual(r2.best, { score: 500, combo: 6, date: '2026-09-30T10:00:00.000Z' }, 'a better combo alone keeps the score record date');
  const r3 = updateBest(r2.table, 'arcade', { score: 501, combo: 1 }, '2026-10-02T10:00:00.000Z');
  assert.deepEqual([r3.isNewBest, r3.best.score, r3.best.combo, r3.best.date], [true, 501, 6, '2026-10-02T10:00:00.000Z']);
  assert.equal(r3.table.classic, null);
  const zero = updateBest(emptyBest(), 'zen', { score: 0, combo: 0 }, 'd');
  assert.equal(zero.isNewBest, false, 'a score of 0 is never a record');
  assert.equal(updateBest(emptyBest(), 'practice', { score: 9, combo: 9 }, 'd').best, null);
});

test('sanitizeBest: corrupted or hostile stored JSON never throws and never yields bad data', () => {
  assert.deepEqual(sanitizeBest(null), emptyBest());
  assert.deepEqual(sanitizeBest(undefined), emptyBest());
  assert.deepEqual(sanitizeBest('nope'), emptyBest());
  assert.deepEqual(sanitizeBest([1, 2, 3]), emptyBest());
  const messy = sanitizeBest({
    classic: { score: 1234.9, combo: -4, date: 12 },
    arcade: { score: 'x', combo: 1, date: '2026' },
    zen: { score: 5, combo: 2, date: '2026-01-01', extra: 'ignored' },
    __proto__: { evil: true },
    hacker: { score: 999999 },
  });
  assert.deepEqual(messy, { classic: { score: 1234, combo: 0, date: '' }, arcade: null, zen: { score: 5, combo: 2, date: '2026-01-01' } });
  assert.deepEqual(sanitizeBest(JSON.parse(JSON.stringify(messy))), messy);
  assert.equal({}.evil, undefined, 'no prototype pollution');
});

test('result formatting: accuracy percent, m:ss duration, break reminder threshold', () => {
  assert.equal(accuracyPercent(0.876), 88);
  assert.equal(accuracyPercent(1), 100);
  assert.equal(accuracyPercent(0), 0);
  assert.equal(accuracyPercent(null), null);
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(59.9), '0:59');
  assert.equal(formatDuration(60), '1:00');
  assert.equal(formatDuration(215.4), '3:35');
  assert.equal(formatDuration(-3), '0:00');
  assert.equal(formatDuration(NaN), '0:00');
  assert.equal(breakReminderDue(599999), false);
  assert.equal(breakReminderDue(600000), true);
  assert.equal(breakReminderDue(NaN), false);
});
