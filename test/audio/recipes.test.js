// Sound recipes: every sound of docs/game-design.md section 10 and docs/restyle-direction.md section 4 exists as pure data with sane
// envelopes, the layered slice, the combo escalation, the new cues and the level targets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUS_OF, COUNTDOWN_HZ, LEVEL_DB, PRIORITY, RECIPES, SOUND_IDS, buildRecipe, pentatonicSemitone, rankIndex, slicePopHz, swooshTargets } from '../../public/js/audio/recipes.js';
import { CONFIG } from '../../public/js/game/config.js';

// Section 10.2 to 10.4 of the design plus the restyle direction (section 4), by id.
const DESIGN_IDS = [
  'swoosh', 'slice', 'comboChime', 'bombFuse', 'bombWarn', 'bombBoom', 'bombNear', 'lifeLost', 'miss', 'golden', 'goldenSpawn', 'slowmo', 'recenter',
  'freezeSpawn', 'freezeActivate', 'freezeEnd', 'frenzySpawn', 'frenzyActivate', 'frenzyEnd', 'doubleSpawn', 'doubleActivate', 'doubleEnd', 'clockSpawn', 'clockActivate',
  'countdown', 'go', 'tick', 'gameOver', 'timeUp', 'record', 'uiMove', 'uiSelect', 'uiBack', 'connectOk', 'disconnect', 'calStep', 'calHold', 'calOk', 'calFail',
];
const RESTYLE_IDS = ['comboStep', 'freezeCrack', 'rankStamp', 'resultsFanfare', 'countTick', 'uiWhoosh', 'uiError'];
const tagged = (recipe, t) => recipe.layers.filter((l) => l.tag === t);

test('every sound id of the design and of the restyle direction has a recipe (completeness)', () => {
  for (const id of [...DESIGN_IDS, ...RESTYLE_IDS]) assert.ok(RECIPES[id], `recipe for ${id}`);
  assert.deepEqual([...SOUND_IDS].sort(), [...DESIGN_IDS, ...RESTYLE_IDS].sort(), 'no undocumented sounds either');
  assert.throws(() => buildRecipe('nope'), /unknown sound/);
});

test('envelope end times: durationMs is the latest layer end; attack <= end; gains sane; frequencies positive; recipe fields valid', () => {
  for (const id of SOUND_IDS) {
    for (const params of [{ n: 5, r: 90, ms: 1500, k: 4, urgent: true, rank: 5, progress: 0.5, reverse: true }, {}, { n: 9, rank: 1 }, { n: 2 }]) {
      const r = buildRecipe(id, params);
      assert.equal(r.id, id);
      assert.ok(Object.hasOwn(PRIORITY, r.category), `${id} category`);
      assert.equal(r.priority, PRIORITY[r.category]);
      assert.ok(Object.hasOwn(BUS_OF, r.category), `${id} has a bus`);
      if (r.continuous) { assert.equal(r.durationMs, 0); continue; }
      let end = 0;
      for (const l of r.layers) {
        end = Math.max(end, l.startMs + l.endMs);
        assert.ok(l.attackMs <= l.endMs, `${id}: attack inside the envelope`);
        assert.ok(l.gain > 0 && l.gain <= 1, `${id}: gain ${l.gain}`);
        assert.ok(l.startMs >= 0 && l.endMs > 0);
        if (l.type === 'osc') {
          const f = typeof l.freq === 'number' ? [l.freq] : [l.freq.from, l.freq.to];
          assert.ok(f.every((x) => x > 0 && x < 22050), `${id}: positive audible frequency`);
          assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(l.wave));
        } else {
          assert.equal(l.type, 'noise');
        }
        if (l.filter) assert.ok(['lowpass', 'highpass', 'bandpass'].includes(l.filter.type));
      }
      assert.equal(r.durationMs, end, `${id}: durationMs`);
      assert.ok(r.durationMs > 0 && r.durationMs <= 2400, `${id}: ${r.durationMs} ms`);
      assert.ok(r.layers.length <= 16, `${id}: ${r.layers.length} layers keeps the node count low`);
      assert.ok(r.trim > 0.2 && r.trim < 6, `${id}: trim ${r.trim}`);
      assert.ok(r.levelDb <= -4 && r.levelDb >= -24, `${id}: level ${r.levelDb}`);
      if (r.wet !== undefined) assert.ok(r.wet > 0 && r.wet <= 0.5, `${id}: wet ${r.wet}`);
      for (const d of r.duck ?? []) {
        assert.ok(d.groups.every((g) => ['slice', 'ui', 'event'].includes(g)));
        assert.ok(d.amount > 0 && d.amount < 1 && d.ms > 0 && d.ms <= 500);
      }
    }
  }
});

