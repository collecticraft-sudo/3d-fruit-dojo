// Art direction data: "Ink and Paper Dojo" (docs/game-design.md 11) as pure data. OWNER: Presentation engineer.
// Colours, font stacks and the per-fruit art table (design 4.1). No canvas access here, so it is importable anywhere.

/** Palette tokens (design 11.1). */
export const COLORS = Object.freeze({
  paper: '#EADFC8',
  paperLight: '#F4EBD9',
  paperShade: '#D8CAAE',
  paperGradientBottom: '#E6D8BC',
  ink: '#14141C',
  inkSoft: '#3A3A46',
  inkText2: '#4E4740',
  inkGrey: '#8A8175',
  vermilion: '#D9432B',
  vermilionDeep: '#A82A18',
  indigo: '#1F3A5F',
  gold: '#F2B134',
  goldShine: '#FFE28A',
  matcha: '#7BA05B',
  ice: '#7FD1F0',
  flame: '#F26A21',
  flameInner: '#FFC93C',
  teal: '#4A9E8A',
  sunPale: '#E9A08A',
  cream: '#FFF3D1',
  bombBody: '#22222B',
  bombFuse: '#8A6B3E',
  bombX: '#EADFC8',
});

/**
 * Font stacks (docs/restyle-direction.md 1.1, docs/typography.md). The first family of each stack is a small web font that ships in
 * public/assets/fonts/ and is loaded by fonts.js ("DojoDisplay" = Lilita One, "DojoUI" = Fredoka, both SIL OFL, Latin subsets); everything
 * after it is the system fallback that the canvas uses until the file is there, or for good when it is not (no file, `?fonts=0`, `?assets=0`,
 * a failed download). The display fallback puts "Arial Rounded MT Bold" before "Hiragino Maru Gothic ProN" (the direction has them the other way
 * round): on macOS the Hiragino face has one regular weight and draws the 800 of the button and banner styles as thin text, Arial Rounded is a
 * real bold. The Mincho serif stack of the first art round is retired. `serif` and `sans` are the old names of the same two stacks
 * (painters.js still reads `FONTS.sans`).
 */
const DISPLAY_STACK = '"DojoDisplay", "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Yu Gothic UI", system-ui, sans-serif';
const UI_STACK = '"DojoUI", ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONTS = Object.freeze({
  display: DISPLAY_STACK,
  ui: UI_STACK,
  serif: DISPLAY_STACK,
  sans: UI_STACK,
});

/**
 * Text styles ("roles", docs/restyle-direction.md 1.2). `size` is logical px at 1920 x 1080 and `weight` a CSS weight; minimum text size anywhere is
 * 28 px. `tracking` is letter spacing in em (the plain `drawText` ignores it unless asked; `drawStyled` and the banner and digit helpers apply
 * it), `minSize` the floor of the shrink-to-fit helpers (`fitText`; never below 28), `look` the default recipe of `drawStyled`
 * ('plain', 'banner', 'plate', 'popup', 'headline', 'numeral'; see draw-util.js).
 *
 * The display face has ONE weight. Its font strings still say 800 or 900: fonts.js registers the face for the range 100 to 900, so the browser
 * does not synthesise a bold, while the system fallback (Hiragino Maru Gothic, Arial Rounded) gets the bold it needs.
 *
 * The first-round names stay (hudNumber, hudTimer, popup44, popup64, banner84, banner110, banner132, bodyBold ...); `numeral` and `numeralTimer`
 * are the direction's names for the HUD digits and have the same values as `hudNumber` and `hudTimer`.
 * @type {Readonly<Record<string,{family:'display'|'ui', size:number, weight:number, tracking:number, minSize:number, look:string}>>}
 */
