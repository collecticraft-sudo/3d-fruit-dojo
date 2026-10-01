// Stage backdrops, part 1: the screen-to-stage tables, the pure helpers, and the loading / fallback / crossfade / residency state machine
// (docs/assets-integration.md 4.1 to 4.5 and 8.4). Everything runs with stub images and a recording context; no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART_CONFIG } from '../../public/js/render/art-config.js';
import {
  CALM_DEFAULT, CALM_STOPS, STAGE_IDS, STAGE_LAYERS, calmAlphaAt, compositeDensity, createStage, densityStep, driftOffset, layerAssetId,
  parallaxTransform, stageGroup, stageIdFor, veilFor,
} from '../../public/js/render/stage.js';
import { makeStageRig } from '../../test-support/stage/recorder.js';
import { createStageStubAssets } from '../../test-support/stage/stub-assets.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Bring a stage from "requested" to "fully shown": settle the load, run the crossfade to its end. */
async function showStage(rig, id, t0 = 0) {
  rig.frame({ mode: id, nowMs: t0 });
  await rig.assets.settle(`stage:${id}`);
  rig.frame({ nowMs: t0 + 10 }); // the crossfade starts on the first draw after the load
  rig.frame({ nowMs: t0 + 10 + ART_CONFIG.stage.crossfadeMs + 1 });
  rig.frame({ nowMs: t0 + 10 + ART_CONFIG.stage.crossfadeMs + 2 });
  assert.equal(rig.stage.status().shown, id, `${id} is shown`);
}

// ------------------------------------------------------------------------------------------------ tables (final since the skeleton)

test('STAGE_IDS are the three round stages and the night stage, frozen; layers are far, mid, near', () => {
  assert.deepEqual([...STAGE_IDS], ['classic', 'arcade', 'zen', 'menu']);
  assert.ok(Object.isFrozen(STAGE_IDS));
  assert.deepEqual([...STAGE_LAYERS], ['far', 'mid', 'near']);
  assert.equal(stageGroup('zen'), 'stage:zen');
  assert.equal(layerAssetId('arcade', 'mid'), 'bg_arcade_mid');
});

test('stageIdFor: round screens use the stage of their mode, everything else the night stage', () => {
  for (const screen of ['countdown', 'playing', 'paused', 'results']) {
    for (const mode of ['classic', 'arcade', 'zen']) assert.equal(stageIdFor(screen, mode), mode, `${screen} ${mode}`);
    for (const mode of ['practice', null, undefined, 'bogus', '']) assert.equal(stageIdFor(screen, mode), 'menu', `${screen} ${String(mode)}`);
  }
  for (const screen of ['boot', 'safety', 'connect', 'calibration', 'settings', 'tuning', 'menu', 'nonsense', undefined]) {
    for (const mode of ['classic', 'arcade', 'zen', 'practice', null]) assert.equal(stageIdFor(screen, mode), 'menu', `${String(screen)} ${String(mode)}`);
  }
});

test('stageIdFor: an overlay never changes the stage (the caller passes the screen underneath)', () => {
  // the disconnected overlay while playing sits on 'paused', so it keeps the round stage; the confirm dialog sits on pause or settings
  assert.equal(stageIdFor('paused', 'arcade'), 'arcade');
  assert.equal(stageIdFor('settings', null), 'menu');
  assert.equal(stageIdFor('connect', null), 'menu');
});