test('level targets follow the direction: UI -22..-18, slice -12, combo and golden -10, power-up -9, life -8, bomb and gong -4', () => {
  assert.deepEqual(LEVEL_DB, { ui: -20, slice: -12, combo: -10, powerup: -9, life: -8, bomb: -4 });
  assert.equal(buildRecipe('slice').levelDb, -12);
  assert.equal(buildRecipe('golden').levelDb, -10);
  assert.equal(buildRecipe('comboChime', { n: 3 }).levelDb, -10);
  assert.equal(buildRecipe('freezeActivate').levelDb, -9);
  assert.equal(buildRecipe('lifeLost').levelDb, -8);
  for (const id of ['bombBoom', 'go', 'rankStamp']) assert.equal(buildRecipe(id).levelDb, -4, id);
  for (const id of ['uiMove', 'uiSelect', 'uiBack', 'uiError', 'uiWhoosh', 'countTick', 'countdown', 'tick']) {
    const lv = buildRecipe(id).levelDb;
    assert.ok(lv >= -23 && lv <= -18, `${id}: ${lv}`);
  }
  // nothing is louder than the bomb and the gongs
  for (const id of SOUND_IDS) if (!buildRecipe(id).continuous) assert.ok(buildRecipe(id, { n: 9, rank: 5 }).levelDb <= -4);
});

