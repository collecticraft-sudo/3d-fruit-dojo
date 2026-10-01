// Where the art goes (docs/assets-integration.md 5.7, 5.8, 9.1, 8.5): the logo, the controller glyphs and the icons sit in free space, never over a
// target and never over text, in both connect layouts and on every screen that has them; the single glyph switch and the swap table work; the
// boot screen shows the logo, the word and a progress bar. Every rectangle is read back from what the screens really drew with the stub art
// (test-support/ui/art-geometry.js), with conservative text widths (0.6 em per character).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ART_CONFIG } from '../../public/js/render/art-config.js';
import { coreProgress } from '../../public/js/ui/screens/boot.js';
import { ribbonLayout } from '../../public/js/ui/screens/results.js';
import {
  BOOT_ART, CONFIRM_PANEL, CONNECT_GLYPHS, DISCONNECT_PANEL, GLYPH_DEFAULT_IDS, MENU_BUTTONS, MENU_LOGO, MENU_MODES, MENU_TAGLINE_Y, RESULTS_ART, RESULTS_PANEL, glyphId,
} from '../../public/js/ui/layout-data.js';
import { t } from '../../public/js/ui/strings.en.js';
import { createArtStub, createArtStubNoGlyphs, createArtStubWithGlyphs, SEED } from '../../test-support/ui/art-stub.js';
import { digestCalls, makeSpriteStub, runScene } from '../../test-support/ui/art-scenes.js';
import { circleHitsRect, inside, overlaps, targetRect } from '../../test-support/ui/art-geometry.js';
import { FIELD, assertFree, geometry } from '../../test-support/ui/art-checks.js';

const GOLDEN = JSON.parse(readFileSync(new URL('../../test-support/ui/procedural-digests.json', import.meta.url), 'utf8'));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const isGlyph = (id) => id && (id.startsWith('glyph_') || id.startsWith('icon_'));

// ------------------------------------------------------------------------------------------------------------------- the menu

test('menu: the logo is contained in the 443 x 226 box at the top centre and replaces the title text; the tagline moves to y 272', () => {
  const g = geometry('menu');
  const logos = g.images.filter((i) => i.id === 'logo_title');
  assert.equal(logos.length, 1);
  const [logo] = logos;
  assert.ok(near(logo.x + logo.w / 2, MENU_LOGO.cx) && near(logo.y + logo.h / 2, MENU_LOGO.top + MENU_LOGO.h / 2), 'centred in its box');
  assert.ok(logo.w <= MENU_LOGO.w + 1e-9 && logo.h <= MENU_LOGO.h + 1e-9 && (near(logo.w, MENU_LOGO.w, 1) || near(logo.h, MENU_LOGO.h, 1)), 'contained');
  assert.ok(logo.y >= MENU_LOGO.top - 1e-9, 'top edge at 10 or lower');
  assert.ok(near(logo.w / logo.h, SEED.logo_title.contentBox.w / SEED.logo_title.contentBox.h, 1e-9), 'the aspect ratio of the picture');
  assert.equal(g.texts.some((x) => x.text === t('menu.title')), false, 'no title text under the logo');
  const tagline = g.texts.find((x) => x.text === t('menu.tagline'));
  assert.equal(tagline.cy, MENU_TAGLINE_Y.logo);
  assert.equal(MENU_TAGLINE_Y.logo, 272);
  assert.ok(tagline.y >= logo.y + logo.h + 6, `the tagline (top ${tagline.y}) clears the logo bottom ${logo.y + logo.h}`);
});

test('menu: the logo overlaps no mode fruit (with the hover ring and the bob), no button, no text; the mode fruit and buttons did not move', () => {
  for (const name of ['menu', 'menu-hover', 'menu-hover-button']) {
    const g = geometry(name);
    const [logo] = g.images.filter((i) => i.id === 'logo_title');
    for (const m of MENU_MODES) assert.equal(circleHitsRect({ x: m.x, y: m.y, r: m.r + 16 + 10 }, logo), false, `${name}: the logo clears the ${m.id} fruit`);
    for (const b of MENU_BUTTONS) assert.equal(overlaps(logo, { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }), false, `${name}: ${b.id}`);
    for (const tx of g.texts) assert.equal(overlaps(logo, tx), false, `${name}: the text "${tx.text}"`);
    for (const tg of g.targets) {
      const hit = tg.shape === 'circle' ? circleHitsRect(tg, logo) : overlaps(logo, targetRect(tg));
      assert.equal(hit, false, `${name}: target ${tg.id}`);
    }
  }
  assert.deepEqual(MENU_MODES.map((m) => [m.id, m.x, m.y, m.r]), [['classic', 480, 520, 175], ['arcade', 960, 520, 170], ['zen', 1440, 520, 172]]);
  assert.deepEqual(MENU_BUTTONS.map((b) => [b.id, b.x, b.y, b.w, b.h]), [['menu.settings', 560, 975, 400, 100], ['menu.recalibrate', 960, 975, 400, 100], ['menu.connection', 1360, 975, 400, 100]]);
});

