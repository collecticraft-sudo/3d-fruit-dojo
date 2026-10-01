// The asset table of the art pipeline (docs/assets-integration.md 1.1 and Appendix A). OWNER: Asset engineer.
//
// ONE data table for tools/build-assets.mjs. Every image that can ship has one row here. What a human decides lives in this file:
// the target size, which asset ships, the body circles, the slice margins, the label insets, the toggle cells, the timer ring geometry,
// the cursor pivots, the fuse tip. What a machine can measure is NOT written here: `contentBox`, `bytes`, `width`, `height`, the
// alpha centroids, the slice-flash axis and the stage luminance are computed by the build from the shipped files.
// `node tools/build-assets.mjs --measure` prints what the pixels say next to the numbers below.
//
// Coordinates are pixels of the SHIPPED file (origin top-left, y down). This module is data only: it imports nothing.

/** Fruit ids in catalogue order (the order of `FRUIT_ART` in public/js/render/palette.js), plus the golden apple last. */
export const FRUIT_TYPES = Object.freeze(['watermelon', 'pineapple', 'apple', 'orange', 'pear', 'peach', 'lemon', 'kiwi', 'strawberry', 'cherry', 'golden']);

/** Preload order of the fruit (contract 2.3): the menu fruit and the countdown split first, then the rest in catalogue order. */
export const FRUIT_LOAD_ORDER = Object.freeze(['watermelon', 'orange', 'pear', 'pineapple', 'apple', 'peach', 'lemon', 'kiwi', 'strawberry', 'cherry', 'golden']);

export const POWERUPS = Object.freeze(['freeze', 'frenzy', 'double', 'clock']);
export const STAGES = Object.freeze(['classic', 'arcade', 'zen', 'menu']);
export const BUTTON_STATES = Object.freeze(['default', 'focused', 'pressed', 'disabled']);

/** Game collision radii in logical px (mirrors FRUIT_ART, GOLDEN_ART, BOMB_ART and POWERUP_ART of public/js/render/palette.js; a test compares them). Overlay only. */
export const GAME_RADIUS = Object.freeze({
  watermelon: 92, pineapple: 82, apple: 68, orange: 68, pear: 66, peach: 64, lemon: 60, kiwi: 58, strawberry: 52, cherry: 48, golden: 64, bomb: 64, medallion: 62,
});

/**
 * Shape correction of tall fruit (contract 1.5): the measured body radius is divided by `fit`, so tall fruit are drawn a little smaller
 * and their visible body stays close to the hit circle. Used by `--measure` to compute the expected body radius.
 */
export const FRUIT_FIT = Object.freeze({
  watermelon: 1, pineapple: 0.86, apple: 1, orange: 1, pear: 0.92, peach: 1, lemon: 0.93, kiwi: 0.95, strawberry: 0.95, cherry: 1, golden: 1,
});

/**
 * The body circle of every fruit whole, the bomb, the medallions and the cursors: `cx`, `cy`, `r` in shipped px, `r` already divided by `fit`.
 * Seeds of Appendix A.1 and A.2 of the contract, checked against `--measure` (opening of radius 40, contract 1.5) and against the
 * overlay sheet (`--overlay`): the radii of the ten fruit are the measured ones to 0.1 px, the golden apple and the bomb keep the
 * contract seeds because the flat opening measure is pulled towards the stem collar and the leaf there (docs/assets.md).
 */
export const BODY = Object.freeze({
  fruit_watermelon_whole: Object.freeze({ cx: 256, cy: 256, r: 187 }),
  fruit_pineapple_whole: Object.freeze({ cx: 255, cy: 299, r: 142 }),
  fruit_apple_whole: Object.freeze({ cx: 256, cy: 283, r: 163 }),
  fruit_orange_whole: Object.freeze({ cx: 256, cy: 256, r: 190 }),
  fruit_pear_whole: Object.freeze({ cx: 255, cy: 302, r: 146 }),
  fruit_peach_whole: Object.freeze({ cx: 257, cy: 274, r: 172 }),
  fruit_lemon_whole: Object.freeze({ cx: 256, cy: 256, r: 164 }),
  fruit_kiwi_whole: Object.freeze({ cx: 256, cy: 259, r: 183 }),
  fruit_strawberry_whole: Object.freeze({ cx: 255, cy: 258, r: 159 }),
  fruit_cherry_whole: Object.freeze({ cx: 244, cy: 348, r: 99 }),
  fruit_golden_whole: Object.freeze({ cx: 257, cy: 262, r: 172 }),
  bomb_whole: Object.freeze({ cx: 237, cy: 318, r: 154 }),
  medallion_freeze: Object.freeze({ cx: 256, cy: 257, r: 212 }),
  medallion_frenzy: Object.freeze({ cx: 256, cy: 257, r: 212 }),
  medallion_double: Object.freeze({ cx: 256, cy: 257, r: 212 }),
  medallion_clock: Object.freeze({ cx: 256, cy: 257, r: 212 }),
  cursor_idle: Object.freeze({ cx: 112, cy: 146, r: 109 }),
  cursor_cutting: Object.freeze({ cx: 104, cy: 144, r: 100 }),
});

