# Typography of 3D Fruit Dojo

Written 2026-10-01 by the Assets and typography engineer (restyle round, `docs/restyle-direction.md` section 1). Everything here is presentation: game logic, hit boxes, the 28 px minimum text size and the 84 px minimum targets do not change. Every font file is optional with a fallback.

## 1. What ships

| Role | Family name in the game | Font | Version, author | Licence | Shipped file | Size |
|---|---|---|---|---|---|---|
| Display: logo text, headlines, button labels, banners, countdown, rank, HUD numerals, popups | `DojoDisplay` | Lilita One | 1.002, Juan Montoreano | SIL OFL 1.1 | `public/assets/fonts/dojo-display.woff2` | 9.5 KB |
| UI: body, small text, hints, labels, toasts | `DojoUI` | Fredoka (variable, weight 500 to 700, width pinned to 100) | 2.001, Milena B. Brandao, Ben Nathan (Fredoka Project Authors) | SIL OFL 1.1 | `public/assets/fonts/dojo-ui.woff2` | 26.4 KB |

Total 36 KB (budget: each file under 400 KB, all fonts under 150 KB). The licence texts ship next to the files (`public/assets/fonts/OFL-lilitaone.txt`, `OFL-fredoka.txt`) and the sources are in `design/fonts/` (`src/` the full upstream TTF files, `licenses/`, `dist/` the subsets, `fonts.json` the list, `build-fonts.py` the tool that makes `dist/`, `specimen.html` the test sheet). Both fonts come from the Google Fonts open-source repository (`google/fonts`, folders `ofl/lilitaone` and `ofl/fredoka`), downloaded on 2026-10-01 with the owner's permission (at most six open-licence families, about 400 KB each, plus their OFL text).

The files are Latin subsets: U+0020 to 007E, U+00A0 to 00FF, en and em dash, the curly quotes, bullet, ellipsis and the minus sign U+2212 (the game writes "−50" and "−5 s" with it). Lilita One has no U+00A0 (a no-break space draws from the next font of the stack, same width within a pixel or two) and neither font has the check mark U+2713 of the calibration screen, which the system supplies. The game is English only; any other script falls to the system fonts.

The internal names of the shipped files are "Dojo Display" and "Dojo UI": a subset is a modified version and the OFL does not let a modified version keep a Reserved Font Name ("Lilita One"). Copyright, licence and designer records stay in the files. Credit line for the release notes: "Fonts: Lilita One by Juan Montoreano and Fredoka by the Fredoka Project Authors, both SIL Open Font License 1.1."

## 2. Why these two (and not Dela Gothic One)

The direction named Dela Gothic One first. Its file in the Google Fonts repository is 2.5 MB (Reggae One 2.1 MB, Rampart One 3.7 MB: they carry the Japanese character sets), and the owner's permission was for files of about 400 KB at most, so none of the three could be downloaded. Nothing was downloaded outside that permission. Six families that fit were fetched and looked at (`design/fonts/specimen.html`: the real strings "3D FRUIT DOJO", "Classic", "Play again", "Reset high scores", "No, keep playing", "COMBO x7!", "BOMB!", "GO!", "TIME'S UP!", "NEW RECORD!", "0123456789", "12,450", "+15", "-50", "Missed!", "Game over", paragraphs at 28 and 34 px; sizes 28 to 160 px; over paper, the night veil and the vermilion plate; headless Chrome on the owner's Mac):

| Candidate | Size of the file | Verdict |
|---|---|---|
| Titan One | 56 KB | very heavy and wide: "3D FRUIT DOJO" is 1122 px at 150 px; "Reset high scores" shrinks to 32 px on a button; lowercase is clumsy at small sizes. Rejected |
| Bowlby One | 60 KB | poster weight but the widest: the button labels fall to 28 to 30 px. Rejected |
| Paytone One | 115 KB | clean, well balanced, good numerals; about 15 percent wider than Lilita One (labels 36 px where Lilita gets 42). Runner-up |
| **Lilita One** | 28 KB | heavy, warm, slightly hand-cut shapes that sit well on the woodblock art, the narrowest of the four (0.43 em per character against 0.51 for the retired Mincho serif), so button labels get LARGER than before. "1" and "7" are clearly different, the "4" is open (a style), every needed glyph is there. **Chosen** |
| Fredoka | 159 KB variable | rounded, friendly, the same genre as Lilita One; 0.44 to 0.46 em per character at 600 and 700, 3 to 7 percent wider than the macOS system rounded sans it replaces (0.42 to 0.45) and the same as `system-ui`, so layouts hold; two texts wrap one line earlier (the Classic description on the menu, line 5 of the safety screen) and still fit. **Chosen** |
| Nunito | 277 KB variable | calmer and a little wider (0.45 to 0.49), the weights are close together and "°/s" runs into a "%" shape. Rejected for the small text |

