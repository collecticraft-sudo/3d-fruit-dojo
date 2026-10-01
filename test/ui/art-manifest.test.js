// The UI kit against the REAL measured numbers of the shipped assets (public/assets/manifest.json, written by tools/build-assets.mjs): the
// metadata the widgets read is there and sane, every label still fits its plate, every glyph and icon still sits in free space, the timer ring
// and the toggles still land where the contract says. Skipped (not passed) when the manifest is absent. The other art tests use the seeds of
// docs/assets-integration.md Appendix A (test-support/ui/art-stub.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { HUD, timerRingArt } from '../../public/js/render/hud.js';
import { drawButton, drawToggle, resetWidgetArt } from '../../public/js/ui/widgets.js';
import { CONNECT_GLYPHS, MENU_LOGO } from '../../public/js/ui/layout-data.js';
import { createArtStub, createArtStubWithGlyphs, loadManifestSeed } from '../../test-support/ui/art-stub.js';
import { SCENES, makeRecordingCanvas } from '../../test-support/ui/art-scenes.js';
import { readDrawn } from '../../test-support/ui/art-geometry.js';
import { BUTTONS, assertFree, geometry } from '../../test-support/ui/art-checks.js';

const REAL = loadManifestSeed();
const opts = { skip: REAL ? false : 'public/assets/manifest.json is absent' };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sizeOfFont = (font) => Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]);
const stub = (o = {}) => createArtStub({ seed: REAL, ...o });

const UI_IDS = [
  'logo_title', 'panel_9slice', 'timer_ring',
  ...['primary', 'secondary'].flatMap((v) => ['default', 'focused', 'pressed', 'disabled'].map((s) => `button_${v}_${s}`)),
  ...['minus', 'plus'].flatMap((v) => ['default', 'focused', 'pressed', 'disabled'].map((s) => `stepper_${v}_${s}`)),
  'toggle_off', 'toggle_on', 'toggle_focused',
  'icon_freeze', 'icon_frenzy', 'icon_double', 'icon_clock', 'icon_trophy', 'icon_combo',
  'glyph_joycon_l', 'glyph_joycon_r', 'glyph_mouse', 'glyph_keyboard_enter', 'glyph_sync_button',
];

test('manifest: every image the UI kit draws is shipped, with a content box inside its file', opts, () => {
  for (const id of UI_IDS) {
    const m = REAL[id];
    assert.ok(m, `${id} is in the manifest`);
    assert.ok(m.group === 'core', `${id} is in group core (the UI kit is drawn from the first frame)`);
    const b = m.contentBox;
    assert.ok(b && b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.x + b.w <= m.width && b.y + b.h <= m.height, `${id}: content box ${JSON.stringify(b)} in ${m.width} x ${m.height}`);
  }
});

test('manifest: buttons carry a three-slice and a label plate, states point at their default, panels a nine-slice, toggles two cells, the ring its geometry', opts, () => {
  for (const v of ['primary', 'secondary']) {
    const def = REAL[`button_${v}_default`];
    assert.ok(def.slice && def.slice.t === 0 && def.slice.b === 0 && def.slice.l > 0 && def.slice.r > 0, `${v}: horizontal three-slice`);
    assert.ok(def.label && def.label.l > 0 && def.label.r > 0 && def.label.t > 0 && def.label.b > 0, `${v}: label insets`);
    assert.ok(def.slice.l + def.slice.r < def.contentBox.w, `${v}: the caps leave a middle to stretch`);
    for (const s of ['focused', 'pressed', 'disabled']) {
      const m = REAL[`button_${v}_${s}`];
      assert.equal(m.ref, `button_${v}_default`, `${v} ${s}: ref`);
      assert.deepEqual(m.slice, def.slice, `${v} ${s}: the same slice as the default`);
    }
  }
  for (const v of ['minus', 'plus']) for (const s of ['focused', 'pressed', 'disabled']) assert.equal(REAL[`stepper_${v}_${s}`].ref, `stepper_${v}_default`);
  const panel = REAL.panel_9slice.slice;
  assert.ok(panel && panel.l === panel.r && panel.t === panel.b && panel.l > 0 && panel.scale > 0, 'nine-slice panel');
  for (const id of ['toggle_off', 'toggle_on', 'toggle_focused']) {
    const cells = REAL[id].cells;
    assert.equal(cells.length, 2, `${id}: two cells`);
    assert.ok(cells.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= 1 && c.y + c.h <= 1 && c.w > 0.3), `${id}: cells are fractions of the box`);
    // the mirrored focused picture relies on the two cells being mirror images of each other
    const centres = cells.map((c) => c.x + c.w / 2);
    assert.ok(near(centres[0] + centres[1], 1, 0.02), `${id}: the cell centres are symmetrical about the picture centre (${centres})`);
  }
  const ring = REAL.timer_ring.ring;
  assert.ok(ring && ring.outer > ring.bandMid + ring.bandHalf - 1 && ring.hole < ring.bandMid - ring.bandHalf + 20 && ring.hole > 0, `ring ${JSON.stringify(ring)}`);
});

