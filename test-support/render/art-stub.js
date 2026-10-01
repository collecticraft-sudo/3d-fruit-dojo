// A stub `Assets` (docs/assets-integration.md 2.2) for the gameplay-renderer tests. OWNER: Gameplay-renderer engineer.
//
// It implements the members the renderer, sprites and trail use (isNull, config, generation, has, get, meta, ids, scaled, on, status,
// load, prefetch, release, dispose) with the seed numbers of docs/assets-integration.md Appendix A, so a test can say exactly which
// ids are "loaded" and change that at run time (`add`, `remove`), which bumps `generation` and emits `group` / `release` like the
// real loader. `get(id)` returns a stub drawable `{id, width, height, isStub: true}`; `scaled()` builds a fake canvas through the
// injected factory (contain fit, contentBox only), counts its calls and caches like the loader.
//
// This file does not depend on the Asset engineer's `test-support/assets/`, which may not exist yet; the numbers are the same seed.
import { ART_CONFIG } from '../../public/js/render/art-config.js';
import { FakeCanvas } from './fake-canvas.js';

const FRUIT_TYPES = ['watermelon', 'pineapple', 'apple', 'orange', 'pear', 'peach', 'lemon', 'kiwi', 'strawberry', 'cherry', 'golden'];
const POWERUPS = ['freeze', 'frenzy', 'double', 'clock'];

// id -> [body cx, body cy, body r, box x, box y, box w, box h]  (Appendix A.1)
const WHOLE = {
  watermelon: [256, 256, 187, 73, 63, 365, 385],
  pineapple: [255, 299, 142, 156, 62, 199, 387],
  apple: [256, 283, 163, 97, 63, 318, 385],
  orange: [256, 256, 190, 68, 63, 376, 385],
  pear: [255, 302, 146, 132, 62, 247, 387],
  peach: [257, 274, 172, 85, 63, 342, 385],
  lemon: [256, 256, 164, 118, 63, 276, 385],
  kiwi: [256, 259, 183, 97, 63, 317, 385],
  strawberry: [255, 258, 159, 110, 63, 290, 386],
  cherry: [244, 348, 99, 144, 62, 223, 387],
  golden: [257, 262, 172, 11, 2, 489, 508],
};

function entry(id, kind, width, height, box, extra = {}) {
  return {
    id, file: `${id}.png`, kind, group: 'core', width, height, bytes: 1000,
    contentBox: { x: box[0], y: box[1], w: box[2], h: box[3] },
    anchor: { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 },
    ...extra,
  };
}

/** The seed manifest entries of every image the gameplay renderer uses, keyed by id. */
export function seedMeta() {
  const m = Object.create(null);
  for (const type of FRUIT_TYPES) {
    const [cx, cy, r, x, y, w, h] = WHOLE[type];
    m[`fruit_${type}_whole`] = entry(`fruit_${type}_whole`, 'fruit', 512, 512, [x, y, w, h], { anchor: { x: cx, y: cy }, body: { cx, cy, r } });
    // halves: a face-on view, anchor = centre of its own contentBox; golden halves are 9 percent smaller (halfScale 0.91)
    const box = type === 'apple' ? [102, 93, 308, 325] : [96 + FRUIT_TYPES.indexOf(type), 90, 316, 330];
    for (const suffix of ['a', 'b']) {
      m[`fruit_${type}_half_${suffix}`] = entry(`fruit_${type}_half_${suffix}`, 'half', 512, 512, box, { halfScale: type === 'golden' ? 0.91 : 1 });
    }
    m[`fx_splash_${type}`] = entry(`fx_splash_${type}`, 'splash', 384, 384, [48, 30, 285, 327]);
  }
  m.bomb_whole = entry('bomb_whole', 'bomb', 512, 512, [82, 39, 347, 434], { anchor: { x: 237, y: 318 }, body: { cx: 237, cy: 318, r: 154 }, points: { fuseTip: { x: 383, y: 88 } } });
  for (const id of POWERUPS) {
    m[`medallion_${id}`] = entry(`medallion_${id}`, 'medallion', 512, 512, [47, 41, 418, 431], { anchor: { x: 256, y: 257 }, body: { cx: 256, cy: 257, r: 212 } });
  }
  m.fx_bomb_explosion = entry('fx_bomb_explosion', 'fx', 768, 696, [0, 0, 768, 696], { anchor: { x: 399, y: 380 } });
  m.fx_slice_flash = entry('fx_slice_flash', 'fx', 768, 408, [0, 0, 768, 408], { anchor: { x: 377, y: 197 }, axis: { angleRad: -0.48, lengthPx: 860 } });
  m.fx_blade_trail_tex = entry('fx_blade_trail_tex', 'fx', 1024, 156, [0, 0, 1024, 156]);
  m.cursor_idle = entry('cursor_idle', 'ui', 256, 261, [4, 3, 252, 258], { anchor: { x: 112, y: 146 }, body: { cx: 112, cy: 146, r: 109 } });
  m.cursor_cutting = entry('cursor_cutting', 'ui', 256, 269, [0, 0, 256, 269], { anchor: { x: 104, y: 144 }, body: { cx: 104, cy: 144, r: 100 } });
  for (const id of ['icon_life_full', 'icon_life_empty', 'icon_combo', 'icon_warning']) m[id] = entry(id, 'icon', 256, 256, [16, 20, 224, 216]);
  return m;
}