test('menu: without the logo picture the title text and the tagline are where they always were (y 190 and 250)', () => {
  const g = geometry('menu', { assets: createArtStub({ missing: ['logo_title'] }) });
  assert.equal(g.images.filter((i) => i.id === 'logo_title').length, 0);
  // the title is drawn in the banner look since the restyle: a hard shadow copy first, then the letters (the last copy is the face)
  assert.equal(g.texts.filter((x) => x.text === t('menu.title')).at(-1).cy, 190);
  assert.equal(g.texts.find((x) => x.text === t('menu.tagline')).cy, 250);
  assert.equal(MENU_TAGLINE_Y.text, 250);
});

// ------------------------------------------------------------------------------------------------------------------- the connect screen

const CONNECT_SCENES = ['connect-legacy', 'connect-legacy-error', 'connect-native', 'connect-native-busy', 'connect-native-connected'];

test('connect: the left and right Joy-Con pair (96 px tall, centred at x 1400 and 1480, y 250) sits in free space above the main button in both layouts (switch on)', () => {
  for (const name of CONNECT_SCENES) {
    const g = geometry(name, { assets: createArtStubWithGlyphs() });
    const l = g.images.find((i) => i.id === 'glyph_joycon_l');
    const r = g.images.find((i) => i.id === 'glyph_joycon_r');
    assert.ok(l && r, `${name}: both controllers`);
    for (const [im, x] of [[l, CONNECT_GLYPHS.pair.xs[0]], [r, CONNECT_GLYPHS.pair.xs[1]]]) {
      assert.ok(near(im.h, 96, 1e-9), `${name}: ${im.id} is 96 px tall`);
      assert.ok(near(im.x + im.w / 2, x) && near(im.y + im.h / 2, 250), `${name}: ${im.id} centred at (${x}, 250)`);
      assertFree(name, im, g);
    }
    assert.equal(overlaps(l, r), false, `${name}: the two controllers do not touch`);
    const main = g.targets.find((tg) => tg.id === 'connect.main' || tg.id === 'connect.continue');
    assert.ok(l.y + l.h <= main.y - main.h / 2, `${name}: the pair ends (${l.y + l.h}) above the main button (${main.y - main.h / 2})`);
    const subtitle = g.texts.find((x) => x.text === t('connect.subtitle'));
    assert.ok(l.y >= subtitle.y + subtitle.h + 4, `${name}: and starts below the subtitle`);
  }
});

test('connect: the sync-button glyph (56 px tall) sits left of the pairing steps title, inside the steps panel, in both layouts', () => {
  for (const name of CONNECT_SCENES) {
    const g = geometry(name);
    const sync = g.images.find((i) => i.id === 'glyph_sync_button');
    assert.ok(sync, `${name}: the sync glyph`);
    assert.ok(near(sync.h, 56, 1e-9));
    const title = g.texts.find((x) => x.text === t('connect.steps.title'));
    assert.ok(sync.x + sync.w <= title.x - CONNECT_GLYPHS.sync.gap + 1e-6, `${name}: the gap to the title is at least ${CONNECT_GLYPHS.sync.gap}`);
    assert.ok(sync.x >= 120 + 24 && sync.y >= 250 + 12, `${name}: inside the steps panel (120, 250)`);
    assertFree(name, sync, g);
    assert.ok(Math.abs((sync.y + sync.h / 2) - (title.cy - 60 * 0.35)) < 1e-9, 'vertically on the middle of the capitals of the title');
  }
});