test('veilFor: none on the round stages, 0.5 on the menu, 0.52 on every other night screen (ART_CONFIG.stage.veil, tinted since art review round 1)', () => {
  assert.equal(ART_CONFIG.stage.veil.menu, 0.5);
  assert.equal(ART_CONFIG.stage.veil.other, 0.52);
  assert.match(ART_CONFIG.stage.veil.color, /^#[0-9A-Fa-f]{6}$/, 'the veil has a colour of its own (a pale blue-grey, not paper)');
  for (const screen of ['countdown', 'playing', 'paused', 'results', 'menu', 'connect']) {
    for (const id of ['classic', 'arcade', 'zen']) assert.equal(veilFor(id, screen), 0);
  }
  assert.equal(veilFor('menu', 'menu'), ART_CONFIG.stage.veil.menu);
  for (const screen of ['boot', 'safety', 'connect', 'calibration', 'settings', 'tuning', 'countdown', undefined]) {
    assert.equal(veilFor('menu', screen), ART_CONFIG.stage.veil.other, String(screen));
  }
});

// ------------------------------------------------------------------------------------------------ pure helpers

test('densityStep is the renderer step (1, 1.5, 2) and compositeDensity caps it at 1.28', () => {
  assert.equal(densityStep(0.4), 1);
  assert.equal(densityStep(1), 1);
  assert.equal(densityStep(1.01), 1.5);
  assert.equal(densityStep(1.5), 1.5);
  assert.equal(densityStep(1.51), 2);
  assert.equal(densityStep(3), 2);
  assert.equal(densityStep(NaN), 1);
  assert.equal(densityStep(-2), 1);
  assert.equal(compositeDensity(0.5), 1);
  assert.equal(compositeDensity(1), 1);
  assert.equal(compositeDensity(1.2), 1.28);
  assert.equal(compositeDensity(2), 1.28);
  assert.equal(compositeDensity(2, 1.1), 1.1);
  assert.equal(compositeDensity(2, NaN), 1.28, 'a broken cap falls back to the documented one');
  assert.equal(Math.round(2000 * compositeDensity(2)), 2560);
  assert.equal(Math.round(1125 * compositeDensity(2)), 1440);
});

test('parallaxTransform: -(1 - p) * shake / zoom and (1 + (zoom - 1) * p) / zoom about the field centre', () => {
  const out = { tx: 9, ty: 9, scale: 9 };
  assert.deepEqual(parallaxTransform(1, 20, -10, 1.03, out), { tx: 0, ty: 0, scale: 1 }, 'the near layer follows the gameplay fully');
  const far = parallaxTransform(0.25, 20, -10, 1, out);
  assert.equal(far.tx, -15);
  assert.equal(far.ty, 7.5);
  assert.equal(far.scale, 1);
  const zoomed = parallaxTransform(0.55, 0, 0, 1.03, out);
  assert.equal(zoomed.tx, 0);
  assert.equal(Object.is(zoomed.tx, -0), false, 'never -0');
  assert.ok(Math.abs(zoomed.scale - (1 + 0.03 * 0.55) / 1.03) < 1e-12);
  const still = parallaxTransform(0, 22, 22, 1.03, out);
  assert.ok(Math.abs(still.tx + 22 / 1.03) < 1e-12, 'divided by zoom: the translation lives inside the zoomed game layer');
  assert.ok(Math.abs(still.scale - 1 / 1.03) < 1e-12);
  assert.equal(parallaxTransform(0.25, 20, -10, 1, out).tx, -15, 'at zoom 1 it is the contract formula verbatim');
});

test('driftOffset: sinusoid of the night drift, quarter-period phase shift for the near layer, zero without amplitude', () => {
  const d = ART_CONFIG.stage.drift;
  assert.equal(driftOffset(0, 0, d.midPx, d.periodS), 0);
  assert.ok(Math.abs(driftOffset((d.periodS * 1000) / 4, 0, d.midPx, d.periodS) - d.midPx) < 1e-9, 'mid peaks at a quarter period');
  assert.ok(Math.abs(driftOffset(0, 0.25, d.nearPx, d.periodS) - d.nearPx) < 1e-9, 'near starts at its peak');
  assert.ok(Math.abs(driftOffset((d.periodS * 1000) / 4, 0.25, d.nearPx, d.periodS)) < 1e-9, 'and crosses zero when mid peaks');
  assert.equal(driftOffset(1234, 0, 0, d.periodS), 0);
  assert.equal(driftOffset(1234, 0, 4, 0), 0);
  for (let t = 0; t < 200000; t += 997) assert.ok(Math.abs(driftOffset(t, 0.25, d.nearPx, d.periodS)) <= d.nearPx + 1e-9);
});

test('calm zone: strongest at the edges, zero across the middle of the field, symmetric, defaults are subtle and off on the night stage', () => {
  assert.equal(calmAlphaAt(0), 1);
  assert.equal(calmAlphaAt(1), 1);
  assert.equal(calmAlphaAt(0.5), 0);
  assert.equal(calmAlphaAt(0.32), 0);
  assert.equal(calmAlphaAt(0.68), 0);
  for (let x = 0; x <= 1; x += 0.05) assert.ok(Math.abs(calmAlphaAt(x) - calmAlphaAt(1 - x)) < 1e-9, `symmetric at ${x}`);
  for (let i = 1; i < CALM_STOPS.length; i++) assert.ok(CALM_STOPS[i][0] > CALM_STOPS[i - 1][0], 'stops ascend');
  assert.equal(calmAlphaAt(-1), 1);
  assert.equal(calmAlphaAt(2), 1);
  assert.equal(CALM_DEFAULT.menu, 0);
  for (const id of ['classic', 'arcade', 'zen']) assert.ok(CALM_DEFAULT[id] > 0 && CALM_DEFAULT[id] <= 0.15, `${id} haze is subtle`);
});

// ------------------------------------------------------------------------------------------------ inert without art

test('without usable assets the stage is inert: fallback always, nothing drawn, nothing loaded, no throw', () => {
  const inert = [
    createStage(),
    createStage({}),
    createStage({ assets: null }),
    createStage({ assets: { isNull: true, config: ART_CONFIG, generation: 0, load: () => Promise.resolve({ state: 'disabled' }), get: () => null } }),
    createStage({ assets: { config: ART_CONFIG } }), // no load, no get
  ];
  const rig = makeStageRig();
  for (const stage of inert) {
    stage.resize(1);
    stage.setMode('classic');
    stage.prefetch('arcade');
    assert.equal(stage.needsFallback(), true);
    assert.equal(stage.draw(rig.ctx, { nowMs: 0, screen: 'menu', shakeX: 0, shakeY: 0, zoom: 1, reduceMotion: false }), false);
    assert.equal(rig.ctx.ops.length, 0);
    const s = stage.status();
    assert.equal(s.shown, null);
    assert.equal(s.fading, false);
    assert.deepEqual(s.resident, []);
    stage.dispose();
    stage.dispose();
  }
});

test('the front pass draws nothing and returns false (reserved for a future foreground)', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'classic');
  rig.ctx.reset();
  assert.equal(rig.stage.draw(rig.ctx, rig.view, 'front'), false);
  assert.equal(rig.ctx.ops.length, 0);
  assert.equal(rig.stage.draw(rig.ctx, rig.view, 'back'), true);
});