export const TEXT_STYLES = Object.freeze({
  display: Object.freeze({ family: 'display', size: 150, weight: 900, tracking: 0.01, minSize: 110, look: 'banner' }),
  headline: Object.freeze({ family: 'display', size: 72, weight: 800, tracking: 0.02, minSize: 56, look: 'headline' }),
  button: Object.freeze({ family: 'display', size: 56, weight: 800, tracking: 0.04, minSize: 36, look: 'plate' }),
  buttonSmall: Object.freeze({ family: 'display', size: 44, weight: 800, tracking: 0.04, minSize: 34, look: 'plate' }),
  buttonTiny: Object.freeze({ family: 'display', size: 36, weight: 800, tracking: 0.04, minSize: 34, look: 'plate' }),
  banner84: Object.freeze({ family: 'display', size: 96, weight: 900, tracking: 0.02, minSize: 67, look: 'banner' }),
  banner110: Object.freeze({ family: 'display', size: 128, weight: 900, tracking: 0.02, minSize: 90, look: 'banner' }),
  banner132: Object.freeze({ family: 'display', size: 160, weight: 900, tracking: 0.02, minSize: 112, look: 'banner' }),
  body: Object.freeze({ family: 'ui', size: 34, weight: 600, tracking: 0.005, minSize: 30, look: 'plain' }),
  bodyBold: Object.freeze({ family: 'ui', size: 34, weight: 700, tracking: 0.005, minSize: 30, look: 'plain' }),
  small: Object.freeze({ family: 'ui', size: 28, weight: 600, tracking: 0.01, minSize: 28, look: 'plain' }),
  hudNumber: Object.freeze({ family: 'display', size: 96, weight: 800, tracking: 0, minSize: 72, look: 'numeral' }),
  hudTimer: Object.freeze({ family: 'display', size: 60, weight: 800, tracking: 0, minSize: 44, look: 'numeral' }),
  numeral: Object.freeze({ family: 'display', size: 96, weight: 800, tracking: 0, minSize: 72, look: 'numeral' }),
  numeralTimer: Object.freeze({ family: 'display', size: 60, weight: 800, tracking: 0, minSize: 44, look: 'numeral' }),
  popup44: Object.freeze({ family: 'display', size: 48, weight: 800, tracking: 0.01, minSize: 36, look: 'popup' }),
  popup64: Object.freeze({ family: 'display', size: 72, weight: 800, tracking: 0.01, minSize: 36, look: 'popup' }),
  popupLabel: Object.freeze({ family: 'ui', size: 28, weight: 700, tracking: 0.06, minSize: 28, look: 'plain' }),
});

const fontCache = Object.create(null);
const fontSizedCache = new Map();

/** CSS font shorthand for a style, optionally with another size. Memoised: the default size allocates nothing per call. */
export function fontString(style, sizeOverride) {
  const s = TEXT_STYLES[style];
  if (sizeOverride === undefined || sizeOverride === s.size) {
    return fontCache[style] ?? (fontCache[style] = `${s.weight} ${s.size}px ${FONTS[s.family]}`);
  }
  const key = `${style}|${sizeOverride}`;
  let f = fontSizedCache.get(key);
  if (!f) {
    f = `${s.weight} ${sizeOverride}px ${FONTS[s.family]}`;
    fontSizedCache.set(key, f);
  }
  return f;
}

const spacingCache = new Map();

/**
 * CSS `letter-spacing` value of a role at a size, for `ctx.letterSpacing`: '1.5px' for tracking 0.04 em at 38 px. '0px' for a role with no
 * tracking. Memoised per (role, size), a lookup allocates nothing after the first call.
 */
export function letterSpacingPx(style, size) {
  const s = TEXT_STYLES[style];
  const px = s ? size ?? s.size : size ?? 0;
  const key = `${style}|${px}`;
  let v = spacingCache.get(key);
  if (v === undefined) {
    const em = s ? s.tracking : 0;
    v = `${Math.round(em * px * 100) / 100}px`;
    if (spacingCache.size > 400) spacingCache.clear();
    spacingCache.set(key, v);
  }
  return v;
}

/**
 * Per-fruit art table (design 4.1). r = visual body radius (matches CONFIG.fruits[].r; the game data stays the authority
 * for gameplay, this copy only drives drawing and the menu targets). `top` = how far above the body (in radii) decorations
 * extend, used to size sprites.
 */