test('connect: the mouse and keyboard glyphs (64 px tall) sit inside the plates of "Mouse only" and "Simulator", the labels shift right, nothing else is touched', () => {
  for (const name of CONNECT_SCENES) {
    const g = geometry(name);
    for (const [glyph, targetId, label] of [['glyph_keyboard_enter', 'connect.sim', t('connect.alt.sim')], ['glyph_mouse', 'connect.mouse', t('connect.alt.mouse')]]) {
      const im = g.images.find((i) => i.id === glyph);
      assert.ok(im, `${name}: ${glyph}`);
      assert.ok(near(im.h, 64, 1e-9), `${glyph} is 64 px tall`);
      const tg = g.targets.find((x) => x.id === targetId);
      assert.ok(inside(im, targetRect(tg)), `${name}: ${glyph} is inside ${targetId}`);
      const frame = g.images.find((i) => i.id.startsWith('button_') && near(i.y + i.h / 2, tg.y, 8) && near(i.x + i.w / 2, tg.x, 1));
      assert.ok(frame && inside(im, frame), `${name}: and inside the button picture`);
      assertFree(name, im, g, { own: targetId, ignoreText: [] });
      const text = g.texts.find((x) => x.text === label);
      assert.ok(text.x >= im.x + im.w + 12 - 1e-6, `${name}: the label of ${targetId} starts at least 12 px after the glyph`);
      assert.ok(text.x + text.w <= tg.x + tg.w / 2, `${name}: and ends inside the button`);
    }
  }
});

test('connect: the buttons keep the labels, their hit boxes and their order; the extra art is no target', () => {
  for (const name of CONNECT_SCENES) {
    const withArt = geometry(name);
    const plain = geometry(name, { assets: undefined });
    assert.deepEqual(withArt.targets.map((x) => [x.id, x.x, x.y, x.w, x.h, x.enabled]), plain.targets.map((x) => [x.id, x.x, x.y, x.w, x.h, x.enabled]), name);
    const labels = (texts) => texts.map((x) => x.text).sort();
    assert.deepEqual(labels(withArt.texts), labels(plain.texts), `${name}: the same texts are drawn with and without art`);
  }
});

// ------------------------------------------------------------------------------------------------------------------- the glyph switch and the swap table

test('glyph switch: ART_CONFIG.glyphs.enabled = false hides the two controller pictures and nothing else', () => {
  assert.equal(ART_CONFIG.glyphs.enabled, false, 'default: OFF (art review round 1, M5: the two pictures are close copies of a real Joy-Con)');
  for (const name of ['connect-legacy', 'connect-native']) {
    const g = geometry(name, { assets: createArtStubNoGlyphs() });
    assert.equal(g.images.some((i) => i.id === 'glyph_joycon_l' || i.id === 'glyph_joycon_r'), false, `${name}: no controller`);
    for (const id of ['glyph_mouse', 'glyph_keyboard_enter', 'glyph_sync_button']) assert.ok(g.images.some((i) => i.id === id), `${name}: ${id} stays`);
    // the shipped default draws no controller picture either, with every id loaded
    const shipped = geometry(name, { assets: createArtStub() });
    assert.equal(shipped.images.some((i) => i.id === 'glyph_joycon_l' || i.id === 'glyph_joycon_r'), false, `${name}: the shipped config draws no controller`);
    // and flipping the switch is all it takes to bring them back
    const on = geometry(name, { assets: createArtStubWithGlyphs() });
    assert.equal(on.images.filter((i) => i.id === 'glyph_joycon_l' || i.id === 'glyph_joycon_r').length, 2, `${name}: switch on, both pictures`);
  }
  assert.equal(glyphId({ glyphs: { enabled: false, ids: GLYPH_DEFAULT_IDS } }, 'joyconL'), null);
  assert.equal(glyphId({ glyphs: { enabled: false, ids: GLYPH_DEFAULT_IDS } }, 'mouse'), 'glyph_mouse');
});

test('glyph swap table: art-config glyphs.ids maps a role to an asset id and the screens follow it with no code change', () => {
  const config = { ...ART_CONFIG, glyphs: { enabled: true, ids: { ...ART_CONFIG.glyphs.ids, joyconL: 'icon_trophy', joyconR: 'icon_combo', mouse: 'icon_freeze', keyboardEnter: 'icon_clock', sync: 'icon_double' } } };
  const g = geometry('connect-native', { assets: createArtStub({ config }) });
  const ids = g.images.filter((i) => isGlyph(i.id)).map((i) => i.id).sort();
  assert.deepEqual(ids, ['icon_clock', 'icon_combo', 'icon_double', 'icon_freeze', 'icon_trophy']);
  assert.equal(glyphId(config, 'joyconL'), 'icon_trophy');
  assert.equal(glyphId({}, 'joyconL'), 'glyph_joycon_l', 'no config at all: the default ids');
  assert.equal(glyphId(undefined, 'sync'), 'glyph_sync_button');
  assert.equal(glyphId({ glyphs: { enabled: true, ids: {} } }, 'mouse'), 'glyph_mouse', 'a role missing in the table falls back to the default id');
});