/** Every image id the gameplay renderer can use. */
export const GAMEPLAY_ART_IDS = Object.freeze(Object.keys(seedMeta()));

/**
 * @param {{ids?:'all'|string[], createCanvas?:(w:number,h:number)=>any, config?:object, meta?:object, noMeta?:string[]}} [opts]
 *   ids: which ids are loaded (default all); createCanvas: factory for scaled() (default FakeCanvas); meta: per-id overrides merged into the seed;
 *   noMeta: ids that are loaded but whose meta() is null (a malformed manifest); manifest: real manifest entries to use instead of the seed.
 */
export function createArtStub({ ids = 'all', createCanvas = (w, h) => new FakeCanvas(w, h), config = ART_CONFIG, meta: overrides = {}, noMeta = [], manifest = null } = {}) {
  // `manifest`: the entries of a real manifest.json (an array) replace the seed numbers (public/assets/manifest.json in the real-manifest tests)
  const metas = manifest ? Object.fromEntries(manifest.map((e) => [e.id, e])) : seedMeta();
  for (const [id, o] of Object.entries(overrides)) metas[id] = o === null ? null : { ...(metas[id] ?? {}), ...o };
  const loaded = new Set(ids === 'all' ? Object.keys(metas) : ids);
  const handlers = new Map();
  const scaledCache = new Map();
  const drawables = new Map();

  const stub = {
    isNull: false,
    isStub: true,
    config,
    generation: 1,
    /** counters for the "no per-frame calls" assertions */
    calls: { has: 0, get: 0, meta: 0, scaled: 0, scaledCreated: 0 },
    /** ids whose get() throws (a broken image) */
    throwOn: new Set(),
    /** when true scaled() throws (a canvas that cannot be created) */
    scaledThrows: false,
    /** every scaled() call in order: {id, boxW, boxH, density, result} (result is the cached object, null when the id is not loaded) */
    scaledLog: [],
    /** the result of the most recent scaled() call for an id (or null) */
    lastScaled(id) {
      for (let i = stub.scaledLog.length - 1; i >= 0; i--) if (stub.scaledLog[i].id === id) return stub.scaledLog[i].result;
      return null;
    },
    has(id) { stub.calls.has++; return loaded.has(id); },
    get(id) {
      stub.calls.get++;
      if (!loaded.has(id)) return null;
      if (stub.throwOn.has(id)) throw new Error(`stub: image ${id} is broken`);
      let d = drawables.get(id);
      if (!d) {
        const mm = metas[id];
        d = { id, width: mm ? mm.width : 512, height: mm ? mm.height : 512, isStub: true };
        drawables.set(id, d);
      }
      return d;
    },
    meta(id) {
      stub.calls.meta++;
      if (noMeta.includes(id)) return null;
      return metas[id] ?? null;
    },
    ids: () => Object.keys(metas),
    scaled(id, boxW, boxH, density = 1, opts = {}) {
      stub.calls.scaled++;
      const mm = metas[id];
      if (!loaded.has(id) || !mm) {
        stub.scaledLog.push({ id, boxW, boxH, density, result: null });
        return null;
      }
      if (stub.scaledThrows) throw new Error('stub: scaled() failed');
      const key = `${id}|${boxW}x${boxH}|${density}|${opts.fit ?? 'contain'}`;
      let r = scaledCache.get(key);
      if (r) {
        stub.scaledLog.push({ id, boxW, boxH, density, result: r });
        return r;
      }
      const b = mm.contentBox;
      const s = Math.min(boxW / b.w, boxH / b.h);
      const w = b.w * s;
      const h = b.h * s;
      r = { canvas: createCanvas(Math.ceil(w * density), Math.ceil(h * density)), w, h, density };
      scaledCache.set(key, r);
      stub.calls.scaledCreated++;
      stub.scaledLog.push({ id, boxW, boxH, density, result: r });
      return r;
    },
    sliced: () => null,
    status: () => ({ manifest: 'ready', groups: {}, generation: stub.generation }),
    load: (group) => Promise.resolve({ group, state: 'ready', loaded: loaded.size, failed: 0, total: loaded.size }),
    prefetch() {},
    release() {},
    dispose() { handlers.clear(); },
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    emit(type, payload = {}) {
      for (const fn of [...(handlers.get(type) ?? [])]) fn(payload);
    },
    listenerCount: (type) => handlers.get(type)?.size ?? 0,

    // ---- test controls
    /** These ids finish loading: `generation` goes up and a `group` event fires (like the real loader). */
    add(list) {
      for (const id of list) loaded.add(id);
      stub.generation++;
      stub.emit('group', { group: 'core', state: 'ready' });
    },
    /** Like add() but WITHOUT the event: only `generation` moves (a consumer must notice by itself). */
    addQuietly(list) {
      for (const id of list) loaded.add(id);
      stub.generation++;
    },
    /** These ids are released: `generation` goes up and a `release` event fires. */
    remove(list) {
      for (const id of list) loaded.delete(id);
      for (const k of [...scaledCache.keys()]) if (list.some((id) => k.startsWith(`${id}|`))) scaledCache.delete(k);
      stub.generation++;
      stub.emit('release', { group: 'core' });
    },
    isLoaded: (id) => loaded.has(id),
  };
  return stub;
}
