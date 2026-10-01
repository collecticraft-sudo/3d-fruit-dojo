// THE PROCEDURAL FALLBACK IS UNCHANGED (docs/assets-integration.md 0 and 8.3): with no art, NULL_ASSETS, or every art id missing, the
// game layer, the trail and the cursor make the same calls on the 2D context, call by call, as before the art integration.
//
// The reference digests below were recorded from the code BEFORE the art work (busy round: every object kind, halves, stains, banners,
// particles, rings, slash marks, a bomb; see test-support/render/scenes.js). They cover the random stream too: every particle
// position is in the calls, so a single extra random draw would change them. If a painter or the renderer is changed ON PURPOSE,
// re-record them (and say so in docs/contract-notes.md); an art change must never need it.
// RE-RECORDED on purpose by the restyle effects round (docs/restyle-direction.md section 2: new particles, plates, rings, camera, blade layers,
// the HUD's pips and badge): busy1 to busy3, plain, trailCut and trailIdle. The four cursor digests are unchanged (the cursor was not restyled).
// RE-RECORDED again by the final integration (busy1 to busy3 only): the power-up banner is drawn on the tier 2 plate stretched to 214 px with the title and
// the subtitle moved, because the gold underline of the tier 3 plate struck through the subtitle (docs/qa/final/freeze-active.jpg). Call counts are unchanged.
// RE-RECORDED again by the final fixer (busy1 only, same call count): the tier 4 combo banner fades its plate and words in together instead of clipping the plate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NULL_ASSETS } from '../../public/js/render/assets.js';
import { createTrail } from '../../public/js/render/trail.js';
import { FakeContext } from '../../test-support/render/fake-canvas.js';
import { createArtStub } from '../../test-support/render/art-stub.js';
import { busyScene, digestCalls, gameLayerCalls, plainScene } from '../../test-support/render/scenes.js';
import { bladeSample, makeBlade } from '../../test-support/ui/fixtures.js';

const REFERENCE = Object.freeze({
  busy1: 'c083c97441b62c5b', busy1Len: 1299,
  busy2: '34a81bffc219eff9', busy2Len: 1390,
  busy3: 'a29380f80c5cafad', busy3Len: 848,
  plain: '25b163efeb7dd1fa', plainLen: 70,
  trailCut: '67b1558293f0754e',
  trailIdle: '59e4fb79639b7486',
  cursorIdle: '0904b1c342229836',
  cursorPulse: '1cb8ae2f5f4ad997',
  cursorCut: 'a22bf7d1b5dd7d0e',
  cursorLost: '0cab1cd9707f4b97',
});

const NO_ART = {
  'no assets option': () => ({}),
  'assets: null': () => ({ assets: null }),
  'NULL_ASSETS': () => ({ assets: NULL_ASSETS }),
  'a loader with every id missing': () => ({ assets: createArtStub({ ids: [] }) }),
};

function busyDigests(rigOpts) {
  const { rig, snap, frame } = busyScene(rigOpts);
  const out = {};
  const c1 = gameLayerCalls(rig.draw(frame()));
  out.busy1 = digestCalls(c1); out.busy1Len = c1.length;
  for (let i = 0; i < 6; i++) rig.fx.update(0.04, 0.04, snap);
  const c2 = gameLayerCalls(rig.draw(frame()));
  out.busy2 = digestCalls(c2); out.busy2Len = c2.length;
  for (let i = 0; i < 12; i++) rig.fx.update(0.05, 0.05, snap);
  const c3 = gameLayerCalls(rig.draw(frame()));
  out.busy3 = digestCalls(c3); out.busy3Len = c3.length;
  return out;
}

function trailDigests(assets) {
  const trail = createTrail(assets === undefined ? {} : { assets });
  const ctx = new FakeContext({ width: 1920, height: 1080 });
  const samples = [];
  for (let i = 0; i < 30; i++) samples.push(bladeSample({ t: 1000 - (29 - i) * 4, x: 300 + i * 9, y: 500 + i * 2, cutting: true, speed: 2500 }));
  const out = {};
  trail.update(makeBlade({ samples, cutting: true, speed: 2500, head: { x: 580, y: 560 } }), 1000);
  trail.draw(ctx, 2);
  out.trailCut = digestCalls(ctx.calls);
  ctx.reset();
  trail.update(makeBlade({ samples, cutting: false, speed: 100, head: null }), 1000);
  trail.draw(ctx, 2);
  out.trailIdle = digestCalls(ctx.calls);
  const cur = (view, extra) => { ctx.reset(); trail.updateCursor(view, 0.016, extra); trail.drawCursor(ctx, 2); return digestCalls(ctx.calls); };
  out.cursorIdle = cur(makeBlade(), { pulse: 1 });
  out.cursorPulse = cur(makeBlade(), { pulse: 0.7, dwell: 0.4 });
  out.cursorCut = cur(makeBlade({ cutting: true }), {});
  out.cursorLost = cur(makeBlade({ trackingOk: false }), {});
  return out;
}

for (const [name, opts] of Object.entries(NO_ART)) {
  test(`FALLBACK (${name}): the game layer of a busy round makes the recorded calls, frame after frame`, () => {
    const got = busyDigests(opts());
    for (const k of ['busy1', 'busy1Len', 'busy2', 'busy2Len', 'busy3', 'busy3Len']) assert.equal(got[k], REFERENCE[k], k);
  });

  test(`FALLBACK (${name}): a calm arcade frame makes the recorded calls`, () => {
    const { rig, frame } = plainScene(opts());
    const calls = gameLayerCalls(rig.draw(frame()));
    assert.equal(digestCalls(calls), REFERENCE.plain);
    assert.equal(calls.length, REFERENCE.plainLen);
  });

  test(`FALLBACK (${name}): the blade trail and every cursor state make the recorded calls`, () => {
    const got = trailDigests(opts().assets);
    for (const k of ['trailCut', 'trailIdle', 'cursorIdle', 'cursorPulse', 'cursorCut', 'cursorLost']) assert.equal(got[k], REFERENCE[k], k);
  });
}

test('with art the same round does change (the digest test is not vacuous) and still draws every object kind', () => {
  const { rig, frame } = busyScene({ assets: createArtStub() });
  const calls = gameLayerCalls(rig.draw(frame()));
  assert.notEqual(digestCalls(calls), REFERENCE.busy1);
  assert.equal(rig.ctx.stack.length, 0);
});

test('a missing stage is the same as no stage: the painted background is drawn', () => {
  for (const stage of [undefined, null]) {
    const { rig, frame } = plainScene({ stage });
    const calls = gameLayerCalls(rig.draw(frame()));
    assert.equal(digestCalls(calls), REFERENCE.plain);
  }
});
