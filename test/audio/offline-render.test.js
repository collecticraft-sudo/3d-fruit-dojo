// Offline render of every sound in headless Chrome (real WebAudio: real compressor, convolver and shaper): no clipping, every sound lands
// on the level target of docs/restyle-direction.md 4, nothing is silent, tails end, no DC offset. The test reports "skipped" (never
// "passed") when Chrome is not available. Tool: test-support/audio/render-sounds.mjs (the same numbers as the sound lab on port 8274).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findChrome } from '../../test-support/e2e/chrome-launcher.js';
import { renderAllSounds } from '../../test-support/audio/render-sounds.mjs';

const skip = findChrome() ? false : 'Google Chrome not found (set CHROME_PATH)';

test('offline render: every sound is audible, on target, never clips, tails end and the worst-case mixes stay under the master ceiling', { skip, timeout: 120000 }, async (t) => {
  const out = await renderAllSounds({ port: 0 });
  if (out.skip) { t.skip(out.skip); return; }
  const { results } = out;
  assert.ok(results.length >= 65, `${results.length} renders`);
  assert.deepEqual(out.exceptions, [], 'no exception in the lab page');
  const singles = results.filter((r) => r.kind === 'sound');
  const mixes = results.filter((r) => r.kind === 'mix');
  assert.equal(mixes.length, 4);
  for (const r of results) {
    assert.equal(r.clipped, false, `${r.name} clips (output peak ${r.peakOut})`);
    assert.ok(r.peakOut <= 0.8 + 1e-3, `${r.name}: output peak ${r.peakOut} is above the master ceiling 0.8`);
    assert.ok(r.peakPreDb > -40, `${r.name} is nearly silent (${r.peakPreDb} dBFS)`);
    assert.ok(r.tailS < 2.6, `${r.name}: tail ${r.tailS} s`);
    assert.ok(Math.abs(r.dc) < 0.01, `${r.name}: DC offset ${r.dc}`);
  }
  for (const r of singles) assert.ok(Math.abs(r.deltaDb) <= 4, `${r.name}: peak ${r.peakPreDb} dBFS is ${r.deltaDb} dB from its target ${r.targetDb}`);
  const by = (name) => results.find((r) => r.name === name);
  // the loudest singles are the bomb, the GO gong and the rank stamp (-4 dBFS); the rest sits at least 3 dB below them
  const top = ['bombBoom', 'go', 'rankStamp'].map((n) => by(n).peakPreDb);
  const rest = singles.filter((r) => !['bombBoom', 'go', 'rankStamp'].includes(r.name));
  assert.ok(Math.max(...rest.map((r) => r.peakPreDb)) < Math.min(...top) - 3, 'bomb, gong and stamp are the loudest sounds');
  // the level ladder of the direction: slice -12, golden and combo -10, power-up -9, life -8, UI at -18 or below
  assert.ok(Math.abs(by('slice apple').peakPreDb + 12) <= 2);
  assert.ok(by('comboStep x7').peakPreDb > by('comboStep x2').peakPreDb + 2, 'the combo gets louder');
  for (const n of ['uiMove', 'uiSelect', 'uiBack', 'uiError', 'uiWhoosh', 'countTick']) assert.ok(by(n).peakPreDb <= -17, `${n}: ${by(n).peakPreDb}`);
  // the transient-heavy bomb is low and long: most of its energy is below 250 Hz, its tail runs for about a second
  assert.ok(by('bombBoom').bandsPct.low >= 60 && by('bombBoom').tailS >= 0.6);
  // the gong and the bell ring on (reverb included)
  assert.ok(by('go').tailS >= 0.8 && by('timeUp').tailS >= 0.8);
  // all four stress mixes, volume 1: the safety soft clip keeps them at or below the master ceiling
  for (const m of mixes) assert.ok(m.peakOut <= 0.8 + 1e-3 && m.voices >= 2, m.name);
});
