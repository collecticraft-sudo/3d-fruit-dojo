// The stage extras of art review round 1 (docs/contract-notes.md "Art round 1 fixes"): erase rectangles (M1, the Arcade lanterns), the lift of the
// lower band (M2, the dark ridge, rooftops and rocks), the dim disc over the moon and the tint of the veil (M3). Stub images and the recording
// context; the pictures themselves are measured in stage-readability.test.js. Every extra is data in ART_CONFIG.stage, optional, and drawn the
// same way in the pre-composed canvas and in the layered path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ART_CONFIG } from '../../public/js/render/art-config.js';
import { RecordingContext, baseStageConfig, makeStageRig } from '../../test-support/stage/recorder.js';

const FADE = ART_CONFIG.stage.crossfadeMs;

/** Show `id` completely with the SHIPPED config (or `config`), density step 1. */
async function shown(id, { config = ART_CONFIG, screen = id === 'menu' ? 'menu' : 'playing', ...rigOpts } = {}) {
  const rig = makeStageRig({ config, ...rigOpts });
  rig.stage.resize(1);
  rig.frame({ mode: id, nowMs: 0, screen });
  await rig.assets.settle(`stage:${id}`);
  rig.frame({ nowMs: 10, screen });
  rig.frame({ nowMs: 10 + FADE + 1, screen });
  rig.frame({ nowMs: 10 + FADE + 2, screen });
  assert.equal(rig.stage.status().shown, id);
  return rig;
}

const canvasOf = (rig, w, h) => rig.factory.created.find((c) => c.width === w && c.height === h);
const isStubImage = (o) => o.img && o.img.isStub;

/** Record the colour stops of every gradient built while `fn` runs (RecordingContext gradients have none of their own). */
function withStopLog(fn) {
  const log = [];
  const lin = RecordingContext.prototype.createLinearGradient;
  const rad = RecordingContext.prototype.createRadialGradient;
  RecordingContext.prototype.createLinearGradient = function linear(...a) { const g = { kind: 'linear', args: a, stops: [], addColorStop(p, c) { g.stops.push([p, c]); } }; this.gradients++; log.push(g); return g; };
  RecordingContext.prototype.createRadialGradient = function radial(...a) { const g = { kind: 'radial', args: a, stops: [], addColorStop(p, c) { g.stops.push([p, c]); } }; this.gradients++; log.push(g); return g; };
  const restore = () => { RecordingContext.prototype.createLinearGradient = lin; RecordingContext.prototype.createRadialGradient = rad; };
  return fn(log).then((r) => { restore(); return r; }, (e) => { restore(); throw e; });
}

// ------------------------------------------------------------------------------------------------ the shipped data

test('config: the extras are data of ART_CONFIG.stage and sane (erase on the Arcade near layer only, lift on the three round stages, dim on the night stage)', () => {
  const S = ART_CONFIG.stage;
  assert.deepEqual(Object.keys(S.erase), ['arcade']);
  assert.deepEqual(Object.keys(S.erase.arcade), ['near']);
  assert.deepEqual(Object.keys(S.lift).sort(), ['arcade', 'classic', 'zen']);
  for (const [id, l] of Object.entries(S.lift)) {
    assert.ok(l.alpha > 0.1 && l.alpha <= 0.35, `${id}: a lift of ${l.alpha} is a 10 to 35 percent paper haze, not a wash`);
    assert.ok(l.from >= 500 && l.to > l.from && l.to <= 900, `${id}: the ramp ${l.from}..${l.to} sits in the lower third of the field`);
  }
  assert.deepEqual(Object.keys(S.dim), ['menu']);
  assert.equal(S.dim.menu.length, 1);
  assert.ok(Object.isFrozen(S.erase) && Object.isFrozen(S.lift) && Object.isFrozen(S.dim), 'frozen like the rest of the config');
  assert.ok(S.layerAlpha.arcade.near <= 0.8, 'the near alpha of Arcade was not raised');
});

// ------------------------------------------------------------------------------------------------ erase (M1)