export const FRUIT_ART = Object.freeze({
  watermelon: { r: 92, skin: '#4E9A48', skinDetail: '#2F6B32', flesh: '#E8455A', fleshDetail: '#14141C', rind: '#F4F1C8', juice: '#E8455A', top: 0.15 },
  pineapple: { r: 82, skin: '#E8A92B', skinDetail: '#B9781A', crown: '#4E9A48', flesh: '#F7DD5C', fleshDetail: '#F3EFA8', juice: '#F5D34B', top: 0.6 },
  apple: { r: 68, skin: '#D8412F', skinDetail: '#A82A18', stem: '#6B4A2B', leaf: '#4E9A48', flesh: '#F6EFD0', fleshDetail: '#5A3A22', juice: '#E8C04A', top: 0.55 },
  orange: { r: 68, skin: '#F28C1E', skinDetail: '#C96A0A', flesh: '#FFB23D', fleshDetail: '#FFD37A', juice: '#FF9A1F', top: 0.15 },
  pear: { r: 66, skin: '#B8C94A', skinDetail: '#8FA632', stem: '#6B4A2B', flesh: '#F4F0C6', fleshDetail: '#C9D64A', juice: '#C9D64A', top: 0.7 },
  peach: { r: 64, skin: '#F4A27E', skinDetail: '#E4644E', leaf: '#4E9A48', flesh: '#F9C86A', fleshDetail: '#8B4A2B', juice: '#F7A56A', top: 0.5 },
  lemon: { r: 60, skin: '#F6E04A', skinDetail: '#D1B62A', flesh: '#FBF3A6', fleshDetail: '#FFFBD0', juice: '#F2E24A', top: 0.3 },
  kiwi: { r: 58, skin: '#8B6B3E', skinDetail: '#6B4F2A', flesh: '#7BC043', fleshDetail: '#F2F7D0', seeds: '#14141C', juice: '#7BC043', top: 0.15 },
  strawberry: { r: 52, skin: '#E63946', skinDetail: '#F6E7A0', calyx: '#4E9A48', flesh: '#F7A9A8', fleshDetail: '#FDE8E4', juice: '#E63946', top: 0.45 },
  cherry: { r: 48, skin: '#B3122E', skinDetail: '#F26A7A', stem: '#6B4A2B', flesh: '#E85D75', fleshDetail: '#C79A6B', juice: '#B3122E', top: 1.1 },
});

/** Fruit type ids in catalogue order. */
export const FRUIT_IDS = Object.freeze(Object.keys(FRUIT_ART));

/** Golden apple art (design 4.2). */
export const GOLDEN_ART = Object.freeze({ r: 64, skin: '#F2B134', shine: '#FFE28A', flesh: '#FFF0B0', juice: '#F2B134', glowScale: 1.5, glowAlpha: 0.35 });

/** Bomb art (design 4.3). */
export const BOMB_ART = Object.freeze({ r: 64, body: '#22222B', sheen: '#3A3A46', band: '#A82A18', mark: '#EADFC8', fuse: '#8A6B3E', sparkCore: '#FFC93C', sparkHalo: '#F26A21', ring: '#D9432B' });

/** Power-up medallions (design 4.4). */
export const POWERUP_ART = Object.freeze({
  freeze: { r: 62, color: '#7FD1F0', inner: '#FFFFFF', label: 'freeze' },
  frenzy: { r: 62, color: '#F26A21', inner: '#FFC93C', label: 'frenzy' },
  double: { r: 62, color: '#F2B134', inner: '#F4EBD9', label: 'double' },
  clock: { r: 62, color: '#4A9E8A', inner: '#F4EBD9', label: 'clock' },
});

/** Juice colour for any object type (fruit id, 'golden', power-up ids, 'bomb' soot). Falls back to paper white. */
export function juiceColorOf(type) {
  if (FRUIT_ART[type]) return FRUIT_ART[type].juice;
  if (type === 'golden') return GOLDEN_ART.juice;
  if (POWERUP_ART[type]) return POWERUP_ART[type].color;
  if (type === 'bomb') return COLORS.ink;
  return COLORS.paperLight;
}

/** Ordered list of the ten juice colours (splat sprite variants are generated per entry). */
export const JUICE_COLORS = Object.freeze([...new Set([...Object.values(FRUIT_ART).map((f) => f.juice), GOLDEN_ART.juice])]);