/** Multiplier on the whole's scale for the two halves of a fruit (contract 1.6): 1 except the golden apple, whose halves are drawn larger. */
export const HALF_SCALE = Object.freeze({ golden: 0.91 });

/** Nine-slice and three-slice margins in shipped px (contract 1.4, 5.2, 5.4, Appendix A.3). `t = b = 0` means horizontal three-slice. */
export const SLICE = Object.freeze({
  button_primary: Object.freeze({ l: 190, r: 190, t: 0, b: 0 }),
  button_secondary: Object.freeze({ l: 160, r: 160, t: 0, b: 0 }),
  panel_9slice: Object.freeze({ l: 48, r: 48, t: 48, b: 48, scale: 0.5 }),
});

/**
 * Safe text rectangle of a button as insets from the REFERENCE (default state) contentBox, in shipped px. The measured plate of the
 * primary button is x 97 to 728 (l 94, r 109) and of the secondary one x 122 to 723 (l 119, r 114); the insets keep a margin inside.
 */
export const LABEL = Object.freeze({
  button_primary: Object.freeze({ l: 110, r: 110, t: 46, b: 46 }),
  button_secondary: Object.freeze({ l: 125, r: 125, t: 56, b: 56 }),
});

/** The two cells of a toggle as fractions (0..1) of its contentBox (measured cell interiors x 27 to 409 and 429 to 812 of a 840 px file). */
export const TOGGLE_CELLS = Object.freeze([
  Object.freeze({ x: 0.03, y: 0.11, w: 0.45, h: 0.78 }),
  Object.freeze({ x: 0.52, y: 0.11, w: 0.45, h: 0.78 }),
]);

/** The same for `toggle_focused`, whose amber halo makes the contentBox bigger: measured cell interiors x .048 to .488 and .512 to .953, y .144 to .860. */
export const TOGGLE_CELLS_FOCUSED = Object.freeze([
  Object.freeze({ x: 0.05, y: 0.15, w: 0.43, h: 0.7 }),
  Object.freeze({ x: 0.52, y: 0.15, w: 0.43, h: 0.7 }),
]);

/** Geometry of the donut of `timer_ring` in shipped px (contract 5.5), measured on the centre row and column. */
export const TIMER_RING = Object.freeze({ cx: 256, cy: 254, outer: 253, bandMid: 203, bandHalf: 31, hole: 153 });

/** The centre of the spark at the end of the bomb fuse (contract 3.1). */
export const BOMB_FUSE_TIP = Object.freeze({ x: 383, y: 88 });

/** Layer widths per stage layer (contract 1.3). The build may fall back to 1920 x 1080 for mid and near, see `--layer-width`. */
export const LAYER_SIZES = Object.freeze({
  far: Object.freeze({ w: 2560, h: 1440 }),
  mid: Object.freeze({ w: 2048, h: 1152 }),
  near: Object.freeze({ w: 2048, h: 1152 }),
});

/**
 * Build the ordered list of asset rows. Every row:
 *   id        design id and file base name
 *   dir       folder under design/ and under public/assets/
 *   kind      manifest kind (fruit, half, splash, bomb, medallion, fx, icon, glyph, ui, logo, layer)
 *   group     'core' or 'stage:<id>'
 *   format    'png' or 'jpg'
 *   ship      false = listed in PROVENANCE.csv with shipped=no and not written
 *   size      target size: {w, h} (both), {w} (height keeps the aspect), or null (unchanged canvas)
 *   role      measurement recipe: 'body' (anchor = body centre), 'centroid' (anchor = alpha centroid), 'explicit' (anchor = body cx, cy),
 *             'box' (anchor = centre of the contentBox, the default), plus 'axis' for the slice flash
 *   body, halfScale, ref, slice, label, cells, ring, points  the human-decided extras of the manifest entry
 * The order of the rows is the manifest order and therefore the preload order of group `core` (contract 2.3); stage groups follow.
 */