test('erase, pre-composed canvas: the Arcade near layer is drawn inside a clip that leaves out the two lantern rectangles (even-odd), mapped to canvas pixels', async () => {
  const rig = await shown('arcade');
  const comp = rig.factory.created[0];
  assert.equal(comp.width, 2000, 'density 1 composite');
  const ops = comp.ctx.ops;
  const stubs = ops.map((o, i) => [o, i]).filter(([o]) => isStubImage(o));
  assert.equal(stubs.length, 3, 'far, mid, near');
  const clips = ops.filter((o) => o.op === 'clip');
  assert.equal(clips.length, 1, 'only the near layer is clipped');
  assert.equal(clips[0].rule, 'evenodd');
  // the rectangles are logical field px, the canvas starts at (-40, -22.5) and is 1:1 at density 1
  assert.deepEqual(clips[0].rects, [[0, 0, 2000, 1125], [77, -7.5, 363, 470], [1580, -7.5, 344, 470]]);
  const clipAt = ops.indexOf(clips[0]);
  assert.ok(stubs[2][1] > clipAt && stubs[0][1] < clipAt && stubs[1][1] < clipAt, 'the clip is set right before the near layer and only applies to it');
  assert.equal(comp.ctx.depth, 0, 'save and restore balanced');
});

test('erase, layered path: the same clip in field px (inside the near layer frame), set before its drawImage; far and mid are not clipped', async () => {
  const rig = await shown('arcade');
  rig.frame({ nowMs: 20000, shakeX: 8, shakeY: -4 });
  const ops = rig.ctx.ops;
  const clips = ops.filter((o) => o.op === 'clip');
  assert.equal(clips.length, 1);
  assert.equal(clips[0].rule, 'evenodd');
  assert.deepEqual(clips[0].rects, [[-40, -22.5, 2000, 1125], [37, -30, 363, 470], [1540, -30, 344, 470]]);
  const images = ops.filter((o) => o.op === 'drawImage');
  const nearImage = images.filter(isStubImage)[2];
  assert.ok(ops.indexOf(clips[0]) < ops.indexOf(nearImage), 'before the near layer');
  assert.ok(ops.indexOf(clips[0]) > ops.indexOf(images.filter(isStubImage)[1]), 'after the mid layer');
  assert.equal(rig.ctx.depth, 0);
  assert.equal(rig.ctx.underflows, 0);
});

test('erase is per stage and per layer: Classic, Zen and the night stage are not clipped at all', async () => {
  for (const id of ['classic', 'zen', 'menu']) {
    const rig = await shown(id);
    rig.frame({ nowMs: 20000, shakeX: 8 });
    assert.equal(rig.ctx.ops.filter((o) => o.op === 'clip').length, 0, id);
    assert.equal(rig.factory.created.flatMap((c) => c.ctx.ops).filter((o) => o.op === 'clip').length, 0, `${id}: nor in the composite`);
  }
});

test('erase follows the config: a rebuilt composite when the rectangles change, none when a config has no erase key', async () => {
  const cfg = baseStageConfig();
  cfg.stage.erase = { arcade: { near: [[100, 0, 200, 100]] } };
  const rig = await shown('arcade', { config: cfg });
  assert.equal(rig.stage.status().composites, 1);
  assert.deepEqual(rig.factory.created[0].ctx.ops.filter((o) => o.op === 'clip')[0].rects.at(-1), [140, 22.5, 100, 100]);
  cfg.stage.erase = { arcade: { near: [[300, 0, 400, 100]] } };
  rig.frame({ nowMs: 30000 });
  assert.equal(rig.stage.status().composites, 2, 'new rectangles, new composite');
  rig.frame({ nowMs: 30016 });
  assert.equal(rig.stage.status().composites, 2, 'and only once');
  const bare = baseStageConfig();
  delete bare.stage.erase;
  const rig2 = await shown('arcade', { config: bare });
  assert.equal(rig2.factory.created.flatMap((c) => c.ctx.ops).filter((o) => o.op === 'clip').length, 1, 'a config without the key uses the shipped default (ART_CONFIG)');
  const off = baseStageConfig();
  off.stage.erase = {};
  const rig3 = await shown('arcade', { config: off });
  assert.equal(rig3.factory.created.flatMap((c) => c.ctx.ops).filter((o) => o.op === 'clip').length, 0, 'an empty table switches it off');
});

// ------------------------------------------------------------------------------------------------ lift (M2)

test('lift, pre-composed canvas: one paper haze sprite drawn between the mid and the near layer, from the lift line to the bottom of the backdrop', async () => {
  for (const id of ['classic', 'arcade', 'zen']) {
    const rig = await shown(id);
    const comp = rig.factory.created[0];
    const images = comp.ctx.ops.filter((o) => o.op === 'drawImage');
    const order = images.map((o) => (isStubImage(o) ? 'layer' : o.img.width === 4 ? 'lift' : 'calm'));
    assert.deepEqual(order, ['layer', 'layer', 'lift', 'layer', 'calm'], `${id}: far, mid, lift, near, calm`);
    const lift = images[2];
    const l = ART_CONFIG.stage.lift[id];
    assert.deepEqual(lift.args, [0, l.from + 22.5, 2000, 1102.5 - l.from], `${id}: from the lift line (canvas px) to the bottom`);
    assert.equal(lift.alpha, 1, 'the strength is in the sprite, not in globalAlpha');
  }
});