test('slice: click, crack, wet pop, juicy tail with bubbles; ting from combo index 2; fruit colour; squelch for r >= 80', () => {
  assert.equal(slicePopHz(48, 0), 660, 'cherry');
  assert.equal(slicePopHz(92, 0), 440, 'watermelon');
  assert.ok(Math.abs(slicePopHz(68, 12) - 2 * 560) < 1e-9, 'k semitones scale by 2^(k/12)');
  const apple = buildRecipe('slice', { r: 68, fruit: 'apple' });
  assert.deepEqual(apple.layers.map((l) => l.tag), ['click', 'crack', 'pop', 'juice', 'bubble', 'bubble']);
  const [click, crack, pop, juice] = apple.layers;
  assert.deepEqual([click.filter.type, click.filter.freq, click.endMs, click.gain], ['highpass', 3500, 8, 0.4]);
  assert.deepEqual([crack.filter.type, crack.filter.freq, crack.endMs, crack.gain], ['highpass', 1500, 90, 0.45]);
  assert.equal(pop.freq.from, 900 - 5 * 68);
  assert.ok(Math.abs(pop.freq.to - 0.28 * pop.freq.from) < 1e-9);
  assert.equal(pop.freq.ms, 110);
  assert.equal(pop.gain, 0.35);
  assert.equal(juice.filter.type, 'bandpass');
  assert.ok(juice.filter.freq.from > juice.filter.freq.to, 'the juice sweeps down');
  assert.ok(apple.layers.every((l) => l.pan), 'panned by fruit x');
  // combo index 2 and above add the ting: triangle at 2 f0, 60 ms, gain 0.10
  assert.equal(tagged(apple, 'ting').length, 0);
  const combo = buildRecipe('slice', { r: 68, ci: 2, fruit: 'apple' });
  const ting = tagged(combo, 'ting')[0];
  assert.deepEqual([ting.wave, ting.freq, ting.endMs, ting.gain], ['triangle', 2 * (900 - 5 * 68), 60, 0.1]);
  // fruit colour: tick for the small ones, thump for the big ones, squelch from r 80
  const cherry = buildRecipe('slice', { r: 48, fruit: 'cherry' });
  assert.deepEqual([tagged(cherry, 'tick')[0].freq, tagged(cherry, 'tick')[0].endMs], [2400, 12]);
  assert.equal(tagged(cherry, 'squelch').length, 0);
  assert.equal(tagged(buildRecipe('slice', { r: 52, fruit: 'strawberry' }), 'tick').length, 1);
  assert.equal(tagged(buildRecipe('slice', { r: 68, fruit: 'orange' }), 'tick').length, 0);
  const melon = buildRecipe('slice', { r: 92, fruit: 'watermelon' });
  assert.deepEqual([tagged(melon, 'thump')[0].freq, tagged(melon, 'thump')[0].endMs, tagged(melon, 'thump')[0].gain], [70, 80, 0.25]);
  assert.equal(tagged(melon, 'squelch')[0].filter.type, 'lowpass');
  assert.equal(tagged(buildRecipe('slice', { r: 82, fruit: 'pineapple' }), 'thump').length, 1);
  assert.equal(tagged(buildRecipe('slice', { r: 66, fruit: 'pear' }), 'squelch').length, 0);
  // without a fruit id the radius decides (the menu fruit only carries r)
  assert.equal(tagged(buildRecipe('slice', { r: 48 }), 'tick').length, 1);
  assert.equal(tagged(buildRecipe('slice', { r: 92 }), 'thump').length, 1);
  // pitch by fruit: smaller fruit are higher
  const hz = (r) => buildRecipe('slice', { r }).layers.find((l) => l.tag === 'pop').freq.from;
  assert.ok(hz(48) > hz(68) && hz(68) > hz(92));
  // the juice tail and the bubbles are short: a slice never outlasts 300 ms
  assert.ok(buildRecipe('slice', { r: 92, ci: 5 }).durationMs <= 300);
});

test('pentatonic combo index: semitones [0 2 4 7 9 12 14 16 19 21], capped at 21', () => {
  const expected = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  expected.forEach((s, i) => assert.equal(pentatonicSemitone(i), s));
  assert.equal(pentatonicSemitone(25), 21);
  assert.equal(pentatonicSemitone(-3), 0);
});

