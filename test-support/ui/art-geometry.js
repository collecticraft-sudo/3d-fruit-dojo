// Geometry of what a scene drew, read back from the recorded calls of a recording context (art-scenes.js). OWNER: UI-kit engineer.
//
// The reader replays save / restore / translate / scale / rotate and the assignments of font, textAlign and textBaseline, so a rectangle is
// reported in playfield coordinates. Content drawn under a rotation is reported with `rotated: true` and an unrotated box (tests that need
// exact boxes skip it). Text boxes are CONSERVATIVE upper bounds: the width of a text is length x size x `WIDTH_FACTOR` (a bold proportional
// font is about 0.55 to 0.6 em per character; the fake context measures 0.52), and its height is 1.05 x the size.

/** Upper bound of the advance of one character, in em, for the bold system fonts of the game. */
export const WIDTH_FACTOR = 0.6;

const sizeOf = (font) => {
  const m = /(\d+(?:\.\d+)?)px/.exec(font ?? '');
  return m ? Number(m[1]) : 10;
};

/**
 * Replay the calls. Returns the images (drawImage of a canvas that carries `artId`, or any canvas when `all` is true) and the texts.
 * @param {Array<Array<any>>} calls raw calls of a recording context
 * @param {{all?:boolean}} [o]
 */
export function readDrawn(calls, o = {}) {
  const images = [];
  const texts = [];
  let cur = { tx: 0, ty: 0, sx: 1, sy: 1, rot: false, font: '10px sans-serif', align: 'start', baseline: 'alphabetic', depth: 0 };
  const stack = [];
  for (const c of calls) {
    const name = c[0];
    if (name === 'save') stack.push({ ...cur });
    else if (name === 'restore') { const p = stack.pop(); if (p) cur = p; }
    else if (name === 'translate') { cur.tx += c[1] * cur.sx; cur.ty += c[2] * cur.sy; }
    else if (name === 'scale') { cur.sx *= c[1]; cur.sy *= c[2]; }
    else if (name === 'rotate') cur.rot = true;
    else if (name === 'setTransform') cur = { ...cur, tx: c[5], ty: c[6], sx: c[1], sy: c[4] };
    else if (name === '=font') cur.font = c[1];
    else if (name === '=textAlign') cur.align = c[1];
    else if (name === '=textBaseline') cur.baseline = c[1];
    else if (name === 'drawImage') {
      const cv = c[1];
      if (!o.all && !(cv && cv.artId)) continue;
      const w = c[4] * Math.abs(cur.sx);
      const h = c[5] * Math.abs(cur.sy);
      const x = cur.sx < 0 ? cur.tx + c[2] * cur.sx - c[4] * Math.abs(cur.sx) : cur.tx + c[2] * cur.sx;
      const y = cur.ty + c[3] * cur.sy;
      images.push({ id: cv ? cv.artId : null, kind: cv ? cv.artKind : null, x, y, w, h, mirrored: cur.sx < 0, rotated: cur.rot, canvas: cv });
    } else if (name === 'fillText' || name === 'strokeText') {
      if (name === 'strokeText') continue; // the stroke of a text has the same box as its fill
      const font = c.font ?? cur.font;
      const size = sizeOf(font);
      const maxW = c[4];
      let w = String(c[1]).length * size * WIDTH_FACTOR;
      if (maxW !== undefined) w = Math.min(w, maxW);
      const x0 = cur.tx + c[2] * cur.sx;
      const left = cur.align === 'center' ? x0 - w / 2 : cur.align === 'right' || cur.align === 'end' ? x0 - w : x0;
      const y0 = cur.ty + c[3] * cur.sy;
      const h = size * 1.05;
      const top = cur.baseline === 'middle' ? y0 - h / 2 : cur.baseline === 'top' ? y0 : y0 - size * 0.82;
      texts.push({ text: c[1], size, x: left, y: top, w, h, maxW, rotated: cur.rot, font, align: cur.align, baseline: cur.baseline, cx: x0, cy: y0 });
    }
  }
  return { images, texts };
}

/** Do two rectangles {x, y, w, h} overlap (touching edges do not count; `gap` requires that much clear space between them)? */
export function overlaps(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** Rectangle {x, y, w, h} of a target (centre based) or of a circle target's bounding box. */
export function targetRect(t) {
  return t.shape === 'circle' ? { x: t.x - t.r, y: t.y - t.r, w: 2 * t.r, h: 2 * t.r } : { x: t.x - t.w / 2, y: t.y - t.h / 2, w: t.w, h: t.h };
}

/** Does the circle target overlap the rectangle? */
export function circleHitsRect(c, r) {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return Math.hypot(c.x - nx, c.y - ny) < c.r;
}

/** True when a rectangle lies inside another. */
export function inside(inner, outer, margin = 0) {
  return inner.x >= outer.x + margin && inner.y >= outer.y + margin && inner.x + inner.w <= outer.x + outer.w - margin && inner.y + inner.h <= outer.y + outer.h - margin;
}
