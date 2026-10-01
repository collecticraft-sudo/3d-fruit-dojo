// Measures the VISIBLE body of the whole-fruit sprites, in game pixels around the object centre. Test support for test/game/hitbox.test.js.
//
// Same recipe as the body table of docs/assets-integration.md 1.5 (alpha at least 200, morphological opening with a disc of radius 40 px so
// that crowns, stems, leaves and the fuse drop out; the golden apple uses its dark outline filled in, so its glow ring does not count) and
// the same scale rule as public/js/render/sprites.js (the sprite is drawn at `r / body.r`, the pivot (`anchor`) sits on the object centre).
// READS the manifest and the PNGs only; returns null when the assets are not there, so that a checkout without art skips the tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../../tools/lib/png.mjs';
import { alphaMask, openDisc, makeMask, fillEnclosed, largestComponent, squaredDistanceTo } from '../../tools/lib/measure.mjs';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
const OPENING_PX = 40;

let manifestCache;
function manifest() {
  if (manifestCache === undefined) {
    try {
      manifestCache = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));
    } catch {
      manifestCache = null;
    }
  }
  return manifestCache;
}

/**
 * @param {string} assetId  e.g. 'fruit_apple_whole'
 * @param {number} r        the game radius of the object (the sprite is scaled by r / body.r)
 * @param {{golden?: boolean}} [opts]
 * @returns {{id:string, r:number, scale:number, pixels:Array<[number, number]>, farthest:number, nearestOutside:number, bodyRadius:number} | null}
 *   `pixels`: every 3rd body pixel centre relative to the object centre, rotated 0 (the hit test is rotation free), game px.
 *   `farthest`: distance of the farthest body pixel from the object centre. `nearestOutside`: distance from the centre to the nearest
 *   pixel that is NOT body. `bodyRadius`: radius of the circle with the same area as the body.
 */
export function measureBody(assetId, r, { golden = false } = {}) {
  const m = manifest();
  const meta = m && m.assets.find((a) => a.id === assetId);
  if (!meta || !meta.anchor || !meta.body) return null;
  let img;
  try {
    img = decodePng(fs.readFileSync(path.join(ASSETS, meta.file)));
  } catch {
    return null;
  }
  const { width: W, height: H } = img;
  let body;
  if (golden) {
    const ink = makeMask(img, (red, green, blue, a) => a >= 200 && red < 70 && green < 70 && blue < 70);
    body = openDisc(fillEnclosed(largestComponent(ink, W, H), W, H), W, H, OPENING_PX);
  } else {
    body = openDisc(alphaMask(img, 200), W, H, OPENING_PX);
  }
  const scale = r / meta.body.r;
  const pixels = [];
  let farthest = 0;
  let area = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!body[y * W + x]) continue;
      area++;
      const dx = (x + 0.5 - meta.anchor.x) * scale;
      const dy = (y + 0.5 - meta.anchor.y) * scale;
      farthest = Math.max(farthest, Math.hypot(dx, dy));
      if ((x * 7 + y * 13) % 3 === 0) pixels.push([dx, dy]);
    }
  }
  const toOutside = squaredDistanceTo(body, W, H, 0);
  const ai = Math.min(H - 1, Math.floor(meta.anchor.y)) * W + Math.min(W - 1, Math.floor(meta.anchor.x));
  return {
    id: assetId, r, scale, pixels, farthest, nearestOutside: Math.sqrt(toOutside[ai]) * scale, bodyRadius: Math.sqrt(area / Math.PI) * scale,
  };
}
