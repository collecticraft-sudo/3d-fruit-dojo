// Art configuration: data only, one place for every tunable number of the AI-generated art layer. OWNER: Asset engineer
// (created by the Architect of the art integration, docs/assets-integration.md 1.10; the Asset engineer may add keys, never rename).
//
// Nothing here changes game rules. The art is optional everywhere: if an asset is missing the procedural drawing runs unchanged.

export const ART_CONFIG = Object.freeze({
  /** Folder of the shipped assets, relative to the page (server root is public/). */
  baseUrl: 'assets/',

  /** Loader (docs/assets-integration.md 2). Times in ms. */
  loader: Object.freeze({
    concurrency: 4,
    manifestTimeoutMs: 4000,
    imageTimeoutMs: 15000,
    layerTimeoutMs: 30000,
    /** How long the Integrator waits for group `core` before it lets the game start with the procedural art (it keeps loading). */
    bootWaitMs: 2500,
    scaledCacheMaxEntries: 160,
    scaledCacheMaxBytes: 64 * 1024 * 1024,
  }),

  /**
   * Controller glyphs on the connect screen and the disconnect overlay (docs/assets-integration.md 9.1).
   * `enabled: false` hides the two controller pictures (joyconL and joyconR) and nothing else. `ids` is the swap table: point an id at
   * another asset (for example a recoloured file added later) and no code changes. The mouse, keyboard and sync glyphs are not
   * controller pictures and stay on regardless of `enabled`; they can be swapped through `ids` as well.
   * OFF by default since art review round 1 (finding M5): the two generated pictures are slim rounded controllers with a top tab, a thumbstick
   * and a four-button diamond in the real layout, both red: close copies of a real Joy-Con, where the brief asked for generic glyphs. Turn it
   * on again only after `ids.joyconL` and `ids.joyconR` point at replacements that drop the stick, the diamond and the tab (docs/contract-notes.md).
   */
  glyphs: Object.freeze({
    enabled: false,
    ids: Object.freeze({
      joyconL: 'glyph_joycon_l',
      joyconR: 'glyph_joycon_r',
      mouse: 'glyph_mouse',
      keyboardEnter: 'glyph_keyboard_enter',
      sync: 'glyph_sync_button',
    }),
  }),

  /** Stage layers behind the gameplay (docs/assets-integration.md 4). */
  stage: Object.freeze({
    /** Layers are drawn 4.17 % larger than the playfield (2000 x 1125 logical px, centred) so that shake and parallax never show an edge. */
    overscanPx: 40,
    /** Fraction of the game layer's shake offset and zoom punch that each layer follows (1 = moves with the gameplay). */
    parallax: Object.freeze({ far: 0.25, mid: 0.55, near: 1 }),
    /** Slow drift, on the night stage only (menu, connect, safety, calibration, settings, tuning, boot). Off with Reduce motion. */
    drift: Object.freeze({ midPx: 4, nearPx: 8, periodS: 45 }),
    crossfadeMs: 400,
    /**
     * Veil over the night stage so that the ink text of those screens stays readable (alpha of `color`). The menu value was 0.45 (an estimate);
     * measured on the composed night stage the secondary text colour needs at least 0.56 of a veil to reach the 3:1 large-text contrast
     * (test/render/stage-readability.test.js). Since art review round 1 (M3) the veil is tinted (`color`, a pale blue-grey) instead of paper, so
     * that the indigo night stays blue instead of turning into a muddy grey; the strength is measured again in the same test.
     */
    veil: Object.freeze({ menu: 0.5, other: 0.52, color: '#C9D3E8' }),
    /**
     * Rectangles [x0, y0, x1, y1] (logical field px, the 1920 x 1080 frame) cut out of one layer when it is drawn (art review round 1, M1). The
     * Arcade near layer keeps its two thin posts (x up to 36 and from 1885) and loses the two lantern clusters, which are glossy, ink outlined and
     * fruit coloured and hang exactly where fruit and the score block are. The cut lines run through transparent pixels of the shipped layer (a test
     * reads the alpha along them); a replacement layer must keep that or move the rectangles.
     */
    erase: Object.freeze({
      arcade: Object.freeze({ near: Object.freeze([Object.freeze([37, -30, 400, 440]), Object.freeze([1540, -30, 1884, 440])]) }),
    }),
    /**
     * A paper haze over the lower part of a stage, between the mid and the near layer (art review round 1, M2): alpha 0 at y `from`, `alpha` at y
     * `to`, constant below. The dark ridge (Classic), rooftops (Arcade) and slate rocks (Zen) sit where every fruit and every bomb falls through; a
     * near-black bomb needs a ground that is not near black. Measured on the composed stages (test/render/stage-readability.test.js).
     */
    lift: Object.freeze({
      classic: Object.freeze({ alpha: 0.2, from: 640, to: 780 }),
      arcade: Object.freeze({ alpha: 0.3, from: 640, to: 780 }),
      zen: Object.freeze({ alpha: 0.2, from: 640, to: 780 }),
    }),
    /**
     * Soft discs of one colour over the far layer, [{x, y, r, alpha, color}] in logical field px (art review round 1, M3): the moon of the night
     * stage is the brightest thing on every menu screen and competes with the text next to it. Full colour to 0.8 r, fading out at 1.25 r.
     */
    dim: Object.freeze({
      menu: Object.freeze([Object.freeze({ x: 1672, y: 163, r: 120, alpha: 0.4, color: '#1F3A5F' })]),
    }),
    /** Strength of the paper haze at the left and right edges of each stage (stage.js CALM_STOPS; 0 switches it off; the night stage is veiled instead). */
    calm: Object.freeze({ classic: 0.06, arcade: 0.12, zen: 0.1, menu: 0 }),
    /** Alpha multiplier per layer, the knob for "too loud near layer" (bamboo, lanterns, petals). */
    layerAlpha: Object.freeze({
      classic: Object.freeze({ far: 1, mid: 1, near: 0.85 }),
      arcade: Object.freeze({ far: 1, mid: 1, near: 0.8 }),
      zen: Object.freeze({ far: 1, mid: 1, near: 0.8 }),
      menu: Object.freeze({ far: 1, mid: 1, near: 1 }),
    }),
    /** The pre-composed backdrop never exceeds this many device pixels per logical pixel (2560 px wide at 2000 logical px). */
    compositeMaxDensity: 1.28,
    /** Decoded layer sets kept at once (current stage plus the one that is fading out). */
    maxResidentStages: 2,
  }),

  /** One-shot sprites of the gameplay fx (docs/assets-integration.md 3.6 and 3.7). */
  fx: Object.freeze({
    /** Restyle (docs/restyle-direction.md 2.4): the explosion picture is 8 bomb radii wide (was 6), opaque until 480 ms and gone at 700 ms. */
    explosionWidthInRadii: 8,
    explosionMs: 700,
    explosionMsReduced: 300,
    explosionAlphaReduced: 0.7,
    burstsCap: 6,
    /** Ink brush under the blade trail: NOT drawn any more (it rendered as a grey striped wing, direction 2.7); the keys stay for the tests and a later tinted version. */
    trailBrushWidthK: 1.6,
    trailBrushAlpha: 0.22,
    trailBrushMinLenPx: 40,
  }),
});