test('draw ignores a missing context or view without throwing', () => {
  const rig = makeStageRig();
  assert.equal(rig.stage.draw(null, rig.view), false);
  assert.equal(rig.stage.draw(rig.ctx, null), false);
  assert.equal(rig.stage.draw(rig.ctx, undefined, 'back'), false);
});

// ------------------------------------------------------------------------------------------------ loading and the first crossfade

test('setMode starts loading group stage:<id> once; an unchanged or unknown mode is a cheap no-op; nothing is blank while loading', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  let f = rig.frame({ mode: 'classic', nowMs: 0 });
  assert.equal(f.fallback, true, 'procedural background while nothing is ready');
  assert.equal(f.drew, false, 'nothing drawn while loading');
  assert.deepEqual(rig.assets.pending(), ['stage:classic']);
  for (let i = 0; i < 20; i++) rig.frame({ mode: 'classic', nowMs: 16 * (i + 1) });
  assert.equal(rig.assets.loadCount('stage:classic'), 1, 'setMode with the same id does not reload');
  rig.stage.setMode('practice');
  rig.stage.setMode(null);
  rig.stage.setMode(undefined);
  rig.stage.setMode(42);
  assert.equal(rig.stage.status().mode, 'classic', 'unknown modes are ignored');
  assert.deepEqual(rig.assets.log.loads, [{ group: 'stage:classic', low: false }]);
  assert.deepEqual(rig.stage.status().loading, ['classic']);
});

test('the night stage is requested at low priority while nothing covers the screen yet (it yields to core); a round stage never is', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  rig.frame({ mode: 'menu', nowMs: 0, screen: 'boot' });
  assert.deepEqual(rig.assets.log.loads, [{ group: 'stage:menu', low: true }]);
  await rig.assets.settle('stage:menu');
  rig.frame({ nowMs: 10 });
  rig.frame({ nowMs: 500 });
  rig.frame({ mode: 'classic', nowMs: 600, screen: 'countdown' });
  assert.deepEqual(rig.assets.log.loads.at(-1), { group: 'stage:classic', low: false });
  await rig.assets.settle('stage:classic');
  rig.frame({ nowMs: 610 });
  rig.frame({ nowMs: 1100 });
  rig.frame({ nowMs: 1101 });
  rig.frame({ mode: 'menu', nowMs: 2000, screen: 'menu' });
  assert.deepEqual(rig.assets.log.loads.at(-1), { group: 'stage:menu', low: false }, 'coming back from a round: the old stage is on screen, the load is not background work');
});

test('needsFallback notices images that vanished since the last frame, so the renderer never draws a blank frame', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'classic');
  assert.equal(rig.stage.needsFallback(), false);
  rig.assets.dropImagesSilently('stage:classic');
  assert.equal(rig.stage.needsFallback(), true, 'asked before the draw, answered from the current generation');
});

test('the first stage fades in over the procedural background: needsFallback stays true until the crossfade ends, time comes from view.nowMs', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  rig.frame({ mode: 'classic', nowMs: 0 });
  await rig.assets.settle('stage:classic');
  assert.equal(rig.stage.status().shown, null);

  const t0 = 5000;
  let f = rig.frame({ nowMs: t0 }); // the fade starts on this first draw: alpha 0, nothing visible yet
  assert.equal(f.fallback, true);
  assert.equal(f.drew, false);
  assert.equal(rig.stage.status().fading, true);

  const ms = ART_CONFIG.stage.crossfadeMs;
  assert.equal(ms, 400);
  f = rig.frame({ nowMs: t0 + ms / 4 });
  assert.equal(f.fallback, true, 'still fading over the procedural background');
  assert.equal(f.images.length, 1, 'the composite, fast path');
  assert.ok(Math.abs(f.images[0].alpha - 0.25) < 1e-9, `alpha ${f.images[0].alpha}`);
  f = rig.frame({ nowMs: t0 + ms / 2 });
  assert.ok(Math.abs(f.images[0].alpha - 0.5) < 1e-9);
  assert.equal(f.fallback, true);
  f = rig.frame({ nowMs: t0 + ms });
  assert.equal(f.images[0].alpha, 1, 'the crossfade ends at crossfadeMs');
  assert.equal(rig.stage.status().fading, false);
  assert.equal(rig.stage.status().shown, 'classic');
  f = rig.frame({ nowMs: t0 + ms + 16 });
  assert.equal(f.fallback, false, 'the art covers the field now: the renderer skips the procedural background');
  assert.equal(f.images.length, 1);
});