test('lift, layered path: the same sprite in the frame of the mid layer, between mid and near; the quiet frame is still one drawImage', async () => {
  const rig = await shown('classic');
  const quiet = rig.frame({ nowMs: 20000 });
  assert.equal(quiet.images.length, 1, 'fast path: the lift is baked into the composite');
  const f = rig.frame({ nowMs: 20016, shakeX: 12, shakeY: 0 });
  const order = f.images.map((o) => (isStubImage(o) ? 'layer' : o.img.width === 4 ? 'lift' : 'calm'));
  assert.deepEqual(order, ['layer', 'layer', 'lift', 'layer', 'calm']);
  const lift = f.images[2];
  assert.deepEqual(lift.args, [-40, ART_CONFIG.stage.lift.classic.from, 2000, 1102.5 - ART_CONFIG.stage.lift.classic.from]);
  // the mid layer follows the gameplay by 55 percent: its frame is shifted by 12 x 0.55 = 6.6 px, and so is the lift
  assert.ok(Math.abs(lift.m[4] - f.images[1].m[4]) < 1e-9, 'same frame of reference as the mid layer');
  assert.equal(rig.ctx.depth, 0);
});

test('lift sprite: a thin canvas whose alpha ramps from 0 at the lift line to the configured strength at `to` and stays there; built once per stage', async () => {
  await withStopLog(async (log) => {
    const rig = await shown('arcade');
    const l = ART_CONFIG.stage.lift.arcade;
    const grad = log.find((g) => g.kind === 'linear' && g.args[3] === 256);
    assert.ok(grad, 'a vertical gradient was built for the lift');
    const at = (l.to - l.from) / (1102.5 - l.from);
    assert.equal(grad.stops.length, 3);
    assert.deepEqual(grad.stops[0], [0, 'rgba(234,223,200,0)']);
    assert.ok(Math.abs(grad.stops[1][0] - at) < 1e-9 && grad.stops[1][1] === `rgba(234,223,200,${l.alpha})`, 'full strength at `to`');
    assert.deepEqual(grad.stops[2], [1, `rgba(234,223,200,${l.alpha})`]);
    const made = rig.factory.created.length;
    for (let i = 0; i < 30; i++) rig.frame({ nowMs: 40000 + i * 16, shakeX: i % 2 ? 6 : 0 });
    assert.equal(rig.factory.created.length, made, 'no canvas is created after the first frames');
    assert.equal(log.filter((g) => g.kind === 'linear' && g.args[3] === 256).length, 1, 'and no gradient');
  });
});

test('lift is strongest where the stage is darkest: Arcade (navy rooftops) more than Classic and Zen', () => {
  const L = ART_CONFIG.stage.lift;
  assert.ok(L.arcade.alpha > L.classic.alpha && L.arcade.alpha > L.zen.alpha);
});

test('lift follows the config: a new lift object rebuilds the composite, an empty table switches it off, a missing canvas factory skips it without an error', async () => {
  const cfg = baseStageConfig();
  cfg.stage.lift = { classic: { alpha: 0.2, from: 640, to: 780 } };
  const rig = await shown('classic', { config: cfg });
  assert.equal(rig.stage.status().composites, 1);
  cfg.stage.lift = { classic: { alpha: 0.25, from: 640, to: 780 } };
  rig.frame({ nowMs: 30000 });
  assert.equal(rig.stage.status().composites, 2);
  cfg.stage.lift = { classic: { alpha: 0, from: 640, to: 780 } };
  rig.frame({ nowMs: 30016 });
  const all = rig.factory.created[0].ctx.ops;
  const lastBuild = all.slice(all.map((o) => o.op).lastIndexOf('clearRect')); // the composite is cleared at the start of every build
  assert.equal(lastBuild.filter((o) => o.op === 'drawImage').some((o) => o.img.width === 4), false, 'alpha 0 draws nothing');
  assert.equal(rig.stage.status().composites, 3, 'and that was a rebuild too');
  const bare = await shown('classic', { noCanvas: true });
  const f = bare.frame({ nowMs: 20000, shakeX: 5 });
  assert.equal(f.images.length, 3, 'without a canvas factory there is no haze sprite, no lift, and the three layers still draw');
});

// ------------------------------------------------------------------------------------------------ dim disc (M3)

