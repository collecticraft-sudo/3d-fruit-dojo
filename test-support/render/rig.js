// A renderer rig for the tests: fake canvas + real sprites/fx/trail/renderer. OWNER: Presentation engineer (art options: Gameplay-renderer engineer).
import { createFx } from '../../public/js/render/fx.js';
import { createRenderer } from '../../public/js/render/renderer.js';
import { createSprites } from '../../public/js/render/sprites.js';
import { createTrail } from '../../public/js/render/trail.js';
import { FakeCanvas, createFakeCanvasFactory } from './fake-canvas.js';

/**
 * @param {{cssW?:number, cssH?:number, dpr?:number, assets?:object, stage?:object, density?:number}} [opts]
 *   assets: an Assets object (test-support/render/art-stub.js) given to sprites, fx, trail and renderer; stage: a Stage given to the renderer.
 */
export function makeRenderRig({ cssW = 1920, cssH = 1080, dpr = 1, assets, stage, density = 2 } = {}) {
  const canvas = new FakeCanvas(cssW, cssH);
  const factory = createFakeCanvasFactory();
  const sprites = createSprites({ createCanvas: factory.createCanvas, density, assets });
  const fx = createFx({ assets });
  fx.reset(1);
  fx.setSettings({ reduceFlash: false, reduceMotion: false });
  const trail = createTrail({ assets });
  const renderer = createRenderer({ canvas, ctx: canvas.ctx, sprites, fx, trail, assets, stage });
  renderer.resize(cssW, cssH, dpr);
  const ctx = canvas.ctx;
  return {
    canvas, ctx, sprites, fx, trail, renderer, factory, assets, stage,
    /** Draw one frame and return the recorded calls of this frame only. */
    draw(frame) {
      ctx.reset();
      ctx.forbidden.length = 0;
      renderer.draw({ perf: { fps: 60, avgFrameMs: 16.6, degradeLevel: 0 }, debug: false, dtS: 1 / 60, ...frame });
      return ctx.calls;
    },
    indexOfImage(canvasObj, from = 0) {
      return ctx.calls.findIndex((c, i) => i >= from && c[0] === 'drawImage' && c[1] === canvasObj);
    },
    indexOfText(text, from = 0) {
      const t = ctx.texts.find((x) => x.text === text && x.index >= from);
      return t ? t.index : -1;
    },
  };
}