test('the crossfade is driven by view.nowMs only: a clock that jumps back restarts from the current alpha and never leaves 0..1', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  rig.frame({ mode: 'classic', nowMs: 0 });
  await rig.assets.settle('stage:classic');
  rig.frame({ nowMs: 10000 });
  let f = rig.frame({ nowMs: 10200 });
  assert.ok(Math.abs(f.images[0].alpha - 0.5) < 1e-9);
  f = rig.frame({ nowMs: 100 }); // manual clock reset
  assert.equal(rig.stage.status().fading, true);
  assert.ok(f.images.length === 1 && f.images[0].alpha >= 0.49 && f.images[0].alpha <= 0.51, `continues from 0.5, got ${f.images[0]?.alpha}`);
  f = rig.frame({ nowMs: 100 + 200 });
  assert.ok(f.images[0].alpha > 0.9 && f.images[0].alpha <= 1);
  rig.frame({ nowMs: 100 + 420 });
  assert.equal(rig.stage.status().shown, 'classic');
});

test('Reduce motion turns the crossfade into a cut', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  rig.frame({ mode: 'classic', nowMs: 0, reduceMotion: true });
  await rig.assets.settle('stage:classic');
  const f = rig.frame({ nowMs: 100 });
  assert.equal(rig.stage.status().fading, false);
  assert.equal(rig.stage.status().shown, 'classic');
  assert.equal(f.images.length, 1);
  assert.equal(f.images[0].alpha, 1, 'fully visible at once');
  assert.equal(rig.frame({ nowMs: 116 }).fallback, false);
});

test('Reduce motion switched on during a crossfade completes it at the next frame', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  rig.frame({ mode: 'classic', nowMs: 0 });
  await rig.assets.settle('stage:classic');
  rig.frame({ nowMs: 1000 });
  rig.frame({ nowMs: 1100 });
  assert.equal(rig.stage.status().fading, true);
  const f = rig.frame({ nowMs: 1116, reduceMotion: true });
  assert.equal(rig.stage.status().fading, false);
  assert.equal(f.images[0].alpha, 1);
});

// ------------------------------------------------------------------------------------------------ stage switch

test('a stage switch keeps the old stage until the new one is ready, crossfades, then releases the old one', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'menu');
  assert.equal(rig.stage.needsFallback(), false);

  let f = rig.frame({ mode: 'classic', nowMs: 20000, screen: 'countdown', reduceMotion: false });
  assert.equal(f.fallback, false, 'the night stage stays while the new group loads');
  assert.ok(f.drew, 'and it is drawn');
  assert.deepEqual(rig.assets.pending(), ['stage:classic']);
  assert.equal(rig.stage.status().shown, 'menu');

  await rig.assets.settle('stage:classic');
  f = rig.frame({ nowMs: 20016, screen: 'countdown' });
  assert.equal(rig.stage.status().fading, true);
  assert.equal(f.fallback, false, 'old stage covers the field during the crossfade');
  assert.ok(f.drew);
  assert.deepEqual([...rig.stage.status().resident].sort(), ['classic', 'menu'], 'two stages resident during the crossfade');

  f = rig.frame({ nowMs: 20016 + 200, screen: 'countdown' });
  const layers = f.images.filter((o) => o.img.isStub);
  const comps = f.images.filter((o) => o.img.isRecordingCanvas);
  assert.equal(layers.length, 3, 'the old (night) stage is drawn layered, it drifts');
  assert.ok(layers.every((o) => o.alpha > 0 && o.img.id.startsWith('bg_menu_')));
  assert.equal(comps.length, 1, 'the new round stage is one composite');
  assert.ok(Math.abs(comps[0].alpha - 0.5) < 1e-9);
  assert.equal(rig.assets.log.releases.length, 0, 'nothing released before the crossfade ends');

  f = rig.frame({ nowMs: 20016 + 401, screen: 'countdown' });
  assert.equal(rig.stage.status().shown, 'classic');
  assert.deepEqual(rig.stage.status().resident, ['classic']);
  assert.deepEqual(rig.assets.log.releases, ['stage:menu'], 'the old stage is released through the assets');
  assert.equal(f.images.length, 1);
  assert.equal(f.images[0].alpha, 1);
  assert.equal(f.fills.length, 0, 'no veil on a round stage');
});

test('returning to a released stage reloads it and the previous stage stays on screen meanwhile', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'menu');
  rig.frame({ mode: 'arcade', nowMs: 30000, screen: 'countdown' });
  await rig.assets.settle('stage:arcade');
  rig.frame({ nowMs: 30016 });
  rig.frame({ nowMs: 30500 });
  rig.frame({ nowMs: 30501 });
  assert.equal(rig.stage.status().shown, 'arcade');
  assert.deepEqual(rig.assets.log.releases, ['stage:menu']);
  const f = rig.frame({ mode: 'menu', nowMs: 40000, screen: 'menu' });
  assert.equal(rig.assets.loadCount('stage:menu'), 2, 'the night stage loads again');
  assert.equal(f.fallback, false, 'arcade stays on screen while the night stage loads');
  assert.equal(f.images.length, 1);
});