test('comboStep: a rising pentatonic arpeggio that gets richer: plain pair, fifth, shimmer and drum, gong and taiko from x7', () => {
  const step = (n) => buildRecipe('comboStep', { n });
  const f = (n) => step(n).layers[0].freq;
  const ladder = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(f);
  ladder.forEach((hz, i) => {
    const semis = [2, 4, 7, 9, 12, 14, 16, 19, 21, 21][i];
    assert.ok(Math.abs(hz - 523.25 * 2 ** (semis / 12)) < 1e-6, `n=${i + 2}`);
  });
  for (let i = 1; i < 9; i++) assert.ok(ladder[i] > ladder[i - 1], 'every level is higher than the one before');
  assert.equal(ladder[9], ladder[8], 'capped at the last pentatonic step');
  // n = 2 is the plain pair (sine + triangle, 180 ms), no pan (centre)
  const s2 = step(2);
  assert.deepEqual(s2.layers.map((l) => [l.wave, l.endMs]), [['sine', 180], ['triangle', 180]]);
  assert.ok(s2.layers.every((l) => !l.pan));
  // gain 0.14 + 0.01 n, capped at 0.22
  assert.ok(Math.abs(s2.layers[0].gain - 0.16) < 1e-12);
  assert.ok(Math.abs(step(5).layers[0].gain - 0.19) < 1e-12);
  assert.equal(step(20).layers[0].gain, 0.22);
  // n = 3 adds a fifth x1.5 at 0.08
  const fifth = tagged(step(3), 'fifth')[0];
  assert.deepEqual([fifth.freq / f(3), fifth.gain], [1.5, 0.08]);
  assert.equal(tagged(step(2), 'fifth').length, 0);
  // n >= 4: shimmer (noise highpass 7000, 120 ms, 0.06) and a wood drum (sine 140 -> 70, 120 ms, 0.25)
  const shimmer = tagged(step(4), 'shimmer')[0];
  assert.deepEqual([shimmer.filter.freq, shimmer.endMs, shimmer.gain], [7000, 120, 0.06]);
  const drum = tagged(step(4), 'drum')[0];
  assert.deepEqual([drum.freq.from, drum.freq.to, drum.freq.ms, drum.gain], [140, 70, 120, 0.25]);
  assert.equal(tagged(step(3), 'drum').length, 0);
  // n >= 7: the gong (196 Hz, 541 and 1058 Hz partials) and a taiko hit; later steps only re-strike a shorter, softer one
  const gong7 = tagged(step(7), 'gong');
  assert.deepEqual(gong7.map((l) => l.freq), [196, 541, 1058, 1650]);
  assert.ok(gong7[0].endMs >= 1300 && gong7[0].endMs <= 1500, 'about 1.4 s');
  assert.equal(tagged(step(7), 'taiko').length, 2);
  assert.equal(tagged(step(6), 'gong').length, 0);
  assert.ok(tagged(step(9), 'gong')[0].endMs < gong7[0].endMs && tagged(step(9), 'gong')[0].gain < gong7[0].gain);
  // loudness rises with the chain, priority is combo, at most 6 live steps
  const levels = [2, 3, 4, 5, 7].map((n) => step(n).levelDb);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] > levels[i - 1], 'louder with every level');
  assert.equal(step(3).priority, PRIORITY.combo);
  assert.equal(step(3).maxVoices, 6);
});

test('comboChime: notes 60 ms apart (sine + triangle +5 cents), gong from n >= 4 that ducks the slice bus', () => {
  const c3 = buildRecipe('comboChime', { n: 3 });
  assert.equal(c3.layers.length, 6);
  assert.deepEqual(c3.layers.filter((l) => l.wave === 'sine').map((l) => l.startMs), [0, 60, 120]);
  assert.ok(c3.layers.filter((l) => l.wave === 'triangle').every((l) => l.detuneCents === 5));
  assert.equal(c3.layers[0].freq, 523.25);
  assert.equal(c3.duck, undefined, 'a small combo does not duck');
  const c4 = buildRecipe('comboChime', { n: 4 });
  assert.equal(c4.layers.length, 8 + 2);
  assert.ok(c4.layers.some((l) => l.freq === 196 && l.endMs === 1200));
  assert.ok(c4.layers.some((l) => l.freq === 392 && l.endMs === 800));
  assert.deepEqual(c4.duck, [{ groups: ['slice'], amount: 0.6, ms: 250 }]);
  assert.equal(buildRecipe('comboChime', { n: 9 }).layers.filter((l) => l.wave === 'sine' && l.freq < 2000 && l.startMs <= 240).length >= 5, true);
  assert.equal(buildRecipe('comboChime', { n: 9 }).layers.filter((l) => l.startMs === 240).length, 2, 'at most five notes');
});