test('glyphs: a controller picture that is missing hides the pair (never one alone) and the rest of the screen is unchanged', () => {
  const g = geometry('connect-native', { assets: createArtStub({ missing: ['glyph_joycon_r'] }) });
  assert.equal(g.images.some((i) => i.id === 'glyph_joycon_l' || i.id === 'glyph_joycon_r'), false);
  assert.ok(g.images.some((i) => i.id === 'glyph_sync_button'));
});

// ------------------------------------------------------------------------------------------------------------------- the disconnect overlay

test('disconnect overlay: with the native bridge the sync glyph (72 px tall) sits left of the title inside the panel; without the bridge there is none', () => {
  for (const name of ['disc-native-failed', 'disc-native-reconnecting']) {
    const g = geometry(name);
    const sync = g.images.find((i) => i.id === 'glyph_sync_button');
    assert.ok(sync, `${name}: the glyph`);
    assert.ok(near(sync.h, 72, 1e-9));
    const P = DISCONNECT_PANEL;
    assert.ok(inside(sync, { x: P.x - P.w / 2, y: P.y - P.h / 2, w: P.w, h: P.h }, CONNECT_GLYPHS.disconnect.margin), `${name}: inside the panel with a margin of ${CONNECT_GLYPHS.disconnect.margin}`);
    const title = g.texts.find((x) => x.text === t('disc.title'));
    assert.ok(sync.x + sync.w <= title.x - CONNECT_GLYPHS.disconnect.gap + 1e-6, `${name}: clear of the title`);
    assertFree(name, sync, g);
  }
  for (const name of ['disc-waiting', 'disc-failed', 'disc-recentering']) assert.equal(geometry(name).images.some((i) => isGlyph(i.id)), false, `${name}: no glyph`);
  assert.equal(geometry('disc-native-failed', { assets: createArtStubNoGlyphs() }).images.some((i) => i.id === 'glyph_sync_button'), true, 'the controller switch does not govern the sync glyph');
});

// ------------------------------------------------------------------------------------------------------------------- results

test('results: the combo icon (48 px) sits left of the "Best combo" figure, inside the panel, over no text and no target', () => {
  for (const name of ['results-classic', 'results-zen']) {
    const g = geometry(name);
    const icon = g.images.find((i) => i.id === 'icon_combo');
    assert.ok(icon, `${name}: the combo icon`);
    assert.ok(icon.h >= 44 && icon.h <= 48 + 1e-9, `${name}: ${icon.h} px (never below 44)`);
    const P = RESULTS_PANEL;
    assert.ok(inside(icon, { x: P.x - P.w / 2, y: P.y - P.h / 2, w: P.w, h: P.h }, 20));
    assertFree(name, icon, g);
    const figure = g.texts.find((x) => x.text === String(4) && x.cx === 1440);
    assert.ok(figure, 'the combo figure');
    assert.ok(icon.x + icon.w < figure.x, 'left of the figure');
  }
});

test('results: the trophy sits inside the "new record" ribbon left of its text, the text shifts right, both stay inside the ribbon; only with a new record', () => {
  const g = geometry('results-classic');
  const trophy = g.images.find((i) => i.id === 'icon_trophy');
  assert.ok(trophy, 'the trophy');
  assert.equal(trophy.rotated, true, 'drawn in the tilted ribbon frame, like the text');
  assert.ok(near(trophy.h, RESULTS_ART.trophy.h, 1e-9) || near(trophy.w, RESULTS_ART.trophy.h, 1e-9));
  const text = g.texts.find((x) => x.text === t('results.newBest'));
  const half = RESULTS_ART.plate.w / 2;
  // both in the ribbon frame (translate only: the tilt applies equally to both)
  const localTrophy = { x: trophy.x - RESULTS_ART.plate.x, y: trophy.y - RESULTS_ART.plate.y, w: trophy.w, h: trophy.h };
  const localText = { x: text.x - RESULTS_ART.plate.x, w: text.w };
  assert.ok(localTrophy.x >= -half + RESULTS_ART.trophy.pad - 1e-9, 'the trophy is inside the ribbon');
  assert.ok(localText.x + localText.w <= half - RESULTS_ART.trophy.pad + 1e-9, 'the text is inside the ribbon');
  assert.ok(localTrophy.x + localTrophy.w + RESULTS_ART.trophy.gap <= localText.x + 1e-6, 'the text starts 14 px after the trophy');
  assert.ok(localTrophy.y >= -RESULTS_ART.plate.h / 2 + 4 && localTrophy.y + localTrophy.h <= RESULTS_ART.plate.h / 2 - 4, 'and inside its height');
  assert.equal(geometry('results-zen').images.some((i) => i.id === 'icon_trophy'), false, 'no record: no trophy');
});

