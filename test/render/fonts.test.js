// The font loader (public/js/render/fonts.js, docs/restyle-direction.md 1.1, docs/typography.md): it never rejects, never throws, never blocks, falls
// back to the system stacks, and tells the text caches when a family arrives. A fake FontFace and a fake document stand in for the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FONT_FILES, FONT_TIMEOUT_MS, ensureFontsStarted, fontUsable, fontsEnabledByQuery, fontsGeneration, fontsReady, fontsStatus, loadFonts, onFontsChange, resetFontsForTests } from '../../public/js/render/fonts.js';
import { wrapLines } from '../../public/js/render/draw-util.js';
import { FakeContext, FakeCanvas } from '../../test-support/render/fake-canvas.js';

/** FontFace stand-in: records its arguments; `behaviour[family]` is 'ok' (default), 'fail' or 'never'. */
function fakeEnv(behaviour = {}, extra = {}) {
  const created = [];
  const added = [];
  const timers = [];
  class FakeFontFace {
    constructor(family, source, descriptors) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
      created.push(this);
    }
    load() {
      const b = behaviour[this.family] ?? 'ok';
      if (b === 'fail') return Promise.reject(new Error('404'));
      if (b === 'never') return new Promise((resolve) => { this.finish = () => resolve(this); });
      return Promise.resolve(this);
    }
  }
  const env = {
    FontFace: FakeFontFace,
    document: { fonts: { add: (f) => added.push(f) } },
    baseUrl: 'assets/',
    setTimeout: (ms, fn) => { timers.push({ ms, fn, cleared: false }); return timers.length - 1; },
    clearTimeout: (h) => { if (timers[h]) timers[h].cleared = true; },
    ...extra,
  };
  return { env, created, added, timers };
}

test.beforeEach(() => resetFontsForTests());

test('FONT_FILES: the two shipped families, one weight range that covers every weight (so no bold is synthesised)', () => {
  assert.deepEqual(FONT_FILES.map((f) => f.family), ['DojoDisplay', 'DojoUI']);
  assert.deepEqual(FONT_FILES.map((f) => f.file), ['fonts/dojo-display.woff2', 'fonts/dojo-ui.woff2']);
  for (const f of FONT_FILES) assert.equal(f.weight, '100 900');
  assert.ok(Object.isFrozen(FONT_FILES) && FONT_FILES.every(Object.isFrozen));
  assert.equal(FONT_TIMEOUT_MS, 2500);
});

test('loadFonts: both files load, are added to document.fonts with swap, the generation goes up once per family and listeners hear about it', async () => {
  const { env, created, added, timers } = fakeEnv();
  const heard = [];
  const off = onFontsChange((g) => heard.push(g));
  const p = loadFonts(env);
  assert.equal(fontsStatus().state, 'loading');
  assert.equal(fontsGeneration(), 0, 'nothing is usable before the files arrive');
  const r = await p;
  assert.deepEqual(r, { loaded: ['DojoDisplay', 'DojoUI'], failed: [] });
  assert.equal(fontsStatus().state, 'ready');
  assert.equal(fontsGeneration(), 2);
  assert.deepEqual(heard, [1, 2]);
  assert.equal(added.length, 2);
  assert.ok(fontUsable('DojoDisplay') && fontUsable('DojoUI') && !fontUsable('Nope'));
  assert.equal(created[0].source, 'url("assets/fonts/dojo-display.woff2") format("woff2")');
  assert.deepEqual(created[0].descriptors, { weight: '100 900', style: 'normal', display: 'swap' });
  assert.ok(timers.every((t) => t.cleared), 'the timeout timers are cancelled once a file arrived');
  off();
});

test('loadFonts: the base url is joined with or without a trailing slash, and a custom folder works', async () => {
  for (const base of ['assets', 'assets/', '/x/assets/']) {
    resetFontsForTests();
    const { env, created } = fakeEnv({}, { baseUrl: base });
    await loadFonts(env);
    assert.match(created[0].source, new RegExp(`^url\\("${base.replace(/\/$/, '')}/fonts/dojo-display\\.woff2"\\)`), base);
  }
});

test('loadFonts: it is idempotent (every call returns the first promise) and fontsReady() is that promise', async () => {
  const { env } = fakeEnv();
  const p1 = loadFonts(env);
  assert.equal(loadFonts(env), p1);
  assert.equal(fontsReady(), p1);
  await p1;
  assert.equal(loadFonts({}), p1, 'even with another environment');
});

test('a file that fails does not break the other, never rejects, and is reported', async () => {
  const { env, added } = fakeEnv({ DojoUI: 'fail' });
  const r = await loadFonts(env);
  assert.deepEqual(r, { loaded: ['DojoDisplay'], failed: ['DojoUI'] });
  assert.equal(fontsStatus().state, 'failed');
  assert.deepEqual(fontsStatus().failed, ['DojoUI']);
  assert.equal(added.length, 1);
  assert.equal(fontsGeneration(), 1);
  assert.ok(fontUsable('DojoDisplay') && !fontUsable('DojoUI'), 'the failed family stays on the system stack');
});