test('bombBoom: crackle, body and sub of the design plus punch, six-burst rattle, metallic ring and a 2 s tail; ducks slice and UI', () => {
  const boom = buildRecipe('bombBoom');
  assert.deepEqual(boom.layers.slice(0, 3).map((l) => l.tag), ['crackle', 'body', 'sub']);
  assert.equal(boom.layers[1].filter.freq.from, 2000);
  assert.equal(boom.layers[1].filter.freq.to, 80);
  assert.equal(boom.layers[2].freq.to, 35);
  const punch = tagged(boom, 'punch')[0];
  assert.ok(punch.freq.from > 100 && punch.freq.to < 60 && punch.freq.ms <= 100, 'a short pitched-down thump');
  const rattle = tagged(boom, 'rattle');
  assert.equal(rattle.length, 6);
  for (let i = 1; i < rattle.length; i++) assert.ok(rattle[i].startMs > rattle[i - 1].startMs && rattle[i].gain < rattle[i - 1].gain, 'debris: later, quieter');
  assert.deepEqual(tagged(boom, 'ring').map((l) => [l.freq, l.endMs, l.gain]), [[1180, 400, 0.06], [1830, 400, 0.06]]);
  const tail = tagged(boom, 'tail')[0];
  assert.deepEqual([tail.filter.type, tail.filter.freq.from, tail.filter.freq.to, tail.gain], ['lowpass', 600, 150, 0.25]);
  assert.ok(tail.startMs + tail.endMs >= 2000, 'the tail runs for about 2 s');
  assert.deepEqual(boom.duck, [{ groups: ['slice', 'ui'], amount: 0.4, ms: 350 }]);
  assert.equal(boom.priority, PRIORITY.bomb);
});

test('numbers of the design table: life, golden, record, timeUp, tick, gameOver, warn, Freeze hold, slowmo dip', () => {
  const life = buildRecipe('lifeLost');
  assert.deepEqual(life.layers.filter((l) => l.wave === 'triangle').map((l) => [l.freq, l.startMs, l.endMs]), [[329.6, 50, 130], [261.6, 180, 130]]);
  const crack = tagged(life, 'crack')[0];
  assert.deepEqual([crack.filter.type, crack.filter.freq, crack.endMs, crack.gain], ['highpass', 3000, 20, 0.3]);
  const rec = buildRecipe('record');
  assert.deepEqual(rec.layers.filter((l) => l.wave === 'sine').map((l) => l.freq), [523.25, 587.33, 659.25, 783.99, 1046.5]);
  const bell = buildRecipe('timeUp');
  assert.deepEqual(bell.layers.map((l) => [l.freq, l.gain, l.endMs]), [[880, 0.2, 1500], [2429, 0.1, 1500], [4752, 0.05, 1500]]);
  assert.equal(buildRecipe('tick', {}).layers[0].freq, 1000);
  assert.equal(buildRecipe('tick', { urgent: true }).layers[0].freq, 1400);
  assert.ok(buildRecipe('tick', { urgent: true }).levelDb > buildRecipe('tick').levelDb, 'the last three seconds are a little louder');
  assert.deepEqual(buildRecipe('gameOver').layers.map((l) => [l.freq, l.startMs]), [[220, 0], [174.6, 250], [146.8, 500], [110, 750]]);
  assert.deepEqual(buildRecipe('gameOver').duck, [{ groups: ['slice', 'ui'], amount: 0.4, ms: 350 }]);
  assert.equal(buildRecipe('bombWarn').layers[1].startMs, 150);
  assert.equal(buildRecipe('freezeActivate').masterFilter.holdHz, 2500);
  assert.deepEqual(buildRecipe('slowmo').masterFilter, { dipHz: 1800, downMs: 60, upMs: 300 });
  assert.equal(buildRecipe('calHold', { ms: 1500 }).layers[0].freq.ms, 1500);
});