Squint test (3 m, 28 px text): the 28 px text is the UI face (Fredoka 600), readable on paper and on the night veil with the paper stroke the screens already use. The display face is used from 34 px up. No third file was needed: the HUD digits use the display face in fixed cells (section 5).

## 3. Roles and stacks

`public/js/render/palette.js` holds both. `FONTS.display` and `FONTS.ui` start with the shipped family and continue with system fonts; `FONTS.serif` and `FONTS.sans` are the old names of the same stacks (`painters.js` still reads `FONTS.sans`). The Mincho stack is gone.

```
display  "DojoDisplay", "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Yu Gothic UI", system-ui, sans-serif
ui       "DojoUI", ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
```

The direction puts Hiragino Maru Gothic first in the display fallback. On macOS that face has one regular weight and draws the 800 of a button as thin text (seen with `?fonts=0`), so Arial Rounded MT Bold, a real bold, goes first.

Weights: Lilita One has one weight. The font strings still say 800 or 900 so that the system fallback is bold, and fonts.js registers the face for the range 100 to 900, so the browser has no reason to synthesise a bold (checked: the same text drawn at 400, 700, 800 and 900 is pixel-identical in `DojoDisplay`, and `DojoUI` is identical from 700 up because the axis stops at 700).

`TEXT_STYLES[role] = {family, size, weight, tracking, minSize, look}` (logical px at 1920 x 1080, tracking in em, minSize the floor of the fit helpers, never below 28):

| Role | Family | Size | Weight in the string | Tracking | minSize | Look |
|---|---|---|---|---|---|---|
| `display` | display | 150 | 900 | 0.01 | 110 | banner |
| `headline` | display | 72 | 800 | 0.02 | 56 | headline (ink fill, paper stroke 0.16 em) |
| `button` / `buttonSmall` / `buttonTiny` | display | 56 / 44 / 36 | 800 | 0.04 | 36 / 34 / 34 | plate |
| `banner84` / `banner110` / `banner132` | display | 96 / 128 / 160 | 900 | 0.02 | 0.7 x size | banner |
| `numeral` = `hudNumber`, `numeralTimer` = `hudTimer` | display | 96, 60 | 800 | 0 | 72, 44 | numeral |
| `popup44` / `popup64` | display | 48 / 72 | 800 | 0.01 | 36 | popup |
| `body` / `bodyBold` | ui | 34 | 600 / 700 | 0.005 | 30 | plain |
| `small` | ui | 28 | 600 | 0.01 | 28 | plain |
| `popupLabel` | ui | 28 | 700 | 0.06 | 28 | plain (uppercase by the caller) |

Deviations from the direction table: the headline stays 72 (direction 76) and the buttons stay 56 / 44 / 36 (direction 52 / 42 / 34), because Lilita One is narrower than the face the direction planned for, `test/ui` pins those sizes, and the real labels fit with room (section 6); the banners, numerals and popups take the direction's sizes. `numeral` and `numeralTimer` are new names with the values of `hudNumber` and `hudTimer`, which stay.

## 4. Loading (`public/js/render/fonts.js`)

`loadFonts({document, baseUrl, timeoutMs, FontFace, enabled})` makes one `FontFace` per file (`display: 'swap'`, weight range 100 to 900), awaits `face.load()` against a 2500 ms timeout per file, adds the face to `document.fonts` and returns `{loaded: [...], failed: [...]}`. It never rejects, never throws and never blocks a frame: the canvas draws the system stack until the file is there. When a family becomes usable `fontsGeneration()` goes up and `onFontsChange` listeners run, because the canvas font string is identical before and after the file arrives; `draw-util.js` subscribes `invalidateTextCaches`, which empties the plate widths, the wrapped lines, the fitted sizes, the digit cells and the baked text sprites. A file that arrives after the timeout is still added and still triggers the switch. `fontsStatus()` (`idle`, `loading`, `ready`, `failed`, `off`), `fontUsable(family)`, `fontsReady()` (a promise, resolved once the first attempt settled) and `FONT_FILES` (the list, tested against the manifest) complete the API.