test('going back to the shown stage during a crossfade reverses it and drops the stage that was fading in', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'classic');
  rig.frame({ mode: 'arcade', nowMs: 1000 });
  await rig.assets.settle('stage:arcade');
  rig.frame({ nowMs: 1016 });
  let f = rig.frame({ nowMs: 1216 });
  const fading = f.images.find((o) => o.alpha < 1);
  assert.ok(fading && Math.abs(fading.alpha - 0.5) < 1e-9);
  rig.stage.setMode('classic'); // the player went back
  f = rig.frame({ nowMs: 1266 });
  const back = f.images.find((o) => o.alpha < 1);
  assert.ok(back && back.alpha < 0.5 && back.alpha > 0.3, `fading out from 0.5, got ${back?.alpha}`);
  f = rig.frame({ nowMs: 1700 });
  assert.equal(rig.stage.status().fading, false);
  assert.equal(rig.stage.status().shown, 'classic');
  assert.deepEqual(rig.assets.log.releases, ['stage:arcade'], 'the stage that faded in and out is released');
  assert.equal(f.images.length, 1);
});

test('going back before the fade became visible just drops the new stage', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'classic');
  rig.frame({ mode: 'zen', nowMs: 1000 });
  await rig.assets.settle('stage:zen');
  assert.equal(rig.stage.status().fading, true, 'pending: no draw has started it');
  rig.stage.setMode('classic');
  assert.equal(rig.stage.status().fading, false);
  assert.deepEqual(rig.assets.log.releases, ['stage:zen']);
  assert.equal(rig.stage.status().shown, 'classic');
});

test('a mode change during a crossfade waits for it: the third stage does not load before a resident slot is free', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'menu');
  rig.frame({ mode: 'classic', nowMs: 1000 });
  await rig.assets.settle('stage:classic');
  rig.frame({ nowMs: 1016 });
  rig.frame({ nowMs: 1116 });
  rig.stage.setMode('arcade');
  assert.equal(rig.assets.loadCount('stage:arcade'), 0, 'deferred: menu and classic occupy both slots');
  assert.ok(rig.stage.status().resident.length + rig.stage.status().loading.length <= 2);
  rig.frame({ nowMs: 1500 }); // the crossfade ends here
  assert.equal(rig.stage.status().shown, 'classic');
  assert.equal(rig.assets.loadCount('stage:arcade'), 1, 'now it loads');
  await rig.assets.settle('stage:arcade');
  rig.frame({ nowMs: 1600 });
  rig.frame({ nowMs: 2100 });
  rig.frame({ nowMs: 2101 });
  assert.equal(rig.stage.status().shown, 'arcade');
  assert.deepEqual(rig.stage.status().resident, ['arcade']);
});

// ------------------------------------------------------------------------------------------------ residency and prefetch

test('prefetch loads with low priority and keeps at most maxResidentStages decoded, evicting the least recently used prefetched stage', async () => {
  assert.equal(ART_CONFIG.stage.maxResidentStages, 2);
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'menu');
  const resident = () => rig.stage.status().resident.length + rig.stage.status().loading.length;

  rig.stage.prefetch('classic');
  assert.deepEqual(rig.assets.log.loads.at(-1), { group: 'stage:classic', low: true });
  await rig.assets.settle('stage:classic');
  assert.deepEqual(rig.stage.status().resident.sort(), ['classic', 'menu']);
  assert.equal(rig.stage.status().shown, 'menu', 'a prefetch never changes what is on screen');
  assert.equal(rig.stage.status().fading, false);

  rig.stage.prefetch('arcade'); // a third stage: the prefetched, unused classic goes first
  assert.deepEqual(rig.assets.log.releases, ['stage:classic']);
  assert.ok(resident() <= 2);
  await rig.assets.settle('stage:arcade');
  assert.deepEqual(rig.stage.status().resident.sort(), ['arcade', 'menu']);

  rig.stage.prefetch('arcade'); // already resident: no second load
  assert.equal(rig.assets.loadCount('stage:arcade'), 1);
  rig.stage.prefetch('bogus');
  rig.stage.prefetch(null);
  assert.equal(rig.assets.log.loads.length, 3, 'menu, classic, arcade and nothing else');
});

test('prefetch is refused while both resident slots are in use, and the wanted stage is never evicted', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'menu');
  rig.frame({ mode: 'classic', nowMs: 1000 });
  await rig.assets.settle('stage:classic');
  rig.frame({ nowMs: 1016 });
  rig.stage.prefetch('zen'); // menu is shown, classic is fading in: no slot
  assert.equal(rig.assets.loadCount('stage:zen'), 0);
  rig.frame({ nowMs: 1500 });
  assert.equal(rig.stage.status().shown, 'classic');
  rig.stage.prefetch('zen'); // now there is a slot
  assert.equal(rig.assets.loadCount('stage:zen'), 1);
  await rig.assets.settle('stage:zen');
  rig.stage.setMode('zen'); // the prefetched stage is used at once: no second load, a crossfade starts
  assert.equal(rig.assets.loadCount('stage:zen'), 1);
  assert.equal(rig.stage.status().fading, true);
});

