// Deterministic gameplay scenes and call digests for the renderer tests. OWNER: Gameplay-renderer engineer.
//
// The digest of the calls a scene makes on the fake 2D context is the "golden" that proves the procedural fallback is unchanged:
// with no art (or every art id missing) the game layer must produce the same call sequence, call by call, as it did before the art
// integration. The reference hashes in test/render/art-fallback.test.js were recorded from the code BEFORE the art work.
import { createHash } from 'node:crypto';
import { bombEvent, cutEvent, makeBlade, makeHalf, makeObject, makeSnapshot, makeUiHarness, powerupEvent } from '../ui/fixtures.js';
import { makeRenderRig } from './rig.js';

/** Stable text form of one recorded call: fake canvases become "C<w>x<h>", numbers are rounded to 1e-6. */
function stable(arg) {
  if (arg && arg.isFakeCanvas) return `C${arg.width}x${arg.height}`;
  if (typeof arg === 'number') return Math.round(arg * 1e6) / 1e6;
  if (arg && typeof arg === 'object') return '[object]';
  return arg;
}

/** sha256 (hex, first 16 chars) of a list of recorded calls. */
export function digestCalls(calls) {
  const h = createHash('sha256');
  for (const c of calls) h.update(JSON.stringify(c.map(stable)));
  return h.digest('hex').slice(0, 16);
}

/**
 * The calls of the game layer only (from the first save of the frame to the restore that closes it). The blade trail, the HUD,
 * the screens and the cursor come after it and belong to other owners.
 */
export function gameLayerCalls(calls) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < calls.length; i++) {
    const name = calls[i][0];
    if (name === 'save') {
      if (depth === 0 && start < 0) start = i;
      depth++;
    } else if (name === 'restore') {
      depth--;
      if (depth === 0 && start >= 0) return calls.slice(start, i + 1);
    }
  }
  return calls.slice(start < 0 ? 0 : start);
}

const OBJECTS = () => [
  makeObject({ id: 1, type: 'watermelon', x: 400, y: 600, px: 396, py: 610 }),
  makeObject({ id: 2, type: 'cherry', x: 700, y: 420, px: 704, py: 430 }),
  makeObject({ id: 3, kind: 'bomb', x: 1000, y: 500, px: 998, py: 505 }),
  makeObject({ id: 4, kind: 'golden', type: 'golden', x: 1250, y: 380, px: 1246, py: 390 }),
  makeObject({ id: 5, kind: 'powerup', type: 'freeze', x: 1500, y: 600, px: 1500, py: 610 }),
  makeObject({ id: 6, kind: 'powerup', type: 'frenzy', x: 300, y: 300, px: 300, py: 305 }),
  makeObject({ id: 7, kind: 'powerup', type: 'double', x: 800, y: 800, px: 800, py: 805 }),
  makeObject({ id: 8, kind: 'powerup', type: 'clock', x: 1600, y: 300, px: 1600, py: 305 }),
  makeObject({ id: 9, type: 'pineapple', x: 1100, y: 800, px: 1100, py: 806 }),
];

/**
 * A busy round: every object kind, two halves, a cut, a bomb hit, a combo banner and a power-up banner, all with a seeded fx.
 * @param {object} [rigOpts] forwarded to makeRenderRig ({assets, stage, cssW, cssH, dpr})
 */
export function busyScene(rigOpts = {}) {
  const rig = makeRenderRig(rigOpts);
  const h = makeUiHarness();
  h.toPlaying('classic');
  const halfA = makeHalf({ id: 1000001, parentType: 'apple', side: 1, x: 600, y: 700, px: 596, py: 706, rot: 0.9, prot: 0.85 });
  const halfB = makeHalf({ id: 1000002, parentType: 'apple', side: -1, x: 660, y: 720, px: 656, py: 726, rot: 0.9, prot: 0.85 });
  const snap = makeSnapshot({
    objects: OBJECTS(), halves: [halfA, halfB], alpha: 0.5, timeScale: 0.6,
    telegraphs: [{ x: 500, remainingMs: 200 }],
    powerups: [{ id: 'freeze', remainingS: 3, durationS: 5 }, { id: 'double', remainingS: 4, durationS: 10 }],
  });
  const cut = cutEvent({ halfIds: [1000001, 1000002], objType: 'apple', x: 640, y: 700, r: 68, angleRad: 0.4, nx: -Math.sin(0.4), ny: Math.cos(0.4) });
  rig.sprites.registerCut(cut, 0.6);
  rig.fx.handleEvent(cut);
  rig.fx.handleEvent(cutEvent({ halfIds: [], objType: 'orange', x: 900, y: 300, r: 68, angleRad: 1.2, nx: -Math.sin(1.2), ny: Math.cos(1.2) }));
  rig.fx.handleEvent({ seq: 50, t: 1, type: 'combo', phase: 'update', n: 4, swingId: 1, bonus: 0, x: 900, y: 480 });
  rig.fx.handleEvent(powerupEvent({ powerupId: 'frenzy', x: 300, y: 300 }));
  rig.fx.handleEvent(bombEvent({ x: 1000, y: 500 }));
  rig.fx.update(0.05, 0.05, snap);
  rig.fx.update(0.03, 0.03, snap);
  rig.sprites.beginHalfFrame();
  rig.sprites.ensureHalf(halfA);
  rig.sprites.ensureHalf(halfB);
  rig.trail.updateCursor(makeBlade(), 0.016);
  const frame = () => ({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
  return { rig, h, snap, frame, halves: [halfA, halfB] };
}

/** A calm frame: a few objects, no fx at all. */
export function plainScene(rigOpts = {}) {
  const rig = makeRenderRig(rigOpts);
  const h = makeUiHarness();
  h.toPlaying('arcade');
  const snap = makeSnapshot({ mode: 'arcade', lives: null, timeLeft: 42, timeTotal: 60, objects: OBJECTS().slice(0, 4), alpha: 0.25 });
  rig.trail.updateCursor(makeBlade(), 0.016);
  const frame = () => ({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 2000 });
  return { rig, h, snap, frame };
}
