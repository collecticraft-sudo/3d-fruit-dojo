// The procedural fallback of the UI kit is unchanged (docs/assets-integration.md 0.1, 8.5): with no art, the null assets, an assets object with
// none of the ids, no metadata, or a hostile one that throws, every screen, overlay, HUD and widget draws exactly what it drew before the art
// work, call by call and assignment by assignment. The reference digests (test-support/ui/procedural-digests.json) were recorded from the
// code BEFORE the art integration touched widgets.js, hud.js, layout-data.js and screens/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NULL_ASSETS } from '../../public/js/render/assets.js';
import { SCENES, WIDGET_SCENES, digestCalls, makeSpriteStub, runScene, runWidget, stableCalls } from '../../test-support/ui/art-scenes.js';
import { createArtStub } from '../../test-support/ui/art-stub.js';

const GOLDEN = JSON.parse(readFileSync(new URL('../../test-support/ui/procedural-digests.json', import.meta.url), 'utf8'));

/** An assets object whose every member throws: a loader bug must never crash a frame or change what is drawn. */
function hostileAssets() {
  const boom = () => { throw new Error('assets exploded'); };
  return { isNull: false, generation: 1, config: {}, has: boom, get: boom, meta: boom, scaled: boom, sliced: boom, status: boom, on: boom, ids: boom, load: boom };
}

const VARIANTS = {
  'no g.assets at all (the renderer before the art work)': () => undefined,
  'NULL_ASSETS': () => NULL_ASSETS,
  'assets with no usable image': () => createArtStub({ only: [] }),
  'assets with images but no metadata': () => createArtStub({ noMeta: createArtStub().ids() }),
  'assets that throw': hostileAssets,
};

test('the recorded digests cover every scene and every widget', () => {
  assert.deepEqual(Object.keys(GOLDEN.scenes).sort(), Object.keys(SCENES).sort());
  assert.deepEqual(Object.keys(GOLDEN.widgets).sort(), Object.keys(WIDGET_SCENES).sort());
});

for (const [label, make] of Object.entries(VARIANTS)) {
  test(`fallback: every screen, overlay and the HUD draws exactly what it drew before the art work: ${label}`, () => {
    for (const name of Object.keys(SCENES)) {
      const r = runScene(name, { assets: make(), sprites: makeSpriteStub() });
      assert.equal(stableCalls(r.calls).length, GOLDEN.scenes[name].calls, `${name}: number of calls`);
      assert.equal(digestCalls(r.calls), GOLDEN.scenes[name].digest, `${name}: digest of the calls and assignments`);
      assert.equal(r.ctx.forbidden.length, 0, `${name}: no shadowBlur or filter`);
    }
  });

  test(`fallback: every widget draws exactly what it drew before the art work: ${label}`, () => {
    for (const name of Object.keys(WIDGET_SCENES)) {
      const assets = make();
      const r = runWidget(name, assets === undefined ? {} : { assets, density: 2, pressed: false });
      assert.equal(digestCalls(r.calls), GOLDEN.widgets[name].digest, name);
    }
  });
}

test('fallback: art for nothing else changes the procedural screens either (an art halves method that returns null keeps paintHalf)', () => {
  for (const name of ['countdown', 'tuning']) {
    const r = runScene(name, { assets: NULL_ASSETS, sprites: makeSpriteStub({ withHalves: true, halfArt: false }) });
    assert.equal(digestCalls(r.calls), GOLDEN.scenes[name].digest, `${name}: menuHalf returned null: the procedural halves`);
  }
});

test('fallback per widget: one missing image turns only that widget procedural, everything else keeps its art', () => {
  const labelCalls = (calls) => calls.filter((c) => c[0] === 'fillText' && c[1] === "Got it, let's go");
  const assets = createArtStub({ missing: ['button_primary_focused'] });
  const r = runScene('safety-ready', { assets }); // the hovered primary button wants the focused image
  const arts = r.calls.filter((c) => c[0] === 'drawImage' && c[1].artId).map((c) => c[1].artId);
  assert.deepEqual(arts, ['panel_9slice'], 'the panel keeps its art, the focused button is drawn procedurally');
  assert.equal(labelCalls(r.calls)[0].length, 4, 'and its label comes from drawText (no maxWidth argument)');
  const same = runScene('safety-ready', { assets: createArtStub({ missing: ['panel_9slice'] }) });
  const arts2 = same.calls.filter((c) => c[0] === 'drawImage' && c[1].artId).map((c) => c[1].artId);
  assert.deepEqual(arts2, ['button_primary_focused'], 'the reverse: the panel is procedural, the button keeps its art');
  assert.equal(labelCalls(same.calls)[0].length, 5, 'and the art label carries the maxWidth of its plate');
});

test('fallback: an image that becomes available later replaces the procedural drawing at the next frame (generation change), never a blank one', () => {
  const assets = createArtStub({ missing: ['panel_9slice', 'button_primary_disabled', 'button_primary_default', 'button_primary_focused'] });
  const first = runScene('safety-wait', { assets });
  assert.equal(first.calls.filter((c) => c[0] === 'drawImage' && c[1].artId).length, 0, 'nothing loaded: procedural');
  assert.ok(first.calls.length > 200, 'and the screen is not empty');
  assets.setMissing(['panel_9slice', 'button_primary_disabled'], false);
  const second = runScene('safety-wait', { assets });
  assert.deepEqual(second.calls.filter((c) => c[0] === 'drawImage' && c[1].artId).map((c) => c[1].artId), ['panel_9slice', 'button_primary_disabled']);
  assets.setMissing(['panel_9slice'], true);
  const third = runScene('safety-wait', { assets });
  assert.deepEqual(third.calls.filter((c) => c[0] === 'drawImage' && c[1].artId).map((c) => c[1].artId), ['button_primary_disabled'], 'released again: back to the procedural panel');
});