test('a prefetched stage gets no composite canvas until it is wanted (a prefetch may never be shown)', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'menu');
  const before = rig.factory.created.length;
  const builds = rig.stage.status().composites;
  rig.stage.prefetch('classic');
  await rig.assets.settle('stage:classic');
  assert.equal(rig.factory.created.length, before, 'no canvas for the prefetched stage');
  assert.equal(rig.stage.status().composites, builds);
  rig.frame({ mode: 'classic', nowMs: 9000, screen: 'countdown' });
  rig.frame({ nowMs: 9016, screen: 'countdown' });
  rig.frame({ nowMs: 9200, screen: 'countdown' });
  assert.equal(rig.stage.status().composites, builds + 1, 'built when its crossfade becomes visible');
});

test('a prefetched stage that was not needed stays resident (never released early) and a later setMode uses it without loading', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'menu');
  rig.stage.prefetch('classic');
  await rig.assets.settle('stage:classic');
  const before = rig.assets.log.loads.length;
  rig.frame({ mode: 'classic', nowMs: 2000 });
  assert.equal(rig.assets.log.loads.length, before, 'no new load');
  assert.equal(rig.stage.status().fading, true);
  assert.equal(rig.assets.log.releases.length, 0);
});

// ------------------------------------------------------------------------------------------------ failure and fallback

test('a failed group keeps the procedural background for that mode and is never retried', async () => {
  const rig = makeStageRig({ assets: { failGroups: ['stage:classic'] } });
  rig.stage.resize(1);
  rig.frame({ mode: 'classic', nowMs: 0 });
  await rig.assets.settle('stage:classic');
  for (let i = 0; i < 10; i++) {
    const f = rig.frame({ nowMs: 100 + i * 16 });
    assert.equal(f.fallback, true);
    assert.equal(f.drew, false);
  }
  assert.deepEqual(rig.stage.status().failed, ['classic']);
  assert.equal(rig.stage.status().shown, null);
  // leave and come back: still procedural, still one load
  rig.frame({ mode: 'arcade', nowMs: 1000 });
  await rig.assets.settle('stage:arcade');
  rig.frame({ mode: 'classic', nowMs: 2000 });
  assert.equal(rig.assets.loadCount('stage:classic'), 1, 'a failed stage is not retried');
});

test('a load that rejects, throws, or answers synchronously never breaks the stage', async () => {
  const base = { isNull: false, config: ART_CONFIG, generation: 0, get: () => null, on: () => () => {} };
  const rejecting = createStage({ assets: { ...base, load: () => Promise.reject(new Error('disk')) } });
  const throwing = createStage({ assets: { ...base, load: () => { throw new Error('boom'); } } });
  const failedSync = createStage({ assets: { ...base, load: () => ({ state: 'failed' }) } });
  const answersNothing = createStage({ assets: { ...base, load: () => undefined } });
  for (const stage of [rejecting, throwing, failedSync, answersNothing]) {
    stage.setMode('classic');
    stage.prefetch('arcade');
  }
  await new Promise((resolve) => setImmediate(resolve));
  for (const stage of [rejecting, throwing, failedSync]) {
    assert.equal(stage.needsFallback(), true);
    assert.deepEqual(stage.status().failed.includes('classic'), true);
  }
  assert.equal(answersNothing.needsFallback(), true, 'a loader that never answers leaves the procedural background alone');
  assert.deepEqual(answersNothing.status().loading, ['classic', 'arcade']);
});

test('a missing far layer: the stage is listed as failed, the procedural background stays under the layers that loaded, no crossfade', async () => {
  const rig = makeStageRig({ assets: { failIds: ['bg_classic_far'] } });
  rig.stage.resize(1);
  rig.frame({ mode: 'classic', nowMs: 0 });
  await rig.assets.settle('stage:classic');
  const f = rig.frame({ nowMs: 100 });
  assert.equal(f.fallback, true, 'the far layer is what covers the field');
  assert.equal(rig.stage.status().fading, false, 'a stage without a far layer is cut in, not faded');
  assert.equal(rig.stage.status().shown, 'classic');
  assert.deepEqual(rig.stage.status().failed, ['classic']);
  assert.equal(f.images.length, 1, 'the composite of mid and near');
  const compOps = rig.factory.created[0].ctx.ops.filter((o) => o.op === 'drawImage').map((o) => o.img.id);
  assert.deepEqual(compOps.filter(Boolean), ['bg_classic_mid', 'bg_classic_near']);
  assert.equal(rig.frame({ nowMs: 200 }).fallback, true, 'and it stays that way');
});