test('Golden Apple: the six shimmer partials of the design plus a gong strike, an upward noise sweep and a glitter; ducks the slice bus', () => {
  const gold = buildRecipe('golden');
  assert.deepEqual(gold.layers.filter((l) => l.tag === 'shimmer').map((l) => [l.freq, l.startMs]), [[1319, 0], [1568, 45], [1760, 90], [2093, 135], [2349, 180], [2637, 225]]);
  const strike = tagged(gold, 'gong')[0];
  assert.deepEqual([strike.freq, strike.endMs, strike.gain], [392, 1000, 0.15]);
  const sweep = tagged(gold, 'sweep')[0];
  assert.deepEqual([sweep.filter.type, sweep.filter.freq.from, sweep.filter.freq.to, sweep.filter.freq.ms, sweep.gain], ['bandpass', 2000, 8000, 300, 0.08]);
  assert.ok(tagged(gold, 'glitter').length >= 3);
  assert.deepEqual(gold.duck, [{ groups: ['slice'], amount: 0.6, ms: 250 }]);
  assert.ok(gold.wet > 0, 'a touch of room');
});

test('power-up cues: Freeze glass chime, crack ticks and shatter; Frenzy taiko roll; Double sparkle', () => {
  const fz = buildRecipe('freezeActivate');
  assert.deepEqual(tagged(fz, 'glass').map((l) => [l.freq, l.startMs, l.endMs, l.gain]), [[2093, 0, 600, 0.08], [2794, 40, 600, 0.08], [3136, 80, 600, 0.08]]);
  assert.equal(fz.layers.length, 2 + 3);
  const crackTicks = buildRecipe('freezeCrack');
  assert.equal(crackTicks.layers.length, 3, 'three ice-crack ticks');
  assert.deepEqual(crackTicks.layers.map((l) => [l.startMs, l.filter.freq, l.endMs, l.gain]), [[0, 5000, 40, 0.12], [60, 5000, 40, 0.12], [120, 5000, 40, 0.12]]);
  const shatter = tagged(buildRecipe('freezeEnd'), 'shatter')[0];
  assert.deepEqual([shatter.filter.type, shatter.filter.freq, shatter.endMs, shatter.gain], ['highpass', 6000, 200, 0.15]);
  const frenzy = buildRecipe('frenzyActivate');
  assert.deepEqual(tagged(frenzy, 'roll').map((l) => [l.freq, l.startMs, l.gain]), [[90, 0, 0.25], [90, 70, 0.25], [90, 140, 0.25]]);
  assert.equal(frenzy.layers.length, 3 + 3, 'the existing two saws and noise burst are still there');
  const dbl = buildRecipe('doubleActivate');
  assert.deepEqual(tagged(dbl, 'sparkle').map((l) => l.freq), [1976, 2349, 2637, 3136]);
  assert.deepEqual(tagged(dbl, 'sparkle').map((l, i, a) => (i ? l.startMs - a[i - 1].startMs : 40)), [40, 40, 40, 40], 'four notes 40 ms apart');
  assert.equal(tagged(dbl, 'sparkle')[0].gain, 0.07);
  assert.equal(dbl.layers.filter((l) => l.wave === 'triangle').length, 4, 'the coin strike pair is unchanged');
});

test('countdown: a wood block that rises 3 at 523 Hz, 2 at 659 Hz, 1 at 784 Hz; go is a gong with a taiko hit', () => {
  assert.deepEqual(COUNTDOWN_HZ, { 3: 523.25, 2: 659.25, 1: 783.99 });
  const hz = [3, 2, 1].map((n) => buildRecipe('countdown', { n }).layers[0].freq);
  assert.ok(Math.abs(hz[0].from - 880) < 1 && Math.abs(hz[0].to - 599) < 2, 'the 3 glides 880 -> 600 Hz');
  assert.equal(hz[0].ms, 70);
  assert.ok(hz[1].from > hz[0].from && hz[2].from > hz[1].from, 'the pitch rises per number');
  const three = buildRecipe('countdown', { n: 3 });
  assert.equal(three.layers[0].gain, 0.22);
  const tick = tagged(three, 'tick')[0];
  assert.deepEqual([tick.filter.type, tick.filter.freq, tick.endMs], ['bandpass', 2500, 15]);
  const thump = tagged(three, 'thump')[0];
  assert.deepEqual([thump.freq, thump.endMs, thump.gain], [110, 90, 0.2]);
  assert.deepEqual(buildRecipe('countdown', {}).layers[0].freq, hz[0], 'no number: the 3');
  const go = buildRecipe('go');
  assert.deepEqual(tagged(go, 'gong').map((l) => [l.freq, l.gain, l.endMs]), [[196, 0.28, 1600], [541, 0.12, 1100], [1058, 0.06, 700], [1650, 0.03, 400]]);
  const burst = tagged(go, 'burst')[0];
  assert.deepEqual([burst.filter.type, burst.filter.freq, burst.endMs, burst.gain], ['highpass', 2000, 120, 0.15]);
  assert.equal(tagged(go, 'taiko').length, 2);
  assert.ok(go.priority >= PRIORITY.combo, 'the gong is never dropped for a UI blip');
});