test('a slow file: the promise settles after the timeout (the one asked for) with the family failed; when the file arrives later it is still added and still bumps the generation', async () => {
  const state = { finish: null };
  class LateFace {
    constructor(family) { this.family = family; }
    load() { return this.family === 'DojoDisplay' ? new Promise((resolve) => { state.finish = () => resolve(this); }) : Promise.resolve(this); }
  }
  const added = [];
  let fire = null;
  const heard = [];
  onFontsChange((g) => heard.push(g));
  const asked = [];
  const p = loadFonts({ FontFace: LateFace, document: { fonts: { add: (f) => added.push(f.family) } }, setTimeout: (ms, fn) => { asked.push(ms); if (!fire) fire = fn; return asked.length; }, clearTimeout() {}, timeoutMs: 50 });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(asked, [50, 50], 'a timer per file, with the timeout asked for');
  fire();
  const r = await p;
  assert.deepEqual(r.failed, ['DojoDisplay']);
  assert.equal(fontsGeneration(), 1);
  state.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(added.sort(), ['DojoDisplay', 'DojoUI']);
  assert.equal(fontsGeneration(), 2);
  assert.deepEqual(heard, [1, 2]);
  assert.ok(fontUsable('DojoDisplay'));
  assert.equal(fontsStatus().state, 'ready');
});

test('no FontFace, no document, or a document without a font set: the system fonts, as before (nothing throws, nothing is usable)', async () => {
  for (const env of [{}, { document: { fonts: {} }, FontFace: class {} }, { document: { fonts: { add() {} } } }, { FontFace: class {} }]) {
    resetFontsForTests();
    const r = await loadFonts(env);
    assert.deepEqual(r.loaded, []);
    assert.deepEqual(r.failed, ['DojoDisplay', 'DojoUI']);
    assert.equal(fontsStatus().state, 'failed');
    assert.equal(fontsGeneration(), 0);
  }
});

test('a FontFace constructor that throws, or a document.fonts.add that throws, is a failed family, not an exception', async () => {
  class Boom { constructor() { throw new Error('bad descriptor'); } }
  assert.deepEqual((await loadFonts({ FontFace: Boom, document: { fonts: { add() {} } } })).failed, ['DojoDisplay', 'DojoUI']);
  resetFontsForTests();
  const { env } = fakeEnv({}, { document: { fonts: { add: () => { throw new Error('locked'); } } } });
  const r = await loadFonts(env);
  assert.deepEqual(r.loaded, []);
  assert.deepEqual(r.failed, ['DojoDisplay', 'DojoUI']);
  assert.equal(fontsGeneration(), 0);
});

test('enabled:false (?fonts=0 or ?assets=0) loads nothing and creates no FontFace', async () => {
  const { env, created } = fakeEnv();
  const r = await loadFonts({ ...env, enabled: false });
  assert.deepEqual(r, { loaded: [], failed: [] });
  assert.equal(fontsStatus().state, 'off');
  assert.equal(created.length, 0);
});

test('fontsEnabledByQuery: ?fonts=0|off|false and ?assets=0|off turn the files off; everything else leaves them on', () => {
  for (const q of ['?fonts=0', '?fonts=off', '?assets=0', '?assets=off', '?input=sim&fonts=false']) assert.equal(fontsEnabledByQuery(q), false, q);
  for (const q of ['', '?fonts=1', '?assets=1', '?input=sim', '?fonts=banana', undefined, null]) assert.equal(fontsEnabledByQuery(q), true, String(q));
});

test('a listener that throws never breaks the loader or the other listeners', async () => {
  const { env } = fakeEnv();
  const heard = [];
  onFontsChange(() => { throw new Error('bug in a listener'); });
  onFontsChange((g) => heard.push(g));
  const r = await loadFonts(env);
  assert.deepEqual(r.loaded, ['DojoDisplay', 'DojoUI']);
  assert.deepEqual(heard, [1, 2]);
});

test('onFontsChange returns an unsubscribe function', async () => {
  const { env } = fakeEnv();
  const heard = [];
  const off = onFontsChange((g) => heard.push(g));
  off();
  await loadFonts(env);
  assert.deepEqual(heard, []);
});

test('ensureFontsStarted in Node (no document, no FontFace) does nothing and returns null once, then the same', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(ensureFontsStarted(), null);
  assert.equal(ensureFontsStarted(), null);
  assert.equal(fontsStatus().state, 'idle');
});

test('a family arriving drops the text caches: wrapLines measures again after the font generation changes (the font string is the same before and after)', async () => {
  const ctx = new FakeContext(new FakeCanvas(10, 10));
  let measures = 0;
  const measure = ctx.measureText.bind(ctx);
  ctx.measureText = (t) => { measures++; return measure(t); };
  const font = '600 34px "DojoUI", system-ui';
  const a = wrapLines(ctx, 'Slice the fruit and avoid the bombs please', font, 300);
  const m1 = measures;
  assert.equal(wrapLines(ctx, 'Slice the fruit and avoid the bombs please', font, 300), a, 'cached');
  assert.equal(measures, m1, 'no measurement for a cache hit');
  const { env } = fakeEnv();
  await loadFonts(env);
  const b = wrapLines(ctx, 'Slice the fruit and avoid the bombs please', font, 300);
  assert.notEqual(b, a, 'a new array: the cache was dropped');
  assert.deepEqual(b, a, 'with the same lines under the fake metrics');
  assert.ok(measures > m1, 'it was measured again');
});