test('a missing far layer under shake draws the remaining layers separately', async () => {
  const rig = makeStageRig({ assets: { failIds: ['bg_arcade_far'] } });
  rig.stage.resize(1);
  rig.frame({ mode: 'arcade', nowMs: 0 });
  await rig.assets.settle('stage:arcade');
  rig.frame({ nowMs: 100 });
  const f = rig.frame({ nowMs: 200, shakeX: 12, shakeY: 4 });
  assert.deepEqual(f.images.filter((o) => o.img.isStub).map((o) => o.img.id), ['bg_arcade_mid', 'bg_arcade_near']);
});

test('a group where every layer failed is failed; a group that only lost mid or near still covers the field', async () => {
  const rig = makeStageRig({ assets: { failIds: ['bg_zen_mid'] } });
  rig.stage.resize(1);
  rig.frame({ mode: 'zen', nowMs: 0 });
  await rig.assets.settle('stage:zen');
  rig.frame({ nowMs: 10 });
  rig.frame({ nowMs: 500 });
  const f = rig.frame({ nowMs: 516 });
  assert.equal(rig.stage.status().shown, 'zen');
  assert.equal(f.fallback, false, 'far is there: no procedural background needed');
  assert.deepEqual(rig.stage.status().failed, [], 'losing the mid layer is not a stage failure');
  const rig2 = makeStageRig({ assets: { failIds: ['bg_zen_far', 'bg_zen_mid', 'bg_zen_near'] } });
  rig2.frame({ mode: 'zen', nowMs: 0 });
  await rig2.assets.settle('stage:zen');
  assert.deepEqual(rig2.stage.status().failed, ['zen']);
  assert.equal(rig2.stage.needsFallback(), true);
});

test('when the wanted stage fails while another is shown, the screen falls back to the procedural background', async () => {
  const rig = makeStageRig({ assets: { failGroups: ['stage:arcade'] } });
  rig.stage.resize(1);
  await showStage(rig, 'menu');
  rig.frame({ mode: 'arcade', nowMs: 5000 });
  await rig.assets.settle('stage:arcade');
  // the failure lands between two frames: the very next frame already asks for the procedural background, so it is never blank
  assert.equal(rig.stage.status().shown, null);
  assert.equal(rig.stage.needsFallback(), true);
  assert.deepEqual(rig.assets.log.releases, ['stage:menu']);
  const f = rig.frame({ nowMs: 5016 });
  assert.equal(f.fallback, true);
  assert.equal(f.drew, false);
  assert.deepEqual(rig.stage.status().failed, ['arcade']);
});

test('a stage released behind our back falls back at once, then reloads because it is still the wanted one', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'classic');
  rig.assets.release('stage:classic');
  assert.equal(rig.stage.status().shown, null);
  assert.equal(rig.stage.needsFallback(), true);
  assert.equal(rig.assets.loadCount('stage:classic'), 2, 'reload requested by the release event');
  await rig.assets.settle('stage:classic');
  rig.frame({ nowMs: 9000 });
  rig.frame({ nowMs: 9500 });
  rig.frame({ nowMs: 9501 });
  assert.equal(rig.stage.status().shown, 'classic');
});

test('images that vanish or change without an event are noticed through the generation counter', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'classic');
  const builds = rig.stage.status().composites;
  rig.assets.replaceImages('stage:classic'); // a reload we did not cause: new drawables
  const f = rig.frame({ nowMs: 5000 });
  assert.equal(rig.stage.status().composites, builds + 1, 'the composite was rebuilt from the new drawables');
  assert.equal(f.images.length, 1);
  const ids = rig.factory.created[0].ctx.ops.filter((o) => o.op === 'drawImage' && o.img.isStub);
  assert.ok(ids.length >= 3);

  rig.assets.dropImagesSilently('stage:classic'); // and now they are gone, with no release event
  const g = rig.frame({ nowMs: 5016 });
  assert.equal(rig.stage.status().shown, null, 'nothing left to show');
  assert.equal(g.drew, false);
  assert.equal(rig.stage.needsFallback(), true);
  assert.equal(rig.assets.loadCount('stage:classic'), 2, 'and it reloads');
});

test('the stage settles from the load promise alone (no events) and from the group event alone (a promise that never resolves)', async () => {
  const base = createStageStubAssets();
  const promiseOnly = Object.create(base, { on: { value: () => () => {} } });
  const a = makeStageRig({ assetsObject: promiseOnly });
  a.stage.resize(1);
  a.frame({ mode: 'classic', nowMs: 0 });
  await base.settle('stage:classic');
  await a.flush();
  assert.equal(a.stage.status().resident.includes('classic'), true, 'settled through the promise');

  const stub = createStageStubAssets();
  const eventsOnly = Object.create(stub, { load: { value: (group, o) => { stub.load(group, o); return new Promise(() => {}); } } });
  const b = makeStageRig({ assetsObject: eventsOnly });
  b.stage.resize(1);
  b.frame({ mode: 'zen', nowMs: 0 });
  await stub.settle('stage:zen');
  assert.equal(b.stage.status().resident.includes('zen'), true, 'settled through the group event');
});