test('results: rankStamp is a taiko hit that ducks; resultsFanfare grows with the rank; countTick rises with the progress', () => {
  const stamp = buildRecipe('rankStamp');
  const [body, slap] = tagged(stamp, 'taiko');
  assert.deepEqual([body.freq.from, body.freq.to, body.endMs, body.gain], [120, 50, 250, 0.5]);
  assert.deepEqual([slap.filter.type, slap.filter.freq, slap.endMs, slap.gain], ['lowpass', 800, 120, 0.3]);
  assert.deepEqual(stamp.duck, [{ groups: ['slice', 'ui'], amount: 0.4, ms: 350 }]);
  const arp = (rank) => tagged(buildRecipe('resultsFanfare', { rank }), 'arp').filter((l) => l.wave === 'sine').map((l) => l.freq);
  assert.deepEqual(arp(5), [523.25, 587.33, 659.25, 783.99, 1046.5], 'the record arpeggio C5 D5 E5 G5 C6');
  assert.deepEqual(arp(4), arp(5));
  assert.equal(arp(3).length, 4);
  assert.equal(arp(2).length, 3);
  assert.equal(arp(1).length, 0);
  const pad = (rank) => tagged(buildRecipe('resultsFanfare', { rank }), 'pad').map((l) => [l.freq, l.endMs, l.gain]);
  assert.deepEqual(pad(5), [[523.25, 900, 0.08], [783.99, 900, 0.08]], 'a sustained fifth for the top ranks');
  assert.deepEqual(pad(4), pad(5));
  assert.deepEqual(pad(3), []);
  assert.equal(tagged(buildRecipe('resultsFanfare', { rank: 5 }), 'gong').length, 4, 'Legend gets a gong strike');
  assert.equal(tagged(buildRecipe('resultsFanfare', { rank: 4 }), 'gong').length, 0);
  const low = tagged(buildRecipe('resultsFanfare', { rank: 1 }), 'fall');
  assert.equal(low.length, 4);
  assert.ok(low.at(-1).freq < low[0].freq, 'a single falling pair');
  assert.equal(arp('S').length, 5, 'letters work too');
  assert.equal(arp('D').length, 0);
  assert.deepEqual([rankIndex(0), rankIndex(9), rankIndex('x'), rankIndex(undefined), rankIndex(3.4)], [1, 5, 3, 3, 3]);
  const t0 = buildRecipe('countTick', { progress: 0 }).layers[0];
  const t1 = buildRecipe('countTick', { progress: 1 }).layers[0];
  assert.deepEqual([t0.wave, t0.freq, t0.endMs, t0.gain, t1.freq], ['triangle', 1800, 12, 0.07, 2600]);
  assert.equal(buildRecipe('countTick', { progress: 7 }).layers[0].freq, 2600, 'clamped');
});