test('manifest: the logo keeps its aspect ratio (1.96), so the 443 x 226 box of the menu fits it', opts, () => {
  const b = REAL.logo_title.contentBox;
  assert.ok(near(b.w / b.h, 1.96, 0.05), `aspect ${b.w / b.h}`);
  assert.ok(near(MENU_LOGO.w / MENU_LOGO.h, 1.96, 0.02));
});

test('manifest: every real label still fits the plate of its button at 28 px or more (0.53 em per character, as measured in Chrome)', opts, () => {
  const problems = [];
  let checked = 0;
  for (const [id, w, h, inset, style, labels, glyphH] of BUTTONS) {
    for (const label of labels) {
      resetWidgetArt();
      const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: 0.53 });
      drawButton(canvas.ctx, { id, shape: 'rect', x: 960, y: 540, w, h, enabled: true }, label, { assets: stub(), inset, style, density: 1, icon: glyphH ? { id: 'glyph_mouse', h: glyphH } : undefined });
      const call = canvas.ctx.calls.find((c) => c[0] === 'fillText');
      if (!call) { problems.push(`${id} "${label}": not drawn`); continue; }
      checked++;
      const size = sizeOfFont(call.font);
      if (size < 28) problems.push(`${id} "${label}": ${size}px`);
      if (label.length * size * 0.53 > call[4] + 0.5) problems.push(`${id} "${label}": ${(label.length * size * 0.53).toFixed(0)} px at ${size} px does not fit ${call[4].toFixed(0)} px`);
    }
  }
  assert.ok(checked > 45);
  assert.deepEqual(problems, []);
});

test('manifest: on every screen every glyph, icon and the logo sits in free space (over no target except its own button, over no text)', opts, () => {
  let checked = 0;
  for (const name of Object.keys(SCENES)) {
    const g = geometry(name, { assets: stub() });
    for (const im of g.images) {
      if (!(im.id.startsWith('glyph_') || im.id.startsWith('icon_') || im.id === 'logo_title') || im.rotated) continue;
      const own = im.id === 'glyph_mouse' ? 'connect.mouse' : im.id === 'glyph_keyboard_enter' ? 'connect.sim' : null;
      assertFree(name, im, g, { own });
      checked++;
    }
  }
  assert.ok(checked >= 20, `${checked} pictures checked`);
});