export function buildSpec() {
  const rows = [];
  const add = (row) => rows.push({ format: 'png', ship: true, size: null, role: 'box', group: 'core', ...row });

  // 1. UI kit and logo first (contract 2.3)
  add({ id: 'logo_title', dir: 'ui', kind: 'logo', size: { w: 1400, h: 714 } });
  add({ id: 'panel_9slice', dir: 'ui', kind: 'ui', size: { w: 512, h: 512 }, slice: SLICE.panel_9slice });
  for (const variant of ['primary', 'secondary']) {
    for (const state of BUTTON_STATES) {
      const id = `button_${variant}_${state}`;
      add({
        id, dir: 'ui', kind: 'ui', slice: SLICE[`button_${variant}`], label: LABEL[`button_${variant}`],
        ...(state === 'default' ? {} : { ref: `button_${variant}_default` }),
      });
    }
  }
  for (const id of ['cursor_idle', 'cursor_cutting']) add({ id, dir: 'ui', kind: 'ui', role: 'explicit', body: BODY[id] });
  for (const symbol of ['minus', 'plus']) {
    for (const state of BUTTON_STATES) {
      add({ id: `stepper_${symbol}_${state}`, dir: 'ui', kind: 'ui', ...(state === 'default' ? {} : { ref: `stepper_${symbol}_default` }) });
    }
  }
  for (const id of ['toggle_off', 'toggle_on', 'toggle_focused']) add({ id, dir: 'ui', kind: 'ui', cells: id === 'toggle_focused' ? TOGGLE_CELLS_FOCUSED : TOGGLE_CELLS });
  add({ id: 'timer_ring', dir: 'ui', kind: 'ui', ring: TIMER_RING });
  add({ id: 'meter_bar', dir: 'ui', kind: 'ui', ship: false });

  // 2. Fruit: whole, half_a, half_b per fruit in preload order
  for (const type of FRUIT_LOAD_ORDER) {
    add({ id: `fruit_${type}_whole`, dir: 'sprites', kind: 'fruit', role: 'body', body: BODY[`fruit_${type}_whole`], ...(type === 'golden' ? { goldenBody: true } : {}) });
    for (const half of ['half_a', 'half_b']) add({ id: `fruit_${type}_${half}`, dir: 'sprites', kind: 'half', halfScale: HALF_SCALE[type] ?? 1 });
  }
  add({ id: 'bomb_whole', dir: 'sprites', kind: 'bomb', role: 'body', body: BODY.bomb_whole, points: { fuseTip: BOMB_FUSE_TIP } });
  for (const id of POWERUPS) add({ id: `medallion_${id}`, dir: 'sprites', kind: 'medallion', role: 'body', body: BODY[`medallion_${id}`] });
  for (const type of FRUIT_LOAD_ORDER) add({ id: `fx_splash_${type}`, dir: 'sprites', kind: 'splash', size: { w: 384, h: 384 } });
  add({ id: 'fx_bomb_explosion', dir: 'fx', kind: 'fx', size: { w: 768 }, role: 'centroid' });
  add({ id: 'fx_slice_flash', dir: 'fx', kind: 'fx', size: { w: 768 }, role: 'centroid', axis: true });
  add({ id: 'fx_blade_trail_tex', dir: 'fx', kind: 'fx', size: { w: 1024 } });
  for (const name of ['life_full', 'life_empty', 'combo', 'trophy', 'warning', 'freeze', 'frenzy', 'double', 'clock']) {
    add({ id: `icon_${name}`, dir: 'icons', kind: 'icon', size: { w: 256, h: 256 } });
  }
  for (const name of ['joycon_l', 'joycon_r', 'mouse', 'keyboard_enter', 'sync_button']) add({ id: `glyph_${name}`, dir: 'icons', kind: 'glyph', size: { w: 256, h: 256 } });

  // 3. Stage layers, one group per stage (contract 2.3)
  for (const stage of STAGES) {
    for (const layer of ['far', 'mid', 'near']) {
      add({ id: `bg_${stage}_${layer}`, dir: 'backgrounds', kind: 'layer', group: `stage:${stage}`, format: layer === 'far' ? 'jpg' : 'png', layer, stage });
    }
  }
  return rows;
}

/** File name of a row inside its folder. */
export const fileNameOf = (row) => `${row.id}.${row.format}`;