test('UI sounds: stick tick alternates +-3 percent and is rate limited, confirm has a bell, back does not, whoosh sweeps, error buzzes', () => {
  const a = buildRecipe('uiMove', { flip: true });
  const b = buildRecipe('uiMove', { flip: false });
  const [wa, wb] = [a.layers[0].freq, b.layers[0].freq];
  assert.ok(Math.abs(wa.from / 1500 - 1.03) < 1e-9 && Math.abs(wb.from / 1500 - 0.97) < 1e-9);
  assert.ok(Math.abs(wa.to / 1100 - 1.03) < 1e-9);
  assert.deepEqual([wa.ms, a.layers[0].endMs, a.layers[0].gain], [18, 18, 0.07]);
  const tick = a.layers[1];
  assert.deepEqual([tick.filter.type, tick.filter.freq, tick.endMs, tick.gain], ['bandpass', 3000, 8, 0.04]);
  assert.equal(a.minGapMs, 40);
  const sel = buildRecipe('uiSelect');
  assert.deepEqual(sel.layers.filter((l) => !l.tag).map((l) => [l.freq, l.startMs]), [[660, 0], [880, 80]]);
  const bell = tagged(sel, 'bell')[0];
  assert.deepEqual([bell.freq, bell.endMs, bell.gain], [1760, 250, 0.05]);
  assert.equal(tagged(buildRecipe('uiBack'), 'bell').length, 0);
  assert.deepEqual(buildRecipe('uiBack').layers.map((l) => [l.freq, l.startMs]), [[660, 0], [440, 80]]);
  const up = buildRecipe('uiWhoosh').layers[0];
  const down = buildRecipe('uiWhoosh', { reverse: true }).layers[0];
  assert.deepEqual([up.filter.freq.from, up.filter.freq.to, up.filter.freq.ms, up.filter.Q, up.gain], [400, 2400, 220, 1.5, 0.1]);
  assert.deepEqual([down.filter.freq.from, down.filter.freq.to], [2400, 600]);
  const err = buildRecipe('uiError');
  assert.deepEqual(err.layers.map((l) => [l.wave, l.freq, l.startMs, l.endMs, l.filter.type, l.filter.freq, l.gain]), [['square', 180, 0, 60, 'lowpass', 900, 0.08], ['square', 180, 110, 60, 'lowpass', 900, 0.08]]);
  for (const id of ['uiMove', 'uiSelect', 'uiBack', 'uiError', 'uiWhoosh', 'countTick', 'countdown']) assert.equal(buildRecipe(id).priority, PRIORITY.ui, id);
});

test('swoosh targets: 500 Hz / 0.08 at T, 3200 Hz / 0.28 at T + 4000, silent when not cutting', () => {
  assert.deepEqual(swooshTargets(1000, 1000, true), { centerHz: 500, gain: 0.08 });
  const top = swooshTargets(5000, 1000, true);
  assert.equal(top.centerHz, 3200);
  assert.ok(Math.abs(top.gain - 0.28) < 1e-12);
  assert.equal(swooshTargets(3000, 1000, true).centerHz, 500 + 2700 * 0.5);
  assert.equal(swooshTargets(3000, 1000, false).gain, 0);
  assert.equal(swooshTargets(9000, 1000, true).centerHz, 3200, 'clamped');
});

test('the priority order is bomb > life > combo > power-up > slice > UI', () => {
  const p = PRIORITY;
  assert.ok(p.bomb > p.life && p.life > p.combo && p.combo > p.powerup && p.powerup > p.slice && p.slice > p.ui);
  assert.equal(CONFIG.audio.voices, 24);
});

test('the recipes are pure data: building twice gives equal results and never touches shared state', () => {
  for (const id of SOUND_IDS) {
    const x = JSON.stringify(buildRecipe(id, { n: 6, rank: 4, r: 70, k: 2, ci: 3, fruit: 'apple', jitter: 1.03 }));
    const y = JSON.stringify(buildRecipe(id, { n: 6, rank: 4, r: 70, k: 2, ci: 3, fruit: 'apple', jitter: 1.03 }));
    assert.equal(x, y, id);
  }
});