test('dim, night stage: a soft disc of the night colour over the far layer, at the moon, drawn before the mid layer', async () => {
  await withStopLog(async (log) => {
    const rig = await shown('menu');
    const f = rig.frame({ nowMs: 500, screen: 'menu' });
    const order = f.images.map((o) => (isStubImage(o) ? 'layer' : o.img.width === 128 ? 'dim' : 'other'));
    assert.deepEqual(order, ['layer', 'dim', 'layer', 'layer'], 'far, dim, mid, near (then the veil fill)');
    const d = ART_CONFIG.stage.dim.menu[0];
    const reach = d.r * 1.25;
    assert.deepEqual(f.images[1].args, [d.x - reach, d.y - reach, 2 * reach, 2 * reach]);
    assert.equal(f.fills.length, 1, 'and the veil after everything');
    const radial = log.find((g) => g.kind === 'radial');
    assert.ok(radial, 'a radial gradient for the disc');
    assert.deepEqual(radial.stops, [[0, 'rgba(31,58,95,0.4)'], [0.8, 'rgba(31,58,95,0.4)'], [1, 'rgba(31,58,95,0)']]);
    assert.equal(log.filter((g) => g.kind === 'radial').length, 1, 'built once');
  });
});

test('dim sits in the frame of the far layer (25 percent of the shake) and is not drawn on the round stages', async () => {
  const rig = await shown('menu');
  const still = rig.frame({ nowMs: 500, screen: 'menu' });
  const far = still.images[0];
  const dim = still.images[1];
  assert.ok(Math.abs(far.m[4] - dim.m[4]) < 1e-9 && Math.abs(far.m[5] - dim.m[5]) < 1e-9, 'same frame of reference as the far layer');
  for (const id of ['classic', 'arcade', 'zen']) {
    const r = await shown(id);
    const f = r.frame({ nowMs: 20000, shakeX: 6 });
    assert.equal(f.images.some((o) => o.img.width === 128), false, id);
  }
});

test('dim and Reduce motion: the composite of the night stage holds the disc too (static backdrop, same picture)', async () => {
  const rig = await shown('menu');
  rig.frame({ nowMs: 600, screen: 'menu', reduceMotion: true });
  const comp = rig.factory.created.find((c) => c.width === 2000 && c.height === 1125);
  assert.ok(comp, 'a composite was built for Reduce motion');
  const order = comp.ctx.ops.filter((o) => o.op === 'drawImage').map((o) => (isStubImage(o) ? 'layer' : o.img.width === 128 ? 'dim' : 'other'));
  assert.deepEqual(order, ['layer', 'dim', 'layer', 'layer']);
  const d = ART_CONFIG.stage.dim.menu[0];
  const reach = d.r * 1.25;
  assert.deepEqual(comp.ctx.ops.filter((o) => o.op === 'drawImage')[1].args, [d.x - reach + 40, d.y - reach + 22.5, 2 * reach, 2 * reach], 'in canvas pixels');
});

// ------------------------------------------------------------------------------------------------ robustness

test('every extra at once, over 300 frames of shake, zoom and drift: balanced save and restore, no forbidden property, nothing allocated after warm-up', async () => {
  for (const id of ['classic', 'arcade', 'zen', 'menu']) {
    const rig = await shown(id);
    for (let i = 0; i < 20; i++) rig.frame({ nowMs: 50000 + i * 16, shakeX: i % 3, zoom: 1 + (i % 2) * 0.03 });
    const made = rig.factory.created.length;
    for (let i = 0; i < 300; i++) {
      rig.frame({ nowMs: 60000 + i * 16, shakeX: (i % 7) - 3, shakeY: (i % 5) - 2, zoom: i % 11 === 0 ? 1.03 : 1, reduceMotion: i % 50 === 49 });
      assert.equal(rig.ctx.depth, 0, `${id} frame ${i}`);
      assert.equal(rig.ctx.underflows, 0);
    }
    assert.equal(rig.factory.created.length, made, `${id}: no canvas after warm-up`);
    assert.deepEqual(rig.ctx.forbidden, [], `${id}: no shadowBlur or filter`);
    assert.equal(rig.stage.status().failed.length, 0, `${id}: the stage never marked itself broken`);
  }
});

test('a clip that throws is caught like a broken image: the stage falls back to the painted background instead of breaking the frame', async () => {
  const rig = await shown('arcade');
  rig.ctx.clip = () => { throw new Error('clip failed'); };
  const f = rig.frame({ nowMs: 20000, shakeX: 6 });
  assert.equal(f.drew, false, 'nothing drawn');
  assert.equal(rig.ctx.depth, 0, 'and the state stack is balanced');
  assert.deepEqual(rig.stage.status().failed, ['arcade']);
});