test('the stage adopts a group that somebody else loaded (the boot code loads stage:menu on its own) and never loads it twice', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  rig.assets.load('stage:menu'); // the Integrator's background load, before the stage ever asked
  await rig.assets.settle('stage:menu');
  assert.deepEqual(rig.stage.status().resident, ['menu'], 'adopted from the group event, counted as resident');
  rig.frame({ mode: 'menu', nowMs: 0, screen: 'boot' });
  assert.equal(rig.stage.status().fading, true, 'no reload needed: the crossfade starts at the first draw');
  assert.equal(rig.assets.loadCount('stage:menu'), 1);
});

test('a loader whose get() throws is a loader without images', async () => {
  const stub = createStageStubAssets();
  const hostile = Object.create(stub, { get: { value: () => { throw new Error('boom'); } } });
  const rig = makeStageRig({ assetsObject: hostile });
  rig.stage.resize(1);
  rig.frame({ mode: 'classic', nowMs: 0 });
  await stub.settle('stage:classic');
  assert.deepEqual(rig.stage.status().failed, ['classic']);
  assert.equal(rig.stage.needsFallback(), true);
  assert.equal(rig.frame({ nowMs: 100 }).drew, false);
});

test('dispose unsubscribes, releases what is resident and turns every method into a no-op', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  await showStage(rig, 'classic');
  assert.equal(rig.assets.listenerCount('group'), 1);
  assert.equal(rig.assets.listenerCount('release'), 1);
  rig.stage.dispose();
  assert.equal(rig.assets.listenerCount('group'), 0);
  assert.equal(rig.assets.listenerCount('release'), 0);
  assert.deepEqual(rig.assets.log.releases, ['stage:classic']);
  assert.equal(rig.stage.needsFallback(), true);
  rig.ctx.reset();
  assert.equal(rig.stage.draw(rig.ctx, rig.view), false);
  rig.stage.setMode('zen');
  rig.stage.prefetch('arcade');
  assert.equal(rig.assets.loadCount('stage:zen'), 0);
  rig.stage.dispose();
});

test('a load that settles after dispose is ignored', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  rig.frame({ mode: 'classic', nowMs: 0 });
  rig.stage.dispose();
  await rig.assets.settle('stage:classic');
  assert.equal(rig.stage.status().shown, null);
  assert.equal(rig.stage.needsFallback(), true);
});

test('status() is plain data with the documented fields', async () => {
  const rig = makeStageRig();
  rig.stage.resize(2);
  rig.frame({ mode: 'zen', nowMs: 0 });
  const s0 = rig.stage.status();
  assert.deepEqual(Object.keys(s0).sort(), ['active', 'composites', 'compositeDensity', 'drawn', 'fadeAlpha', 'fading', 'failed', 'loading', 'mode', 'resident', 'shown'].sort());
  assert.equal(s0.mode, 'zen');
  assert.equal(s0.shown, null);
  assert.equal(s0.fading, false);
  assert.deepEqual(s0.resident, []);
  assert.deepEqual(s0.failed, []);
  assert.equal(s0.active, true);
  assert.equal(s0.compositeDensity, 1.28);
  assert.deepEqual(JSON.parse(JSON.stringify(s0)), s0, 'JSON safe');
});

// ------------------------------------------------------------------------------------------------ the stub itself and hygiene

test('the stub assets settle partial groups and emit group events before the promise resolves (contract 2.5)', async () => {
  const stub = createStageStubAssets({ failIds: ['bg_zen_near'] });
  const seen = [];
  stub.on('group', (e) => seen.push(`event:${e.state}`));
  const p = stub.load('stage:zen').then((r) => seen.push(`promise:${r.state}`));
  assert.equal(stub.get('bg_zen_far'), null, 'nothing before settle');
  await stub.settle('stage:zen');
  await p;
  assert.deepEqual(seen, ['event:partial', 'promise:partial']);
  assert.ok(stub.get('bg_zen_far'));
  assert.equal(stub.get('bg_zen_near'), null);
});

test('stage.js hygiene: no timers, no wall clock, no DOM, no network, no image decoding, no game imports, no shadowBlur or filter', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/stage.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  for (const banned of [/\bsetTimeout\b/, /\bsetInterval\b/, /\brequestAnimationFrame\b/, /\bDate\.now\b/, /\bperformance\b/, /\bMath\.random\b/, /\bwindow\b/, /\bdocument\b/, /\bnew Image\b/, /\bfetch\b/, /\bcreateImageBitmap\b/, /\blocalStorage\b/, /\bshadowBlur\b/, /\.filter\s*=/, /\bconsole\b/]) {
    assert.equal(banned.test(code), false, `stage.js must not use ${banned}`);
  }
  const imports = [...code.matchAll(/\bimport\s+[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['../shared/playfield.js', './art-config.js', './palette.js']);
  assert.equal(/assets\/|\.png|\.jpg/.test(code), false, 'no hard-coded asset path: layer ids only');
});