test('results: ribbonLayout centres the trophy and the text as one group and refuses a group wider than the ribbon', () => {
  const lay = ribbonLayout(69, 277);
  assert.ok(lay);
  const total = 69 + RESULTS_ART.trophy.gap + 277;
  assert.ok(near(lay.trophyX - 69 / 2, -total / 2) && near(lay.textX + 277 / 2, total / 2));
  assert.ok(near(lay.textX - 277 / 2 - (lay.trophyX + 69 / 2), RESULTS_ART.trophy.gap));
  assert.equal(ribbonLayout(69, 400), null, 'a text that does not fit next to the trophy: no trophy, the text stays centred');
  assert.equal(ribbonLayout(69, 396 - 69 - RESULTS_ART.trophy.gap + 1), null);
  assert.ok(ribbonLayout(69, 396 - 69 - RESULTS_ART.trophy.gap));
});

test('results: the rank seal, the score and the stats grid are where they were (the art is added in free space only)', () => {
  const withArt = geometry('results-classic');
  const plain = geometry('results-classic', { assets: undefined });
  const sig = (texts) => texts.map((x) => [x.text, Math.round(x.cx), Math.round(x.cy)]);
  const drop = (rows) => rows.filter((r) => r[0] !== t('results.newBest'));
  assert.deepEqual(drop(sig(withArt.texts)), drop(sig(plain.texts)));
  assert.equal(withArt.targets.length, 2);
});

// ------------------------------------------------------------------------------------------------------------------- boot

function bootStatus(loaded, total) {
  const assets = createArtStub();
  assets.status = () => ({ manifest: 'loading', groups: { core: { state: 'loading', loaded, failed: 0, total } }, generation: assets.generation });
  return assets;
}

test('boot: the logo is contained in 720 x 400 at (960, 420), "Loading…" sits at y 700, the progress bar is 480 x 14 at y 740, filled by the core group', () => {
  const assets = bootStatus(30, 100);
  const g = geometry('boot', { assets });
  const [logo] = g.images.filter((i) => i.id === 'logo_title');
  const L = BOOT_ART.logo;
  assert.ok(logo.w <= L.w + 1e-9 && logo.h <= L.h + 1e-9 && (near(logo.w, L.w, 1) || near(logo.h, L.h, 1)));
  assert.ok(near(logo.x + logo.w / 2, 960) && near(logo.y + logo.h / 2, 420));
  const word = g.texts.find((x) => x.text === t('boot.loading'));
  assert.equal(word.cy, 700);
  assert.ok(word.y >= logo.y + logo.h, 'the word is below the logo');
  // the bar: an outline 480 wide and a fill of 30 percent (roundRectPath begins with an arcTo whose first x is x + w)
  const arcs = g.calls.filter((c) => c[0] === 'arcTo');
  const rights = arcs.map((c) => Math.round(c[1]));
  assert.ok(rights.includes(720 + 480), 'the track / outline reaches x 1200');
  assert.ok(rights.includes(Math.round(720 + 480 * 0.3)), `the fill reaches 30 percent (${[...new Set(rights)]})`);
  const barTop = BOOT_ART.bar.cy - BOOT_ART.bar.h / 2;
  assert.ok(barTop >= word.y + word.h - 4, 'the bar is below the word');
  assert.ok(inside({ x: 720, y: barTop, w: 480, h: 14 }, FIELD));
  assert.equal(BOOT_ART.bar.w, 480);
  assert.equal(BOOT_ART.bar.h, 14);
  assert.equal(BOOT_ART.bar.cy, 740);
});

test('boot: the bar follows the loader (0 with nothing loaded or no status, full when done); a broken status never breaks the frame', () => {
  const fill = (assets) => {
    const g = geometry('boot', { assets });
    return new Set(g.calls.filter((c) => c[0] === 'arcTo').map((c) => Math.round(c[1])));
  };
  assert.ok(!fill(bootStatus(0, 100)).has(720 + 1), 'nothing loaded: no fill');
  assert.ok(fill(bootStatus(100, 100)).has(1200));
  assert.equal(coreProgress(bootStatus(50, 100)), 0.5);
  assert.equal(coreProgress(bootStatus(0, 0)), 0, 'no total: 0');
  assert.equal(coreProgress({ status: () => { throw new Error('x'); } }), 0);
  assert.equal(coreProgress({ status: () => ({}) }), 0);
  assert.equal(coreProgress(bootStatus(500, 100)), 1, 'never above 1');
});