test('manifest: the glyphs keep the boxes of the contract (pair 96, mouse and keyboard 64, sync 56 and 72 px): each is contained in its square box and touches it', opts, () => {
  // The controller pair is off by default (ART_CONFIG.glyphs.enabled, art review round 1): its size is checked with the switch on. Since the typography round
  // the three generic glyphs (glyph_joycon_l, glyph_joycon_r, glyph_sync_button) are landscape, so a picture contained in a box of height h is bound by its WIDTH
  // and is less than h tall (docs/contract-notes.md, "assets and typography engineer"): what stays is the box, the longer side of the picture.
  const g = geometry('connect-native', { assets: createArtStubWithGlyphs({ seed: REAL }) });
  const side = (gm, id) => {
    const im = gm.images.find((i) => i.id === id);
    return Math.max(im.w, im.h);
  };
  assert.ok(near(side(g, 'glyph_joycon_l'), CONNECT_GLYPHS.pair.h, 1e-6));
  assert.ok(near(side(g, 'glyph_mouse'), 64, 1e-6) && near(side(g, 'glyph_keyboard_enter'), 64, 1e-6));
  assert.ok(near(side(g, 'glyph_sync_button'), 56, 1e-6));
  // the disconnect title's glyph (72 px box) is left out when the title is so wide that it would touch the panel border (the display face is wider than the
  // fake text measure in this test): when it is drawn it fills its box
  const disc = geometry('disc-native-failed', { assets: stub() });
  if (disc.images.some((i) => i.id === 'glyph_sync_button')) assert.ok(near(side(disc, 'glyph_sync_button'), 72, 1e-6));
});

test('manifest: the timer ring lands on (960, 96) with its band middle at radius 72; the digits fit the hole', opts, () => {
  const assets = stub();
  const m = REAL.timer_ring;
  for (const [rr, digits] of [[72, 40], [72 * 0.86, 34]]) {
    const a = timerRingArt(assets, rr, 2);
    assert.ok(a, 'the ring is built');
    const s = rr / m.ring.bandMid;
    assert.ok(near(a.img.w, m.contentBox.w * s, 1e-6) && near(a.img.h, m.contentBox.h * s, 1e-6));
    assert.ok(near(a.dx + (m.ring.cx - m.contentBox.x) * s, 0, 1e-9) && near(a.dy + (m.ring.cy - m.contentBox.y) * s, 0, 1e-9), 'the ring centre is the drawing origin');
    assert.equal(a.digitPx, digits);
    assert.ok(a.digitPx * 2.31 + HUD.timerArt.digitStroke <= 2 * a.hole - 8, `"0:00" fits the hole of ${(2 * a.hole).toFixed(1)} px with 4 px of room on each side`);
    assert.ok(a.arcW / 2 < m.ring.bandHalf * s, 'the arc lies inside the band');
    assert.ok(HUD.timerArt.y - a.outer >= 0, 'the outer edge stays on the canvas');
  }
});

test('manifest: a toggle draws its picture 84 px high over the union of the cells, with On and Off inside the real cell interiors', opts, () => {
  const A = { id: 'a', shape: 'rect', x: 250, y: 764, w: 210, h: 84, enabled: true };
  const B = { id: 'b', shape: 'rect', x: 470, y: 764, w: 210, h: 84, enabled: true };
  for (const activeA of [true, false]) {
    for (const hover of [false, true]) {
      resetWidgetArt();
      const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: 0.6 });
      drawToggle(canvas.ctx, A, B, 'On', 'Off', activeA, hover, false, { assets: stub(), density: 1 });
      const { images, texts } = readDrawn(canvas.ctx.calls);
      const im = images[0];
      const rest = REAL[activeA ? 'toggle_off' : 'toggle_on'].contentBox;
      assert.ok(near(im.h, hover ? 84 * (REAL.toggle_focused.contentBox.h / rest.h) : 84, 1e-6), `${im.id}: 84 px (or the halo) high`);
      assert.ok(im.w < 430);
      const shown = REAL[im.id].cells;
      const on = texts.find((x) => x.text === 'On');
      const off = texts.find((x) => x.text === 'Off');
      const cellW = shown[0].w * im.w;
      assert.ok(on.w <= cellW - 16 + 1e-6 && off.w <= cellW - 16 + 1e-6, `${im.id}: the labels fit a cell of ${cellW.toFixed(0)} px`);
      assert.ok(on.cx < off.cx && on.cx > im.x && off.cx < im.x + im.w);
    }
  }
});