**Wiring (final integration, 2026-10-01).** `app.js` calls `loadFonts({document, enabled: flags.fonts, baseUrl})` as soon as the art loader exists, before the first frame, and the boot wait (`waitForCore`, capped at the loader's 2.5 s) waits for the art group `core` AND `fontsReady()`, so the first menu frame is drawn with the final text. The fallback path stays: `draw-util.js` still calls `ensureFontsStarted()` on the first text drawn, which does the same from the browser globals when `app.js` did not (it does nothing in Node), and the promise is shared. `?fonts=0` (also `off`, `false`, `no`; parsed by `flags.js`, field `fonts`) and `?assets=0` skip the files and keep the system fonts (checked in Chrome by `test/e2e/art.test.js`: no font file is requested, `__ninja.getAssets().fonts.state` is `off`, every screen draws). `widgets.js` drops its cached label art when a font arrives late (`onFontsChange`), so sizes measured with the fallback never outlive it. Without a `FontFace` (Node, an old browser) the loader answers "failed" and the system fonts stay. There is deliberately NO `<link rel="preload">` in `index.html`: a preload would request `/assets/fonts/` also under `?assets=0` and `?fonts=0`, which the e2e test forbids, and the module graph is on the page in a few milliseconds anyway. Without a `FontFace` (Node, an old browser) the loader answers "failed" and the system fonts stay.

Measured in Chrome on the local server (resource timing): the two files finish at about 136 ms after navigation, together with the first UI pictures (logo 141 ms) and before the menu backdrop (211 ms), so the first menu frame already uses them; on a slow disk or network the system stack is drawn until they arrive.

## 5. Drawing text (`public/js/render/draw-util.js`)

Existing calls keep working: `drawText` without `look` draws exactly what it always drew (stroke, then fill). The new part:

- `drawText(ctx, text, x, y, {look, tint, tracking, shadow, ...})` with a `look` other than `'plain'`, or `drawStyled` directly: `look` is `'banner'` (hard offset shadow of the outlined glyphs (0.04, 0.07 em) in ink at 0.9, ink stroke 0.15 em, vertical gradient fill), `'plate'` (button label: paper-light fill, ink stroke 0.10 em, maroon `#5A1409` shadow 2 px right and 3 px down, tracking 0.04 em), `'popup'` (banner shadow and a 0.16 em stroke, flat fill from `fill`), `'headline'`, `'numeral'` (ink fill, paper stroke, no shadow). `tint` picks the gradient: `gold` (default), `vermilion`, `ice`, `paper` (`TEXT_TINTS`). Explicit `fill`, `stroke`, `strokeWidth` win over the look; `shadow: false` and `tracking: 0` turn those off. The shadow is a stroked and filled copy: a plain filled copy at 0.07 em is hidden under a 0.075 em stroke. The gradient is created once per tint and size and kept per context (never per frame); the call does one `save` and `restore`; no `shadowBlur`, no `filter`. Letter spacing uses `ctx.letterSpacing` where the context has it and puts it back to 0.
- `bakeTextSprite(createCanvas, key, text, {style, size, look, tint, fill, density, maxWidth, tracking})` returns `{canvas, w, h, ax, ay, size}` (anchor: middle of the baseline); a frame then pays `ctx.drawImage(s.canvas, x - s.ax, y - s.ay, s.w, s.h)`. 48 entries and 24 MB of pixels, least recently used out (the newest always stays), cleared on a font change. Pass a prebuilt `key` for a hot path (a hit then allocates nothing).
- `fitText(ctx, text, font, maxWidth, minSize, trackingEm)` returns the largest integer size that fits (never below 28 or `minSize`); measured once per (font, width, text), later calls are three Map lookups.
- `drawDigits(ctx, str, x, y, {style, size, align, scale, fill, stroke, look, tint})` draws digit by digit in cells as wide as the widest of 0 to 9, with `,` `:` `.` at 0.45 cell, so a counting score never jitters (`digitsWidth` measures the same). `scale` pops about the anchor. The HUD (`hud.js`, not mine) still draws its numbers with `drawText`; `drawDigits` is ready for it.
- `invalidateTextCaches()`, `easeOutExpo`, `easeInCubic`, `easeInOutSine` (the effects code has its own `ease.js` with the same curves).
- `palette.js`: `fontString(role, size?)` (unchanged), `letterSpacingPx(role, size)`.

## 5.1 Budgets

No gradient, string, array or object is created per frame by a cached call (tested: one gradient for 200 draws, no canvas for a sprite hit, no measurement for a fit hit); `drawStyled` makes one `save` and `restore` per call and `drawDigits` one per character, so a HUD of eleven characters stays far below the 40 a frame. Font weight: 36 KB. Text sprite memory: a 160 px banner sprite is about 1000 x 270 logical px, 4 MB at density 2, so `bakeTextSprite` also keeps all sprites under 24 MB (the direction's budget) besides the 48 entries; cache only what repeats.

## 6. Does the text fit? (measured in Chrome with the shipped fonts)

Every real label of every button target (48 label and button pairs of `test-support/ui/art-checks.js`, the plate width from `widgets.js`, the fit loop of `fitLabelFont`): none is wider than its plate at the size it ends up with, none is below 32 px (before: 28 px minimum, 12 labels at 36), none is smaller than it was with the Mincho serif; 12 labels are at the full 56 px of the primary button. The tightest are "Connect Joy-Con" (52 px, 380 of 380.3 px), "Connect Joy-Con (native bridge)" (42 px, 588 of 588.9), "Default values" (42 px, 257 of 261) and "Read carefully…" (54 px, 381 of 389): they fit because the fit loop shrinks them; if a label is lengthened it will shrink further rather than overflow, down to 28 px, and then the browser condenses it (the safety net of `drawButton`). Other measurements at the real sizes: the title text "3D FRUIT DOJO" 992 px at 150 px (the logo picture is what the menu shows), "Connect your Joy-Con" 683 px at 72, "Joy-Con disconnected" 608 px at 64, "GAME OVER" 849 px at 160, "GOLDEN APPLE! +100" 1175 px at 128 and 661 px at 72, the HUD timer "0:00" 88 px in fixed cells at 40 px (the ring hole is 108 px), the score "12,450" 334 px in cells at 96 px, the longest `small` string ("Joy-Con battery almost empty") 386 px. Nothing needed a note for the UI engineer on width grounds.

## 7. Adding, replacing or rebuilding a font

1. Put the upstream TTF in `design/fonts/src/` and its OFL text in `design/fonts/licenses/` (a font without a licence file does not build). Respect the size limits: a file you download should stay near 400 KB, the shipped subset far below.
2. Add an entry to `design/fonts/fonts.json` (`id`, `family` letters and digits only, `file` lower case `.woff2`, `weight` range, `source`, `license`, `licenseFile`, and `axes` to pin a variable font). Add the family to `FONT_FILES` in `public/js/render/fonts.js` and to the stacks in `palette.js`.
3. `python3 design/fonts/build-fonts.py` (needs Python fontTools 4.62 and brotli, installed by you; nothing at game time needs them) writes `design/fonts/dist/*.woff2`: it pins variable axes, subsets to the Latin ranges, keeps `kern` and `liga`, drops hinting and renames the family inside the file (see the header of the script for the equivalent `pyftsubset` call).
4. `npm run build:assets` copies the files and licences to `public/assets/fonts/`, records family, size, sha256, source and licence in `manifest.json` (`fonts`, `fontBytes`, `fontBudget`) and in `PROVENANCE.csv` (rows `font_<id>`), and refuses a file that is not WOFF2, is over 400 KB, has no licence or pushes the fonts over 150 KB. `npm run build:assets -- --check` and `test/assets` catch a file that no longer matches.
5. `node test-support/ui/record-digests.mjs` shows which recorded UI digests the new fonts changed; `--write` re-records them (on purpose only).

Delivery: `server.js` serves `.woff2` as `font/woff2` (final integration; pinned in `test/assets/server-assets.test.js`), with the same `no-cache` plus weak ETag rules as every file under `/assets/`. The Content-Security-Policy has no `font-src`, so `default-src 'self'` applies: the fonts are same-origin and nothing else is allowed.

## 8. Tests

`test/render/fonts.test.js` (the loader with a fake `FontFace`: success, failure, timeout, late arrival, listeners, idempotence, `?fonts=0`, no browser), `test/render/typography.test.js` (roles, looks, shadow, gradient made once, fit, digits in cells, baked sprites, cache invalidation, `drawText` unchanged), `test/assets/fonts-pipeline.test.js` (the font step of the build), `test/assets/manifest.test.js` and `provenance.test.js` (the files, hashes, licences, budget, FONT_FILES against the manifest, the stacks).