test('boot: without the logo picture (not loaded yet, failed, no assets) the word alone is drawn as before, at the middle, with no bar', () => {
  for (const assets of [createArtStub({ missing: ['logo_title'] }), undefined]) {
    const r = runScene('boot', { assets });
    assert.equal(digestCalls(r.calls), GOLDEN.scenes.boot.digest);
  }
});

// ------------------------------------------------------------------------------------------------------------------- practice halves (countdown, tuning)

test('countdown and tuning: the sliced fruit use sprites.menuHalf (art halves at menu scale) for both sides; no procedural half is painted', () => {
  for (const name of ['countdown', 'tuning']) {
    const sprites = makeSpriteStub({ withHalves: true });
    const r = runScene(name, { assets: createArtStub(), sprites });
    const calls = sprites.calls.filter((c) => c[0] === 'menuHalf');
    assert.deepEqual(calls.map((c) => c[2]).sort(), [-1, 1], `${name}: side +1 (half A) and -1 (half B)`);
    const halves = r.calls.filter((c) => c[0] === 'drawImage' && c[1].spriteKey && c[1].spriteKey.startsWith('half:'));
    assert.equal(halves.length, 2, `${name}: two art halves drawn`);
    for (const c of halves) assert.ok(near(c[4], c[1].width) && near(c[5], c[1].height), 'drawn 1:1, the entry is already at menu scale');
    const plain = runScene(name, { assets: undefined, sprites: makeSpriteStub() });
    assert.ok((plain.ctx.counts.clip ?? 0) > 0, `${name}: the procedural halves clip along the cut`);
    assert.ok((r.ctx.counts.clip ?? 0) < (plain.ctx.counts.clip ?? 0), `${name}: the art halves do not`);
  }
});

test('countdown: the halves are asked for at the mode fruit scale and the frame density', () => {
  const sprites = makeSpriteStub({ withHalves: true });
  runScene('countdown', { assets: createArtStub(), sprites, density: 1.5 });
  const [first] = sprites.calls.filter((c) => c[0] === 'menuHalf');
  assert.equal(first[1], 'watermelon');
  assert.equal(first[3], MENU_MODES[0].scale);
});

test('countdown: a half without art (menuHalf returns null for one side) is painted procedurally and the other keeps its art', () => {
  const sprites = makeSpriteStub({ withHalves: true });
  const original = sprites.menuHalf;
  sprites.menuHalf = (type, side, scale) => (side === 1 ? original(type, side, scale) : null);
  const r = runScene('countdown', { assets: createArtStub(), sprites });
  assert.equal(r.calls.filter((c) => c[0] === 'drawImage' && c[1].spriteKey && c[1].spriteKey.startsWith('half:')).length, 1);
  assert.ok((r.ctx.counts.clip ?? 0) > 0, 'the other half is procedural');
});

test('countdown and tuning: a throwing menuHalf never breaks the frame (the procedural half is drawn)', () => {
  for (const name of ['countdown', 'tuning']) {
    const sprites = makeSpriteStub({ withHalves: true });
    sprites.menuHalf = () => { throw new Error('boom'); };
    const r = runScene(name, { assets: createArtStub(), sprites });
    const plain = runScene(name, { assets: undefined, sprites: makeSpriteStub() });
    assert.equal(digestCalls(r.calls).length > 0, true);
    assert.equal(r.ctx.counts.clip, plain.ctx.counts.clip);
  }
});

// ------------------------------------------------------------------------------------------------------------------- confirm dialog

test('confirm dialog: nine-slice panel and two buttons, no glyph, no icon', () => {
  const g = geometry('confirm-quit');
  assert.deepEqual(g.images.map((i) => i.id).filter((id) => !id.startsWith('button_')), ['panel_9slice']);
  const P = CONFIRM_PANEL;
  const panel = g.images.find((i) => i.id === 'panel_9slice');
  assert.ok(near(panel.w, P.w) && near(panel.h, P.h));
  for (const tg of g.targets) assert.ok(inside(targetRect(tg), { x: P.x - P.w / 2, y: P.y - P.h / 2, w: P.w, h: P.h }, 20), `${tg.id} inside the panel`);
});
