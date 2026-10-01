# Restyle direction: "Ink and Paper Dojo", turned up

Art and motion director, restyle round. Everything here is presentation: game logic, RNG streams, snapshots, hit boxes, 28 px text and 84 px targets do not change. Every new image or font is optional with a fallback. Numbers are starting values to tune by eye; the numbers marked MUST are not.

## 0. What the game looks like now (seen on port 8271, ?input=sim, manual clock)

- Menu: the Higgsfield logo and the fruit are great. The type is not: "Classic / Arcade / Zen" and "Game over" are a thin Mincho serif (Hiragino) next to a generic system rounded sans; the two never feel like one family, and on non-Mac machines both fall to Georgia and Segoe UI. Buttons are a paper strip with a tiny rotated plate, the label on it is small and low in weight.
- Slice: the splat decal is good. The droplets are 3 to 8 px and vanish in the paper noise; the popup "+15" is 44 px thin sans with a 5 px stroke and is hard to read on a splat; no flash is visible at normal speed.
- Blade: the brush texture under the polygon renders as a grey-brown striped wing and is the ugliest thing on screen. The coloured polygon is dull; on the night stage and on paper it has no contrast edge.
- Bomb: sprite and explosion art are fine but small (6 radii); "BOMB!" is thin serif at 110 px; no ring, no red vignette visible 120 ms after the hit; the soot is lost.
- Results: flat panel, the rank seal is a plain red square with a 20 px word, no motion. HUD score "0" is 84 px but plain; timer ring is good art with plain digits.
- The backdrops are calm and static: keep that (design 11.6). All drama goes into foreground effects that never cover fruit, bombs or the blade.

The three rules of the whole restyle: (1) fruit, bombs and the blade are always the highest-contrast, highest-saturation things; effects sit behind them or are brief; (2) one big thing at a time (a banner, a flash and a shake together only for bomb, x7+ and game over); (3) every effect has a reduce-flashes and a reduce-motion twin, listed per effect below.

## 1. Typography

### 1.1 Families (cap: 2 files, a 3rd only if the specimen test fails; each file under 400 KB, target under 60 KB; total under 150 KB)

| Role of the file | First choice | Evaluate against | File |
|---|---|---|---|
| DISPLAY: title, headlines, buttons, banners, countdown, rank, HUD numerals, popups | **Dela Gothic One** (OFL, heavy Japanese poster gothic, wide Latin caps, reads as woodblock signage) | Reggae One (brushier), Titan One, Lilita One (rounder, game-like), Rampart One (inline, too busy at 28 px: reject for text under 60 px) | `dojo-display.woff2`, Latin subset (U+0020-007E, U+00A0-00FF, U+2013-2014, U+2018-201D, U+2026, U+00D7), expected 10 to 30 KB |
| UI: body, small, hints, stats labels, toasts | **Fredoka** variable (OFL, rounded, friendly, weights 500 to 700, digits near-uniform) | Nunito (calmer), M PLUS Rounded 1c, Zen Maru Gothic (JP glyphs not needed: the game is English) | `dojo-ui.woff2`, wght 500..700 axis kept, same Latin subset, expected 25 to 60 KB |

Decision method (Assets engineer, 15 minutes max): render one specimen sheet per candidate (`design/fonts/specimen.html`, not shipped): "3D FRUIT DOJO", "COMBO x7!", "Classic", "Play again", "BOMB!", "+1250", "0123456789", "Time's up!" at 28, 44, 72, 132 px over paper `#EADFC8`, over the night veil and on the vermilion plate. Reject anything whose 28 px text is not instantly readable at 3 m (squint test), whose "1" and "7" are alike, or whose file exceeds the cap. Keep Dela Gothic One unless the sheet shows a clear failure. Source: the google/fonts repository or fonts.google.com download; subset once with `pyftsubset ... --flavor=woff2 --layout-features=kern,liga` (dev-time tool only, never at runtime; record the exact command, version and licence in `design/fonts/README.md`; ship `OFL.txt` per family in `public/assets/fonts/`; add both files to PROVENANCE.csv and the manifest with size and sha256). If the files cannot be obtained, nothing breaks: the fallback stacks below are used.

Fallback stacks (data in `palette.js` FONTS): display `"DojoDisplay", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Yu Gothic UI", system-ui, sans-serif` (weight 800); ui `"DojoUI", ui-rounded, "SF Pro Rounded", system-ui, "Segoe UI", Roboto, sans-serif`. The Mincho serif stack is retired.

Loading (`fonts.js`): `new FontFace(family, url(...), {weight, display:'swap'})`, `document.fonts.add`, `await face.load()` raced against a 2500 ms timeout, never rejects, never blocks the first frame (canvas draws the fallback until ready). MUST: when a family becomes usable `generation` increments and the renderer clears every text cache that depends on metrics (`plateMetrics`, `wrapLines` cache, baked text sprites) because the font string is identical before and after. Preload hint in `index.html` (`<link rel="preload" as="font" type="font/woff2" crossorigin>`): request to the integrator. `?assets=0` or `?fonts=0` skips the files.

### 1.2 Roles (logical px at 1920 x 1080; `minSize` is the shrink-to-fit floor, never below 28)

| Role (TEXT_STYLES key) | Family | Size | Weight | Tracking | Look | minSize |
|---|---|---|---|---|---|---|
| `display` (logo text fallback) | display | 150 | 400 (face is already black) | +0.01em | banner look, paper fill + ink stroke 0.10em | 110 |
| `headline` (screen titles, "Game over") | display | 76 | 400 | +0.02em | ink fill, paper outer stroke 0.08em, no shadow | 56 |
| `button` / `buttonSmall` / `buttonTiny` | display | 52 / 42 / 34 | 400 | +0.04em | plate look (1.4) | 36 / 34 / 34 |
| `banner84` / `banner110` / `banner132` | display | 96 / 128 / 160 | 400 | +0.02em | banner look (1.3) | 0.7 x size |
| `numeral` (HUD score) | display | 96 | 400 | 0 | cell layout (1.5), ink fill, paper stroke 0.10em; gold gradient while Double | 72 |
| `numeralTimer` | display | 60 | 400 | 0 | cell layout, ink on the ring; vermilion at 10 s or less | 44 |
| `popup44` / `popup64` | display | 48 / 72 | 400 | +0.01em | popup look: fill = juice colour, ink stroke 0.16em, hard shadow 0.07em | 36 |
| `body` / `bodyBold` | ui | 34 | 600 / 700 | +0.005em | ink on paper; on a backdrop use a text plate (existing) | 30 |
| `small` | ui | 28 | 600 | +0.01em | `inkText2` on paper, `ink` on night art (existing rule) | 28 |
| `popupLabel` | ui | 28 | 700 | +0.06em, uppercase | gold on ink pill | 28 |

Dela Gothic One has a single weight: never ask the browser for bold (it would synthesize): use weight 400 in the font string, keep `font-synthesis: none` in intent (canvas cannot set it, so declare `font-weight: 400` in the FontFace descriptor). Width guard MUST: the display face is about 12 to 18 percent wider than the retired serif, so every drawn string is measured once (cached) and shrunk to fit its box down to `minSize`; the 84 px target rule is about boxes, not glyphs, and does not change.

### 1.3 Banner look (combo, BOMB!, countdown numerals, GO!, TIME'S UP, GAME OVER, NEW RECORD, power-up names)

Draw order, each pass the same text and font: (1) hard offset shadow: fill `#14141C` alpha 0.9, offset (0.04 x size, 0.07 x size), no blur; (2) ink stroke: `lineWidth = 0.15 x size`, `lineJoin = 'round'`, `miterLimit = 2`, colour `#14141C` (half of it shows outside the glyph: 0.075 em); (3) fill: vertical gradient over the cap height: gold `#FFE28A` at 0, `#F2B134` at 0.5, `#D9892A` at 1 (warning: BOMB! and life messages use vermilion `#FF6A4A` / `#D9432B` / `#A82A18`; ice `#E6FAFF` / `#7FD1F0` / `#3E8FB5`; paper variant `#FFFFFF` / `#F4EBD9` / `#D8CAAE`); (4) highlight: a 0.035 em paper-light line inset along the top third (a second fill pass of the gradient clipped is too costly: skip, the gradient is enough). MUST: banners are baked once per (text, role, colour) into a cached bitmap (`bakeTextSprite`, 48 entries LRU, cleared on font generation change) so the per-frame cost is one `drawImage` and no gradient is created per frame. Contrast: gold gradient on ink stroke 9 to 1 or better; paper text on the ink plate 15 to 1.

### 1.4 Text on a button plate

Plate art stays (`button_*` pictures or the procedural hanko strip). Label: display face, `button` size, paper-light `#F4EBD9` fill (6.8 to 1 on `vermilionDeep`), ink stroke 0.10em (lineWidth 5 px at 52), hard offset shadow `#5A1409` 3 px down and 2 px right, tracking +0.04em, centred on the plate's label rectangle, optical baseline +2 px, title case (not uppercase) for buttons of 12 characters or more. Focused: fill `#FFFFFF`, plate brightens (existing), label scale 1.04. Disabled: alpha 0.5, shadow off. Pressed: label moves down 3 px. No text ever baked into art.

### 1.5 HUD numerals with tabular figures

Canvas has no `font-variant-numeric`. MUST: draw digit by digit in fixed cells: `cell = max measured advance of "0123456789" at that size` (measured once per font generation), `,` and `:` get 0.45 cell, so the score never jitters while it counts. `drawDigits(ctx, str, x, y, {style, size, align:'left'|'center'|'right', scale})` is the single entry point. The score is left aligned at the existing anchor; the timer is centred in its ring.

## 2. Effects catalogue

Conventions: ms real time unless "world" (world = scaled by timeScale: particles, decals, emitters). Easings: oC = easeOutCubic, oB(k) = easeOutBack with overshoot k (1.70158 is the default; 2.4 is a slam), oE = easeOutExpo, iC = easeInCubic, sine = easeInOutSine. RF = Reduce flashes, RM = Reduce motion. Colour constants from `palette.js`. Caps in section 5.

### 2.1 The slice (every cut)

| Part | Spec | RF | RM |
|---|---|---|---|
| Directional flash | `fx_slice_flash` sprite along the blade angle at the cut point, length 2.6 x r (was 2.2), scale 0.6 to 1.0 in 70 ms (oC), alpha 1 to 0 linear over 140 ms, drawn above objects (it is brief). Add a procedural paper-white core line: width 0.16 x r, length 3 x r, alpha 0.9 to 0 in 90 ms | 200 ms, alpha 0.5, no scale, no core line | normal |
| Ink splatter decal | existing splash sprite (`fx_splash_<id>` or procedural), multiply, drawn under objects; random rotation, size 1.0 to 1.5 x r; alpha 0.6; **hold 1000 ms then linear fade 2500 ms** (design 9.2 says 1500 + 4500: deviation, more energy means more cuts, the 24 cap must still never be hit in a combo); the cap rule (oldest fades in 300 ms) stays | same | same (static) |
| Juice droplets | 18 (was 14), r 4 to 10 px, speed 300 to 950 px/s, world gravity x1.0, life 0.5 to 0.9 s, 80 percent inside a 50 degree cone around the blade normal, alpha fades over the last 40 percent; plus 3 elongated streak droplets (length = speed x 0.03) | 100 percent kept (not flashing) | 9 droplets, speed x0.7 |
| Flecks | 8 (was 6), 3 to 5 px, skin and seed colours | same | 4 |
| Camera punch | only when the swing's cut count reaches 2 or more: zoom 1.00 to 1.012 in 50 ms (oC) back in 180 ms (sine), shake 3 px for 90 ms; n >= 5 and n >= 8 keep design 9.4 (8 px / 160 ms, 12 px / 220 ms) | same | none |
| Hit-stop (visual, render side) | cut #2 and #3 of a swing: 40 ms; #4 to #6: 50 ms; #7 and above: 60 ms; at most one per 250 ms; none during Freeze; bomb keeps its own 60 ms | same | none |

Hit-stop is implemented without touching the game: on the frame the `cut` event arrives, the renderer keeps drawing the previous `snapshot.objects` (positions and rotations) for the hold time while the blade, trail, HUD and every effect keep running live, then eases the objects from the held positions to the live ones over 60 ms (oC, matched by object id, at most 32 objects, no allocation: two preallocated typed arrays). The game, the audio and the score are unaffected. If the owner later prefers a true world freeze, it is the existing `slowmo reason:'hitStop'` mechanism (game logic, Gameplay owner); not requested here.

Budget per cut: at most 30 new particles; when 3 or more cuts land inside 100 ms, per-cut counts scale to 0.6 so a combo adds at most 60 particles in 200 ms.

### 2.2 Combo banners ("COMBO x{n}!", behind the objects, above the decals)

Position (960, 290). Text: "COMBO" paper variant, "x{n}" gold variant, both banner look 1.3, on a brush plate (`paintBrushBand`, baked once per width, ink `#14141C` alpha 0.9, ragged ends, 6 px paper-light dry-brush edge line on the bottom). Plate width = text width + 180, clamped to 900..1700; the text shrinks to 1500 wide before the plate grows.

| n | Size | Plate | Entrance (ease) | Hold after last member | Exit | Edge accent | Extras |
|---|---|---|---|---|---|---|---|
| 2 | 96 | ink | scale 1.5 to 1.0 in 180 ms (oB 1.7) | 700 ms | fade + scale 1.0 to 0.92 in 250 ms (iC) | none | none |
| 3 | 128 | ink + 8 px gold underline stroke | scale 1.8 to 1.0 and rotation +5 to -2 degrees in 200 ms (oB 2.0) | 750 ms | same | gold brush streak 90 x 360 px at both screen edges, alpha 0.7 to 0 over 350 ms | 8 ink stars |
| 4 to 6 | 160 | ink + gold double rule, plate reveals left to right in 120 ms (clip) | scale 2.2 to 1.0 in 220 ms (oB 2.4), one overshoot to 1.06 | 800 ms | same | streaks alpha 0.85 over 450 ms + 24 ink stars (existing, gold, vermilion, indigo) | slow-mo per design 9.3 |
| 7 and up | 160 | vermilion `#A82A18` plate, gold double rule, paper-light speckle edge | as 4 to 6 with 2.6 overshoot | 900 ms | same | streaks plus an edge vignette of gold alpha 0.18 in 100 ms, out 500 ms | 48 stars, shake 12 / 220 ms |

Each further member (update event): the "x{n}" number pops 1.0 to 1.25 in 70 ms then back in 120 ms (oC) and the hold timer restarts. Close event bonus popup "+60": see 2.3. The banner never exceeds alpha 0.9, is drawn under fruit, and never moves below y 400.
RF: no edge vignette, stars reduced by 70 percent (replaced by one soft ring alpha 0.3), streaks alpha 0.4 static. RM: no scale, no rotation, no reveal, fade in 120 ms, no shake.

### 2.3 Score popups

| Popup | Spec |
|---|---|
| Base "+15" | popup44 (48 px display), fill = juice colour lightened 15 percent, ink stroke 0.16em, hard shadow; pops 0.5 to 1.15 in 100 ms then 1.0 in 80 ms (oB 2.0), rises 90 px over 800 ms (oC), x drift random in [-14, 14] px, alpha 1 until 520 ms then 0 at 800 ms; gold gradient while Double |
| Combo bonus "+60" | popup64 (72 px), gold gradient banner look, label "COMBO" (popupLabel) on an ink pill above; rises 110 px over 1000 ms; spawn at the centroid of the members' cut points |
| Penalty / "Missed!" / "-5 s" | vermilion variant, no pop overshoot, rise 60 px |
| Golden "GOLDEN APPLE! +100" | 72 px gold gradient banner look, holds 900 ms, scale 1.4 to 1.0 in 140 ms |
| Spacing rule | within 60 px of a live popup shift 50 px alternately (existing) |
RM: no rise, no pop, fade in place over 700 ms. RF: unchanged (not a flash).

### 2.4 Bomb

| t (ms) | Effect |
|---|---|
| 0 | hit-stop 60 (existing game); `fx_bomb_explosion` sprite width 8 radii (was 6), scale 0.55 to 1.0 in 300 ms (oE), hold until 480 ms then fade; soot decal radius 170, alpha 0.6, hold 1000 + fade 2500 |
| 0 | paper-white flash alpha 0.55: in 60 ms, out 260 ms (flash limiter 9.8 stays) |
| 0 to 450 | shockwave ring 1: radius 0 to 420 px (oE), stroke width 36 to 4 px, paper-light to vermilion `#D9432B`, alpha 0.9 to 0. Ring 2 starts at +90 ms, radius 0 to 300, stroke 22 to 3, ink `#14141C` alpha 0.6 to 0 |
| 0 to 1000 | ink smoke: 28 puffs (was 20), `#3A3A46` alpha 0.55 to 0, radius 24 to 90, drift up 70 px/s, life 0.8 to 1.2 s; 12 ink droplets falling (gravity x1.2, `#14141C`, r 5 to 12) |
| 0 to 700 | 40 sparks `#FFC93C` / `#F26A21`, 400 to 1400 px/s, streak length speed x 0.03, life 0.35 to 0.7 s |
| 0 to 500 | shake 22 px / 500 ms (existing), zoom punch 1.03 (existing) |
| 0 to 1100 | red vignette `#D9432B`: peak alpha 0.35, in 80 ms, hold 200 ms, out 700 ms |
| 40 | "BOMB!" 160 px banner look (vermilion), slam scale 2.0 to 1.0 in 140 ms (oB 2.4), hold 700 ms, fade 200 ms, at the bomb position clamped inside 200 px of every edge |
RF: no overlay, no ring pulses (one static ring, alpha 0.35, 300 ms), vignette alpha 0.18 over 400 ms, explosion 300 ms alpha 0.7 no scale, sparks halved. RM: no shake, no zoom, no hit-stop, smoke and sparks halved with speed x0.7, banner fades only.

### 2.5 Golden Apple

While on screen: 12 light rays behind it (baked wedge sprite 512 px, gold alpha 0 to 0.35 alternating, radius 3.2 x r), rotating 20 degrees per second, plus the orbiting sparkles (existing). On cut: rays burst, scale 0.6 to 2.4 in 500 ms (oE), alpha 0.8 to 0, rotating 90 degrees per second; 36 gold dust particles (`DUST`, `#F2B134` / `#FFE28A`, 150 to 500 px/s biased upward, gravity x0.15, life 0.9 to 1.4 s, 3 to 7 px); 5 star sparkles (was 3); gold overlay alpha 0.20 (in 80, out 300); shake 6 / 150; slow-mo 0.40 / 350 (existing); popup per 2.3.
RF: rays static (no rotation), no overlay, sparkles reduced by 70 percent. RM: rays static, dust halved with speed x0.7, no shake.

### 2.6 Power-ups (medallion, activation, aura while active, end)

| | Freeze (5 s, slow-mo 0.40, existing) | Frenzy | Double |
|---|---|---|---|
| Activation | ice vignette: frost sprite `#7FD1F0` alpha 0.30 in 80, out 400; 24 `ICE` shards burst (radial, 200 to 600 px/s) | orange overlay `#F26A21` alpha 0.25 (in 80, out 400); 24 flame sparks | gold overlay alpha 0.15 (in 80, out 300); 16 gold stars |
| While active | edge frost vignette alpha 0.22, breathing 0.18 to 0.26 at 0.5 Hz (sine); blade icy: core `#E6FAFF`, edge `#7FD1F0`, 1 ice shard per 60 ms off the blade head (life 400 ms, max 40); snowflake motes 6 per second drifting down 40 px/s | blade flame aura: glow polyline 28 px wide in `#F26A21` alpha 0.35 plus inner `#FFC93C` alpha 0.5, 1 flame wisp per 40 ms rising 120 px/s (`EMBER`, life 350 ms); screen-edge embers 14 per second spawned on the sides and bottom, rise 80 to 200 px/s, life 1.2 to 2 s, 3 to 6 px; edge vignette orange alpha 0.10 | blade core gold gradient with a travelling glint (a 14 to 22 px star every 80 ms on the head, life 350 ms); "x2" badge: 96 px gold plate left of the score, display 48 px "x2", scale 1.0 to 1.06 at 1.2 Hz (sine), a ring around it draining over the duration; popups and score turn gold |
| End | 1.0 s fade of frost, no blinking (3 Hz rule); a 12 shard crack burst at the end | embers fade over 600 ms | badge pops out 1.0 to 1.4 with alpha 1 to 0 in 250 ms |
| RF | frost static alpha 0.15, no breathing | edge vignette 0.12 static, embers reduced by 70 percent | no breathing, glints reduced by 70 percent |
| RM | slow-mo floor 0.5 (existing), no snow drift | embers speed x0.7, count halved | badge static |
The Clock power-up (Arcade): one teal `#4A9E8A` ring (radius 0 to 260 in 400 ms), "+4 s" popup next to the timer, the timer ring pulses once.

### 2.7 Blade trail and cursor

| Layer | Spec |
|---|---|
| Outline | the whole polygon stroked 6 px wider in ink `#14141C` alpha 0.55, so the blade reads on paper and on the night veil (contrast MUST: at least 3 to 1 against all four stages) |
| Glow | the polygon stroked 3.2 x head width in the edge colour, alpha 0.18, no `shadowBlur` |
| Body | head width from config (existing), taper `w(t) = w0 x (1 - t)^1.6` from head to tail, edge colour alpha 0.95 |
| Core | 0.38 x width, core colour, alpha 1 |
| Speed streaks | while cutting, 3 thin lines (3 px) at offsets -0.7, 0, +0.7 x width, length = clamp(speed / 12, 0, 260) px, alpha 0.5 to 0 along their length |
| Sparks | while cutting and v above the threshold: 1 spark per 30 ms at the head, velocity opposite to the blade 300 to 900 px/s, life 150 to 300 ms, max 24 live, `#FFFFFF` / `#FFE28A` |
| Colour ramp | slow: core `#FFFFFF`, edge `#9FB4D0` (steel); cutting: core `#FFF3D1`, edge `#F2B134`; very fast (dv above 3000 px/s): core `#FFFFFF`, edge `#FF6A4A`; power-up colours of 2.6 override |
| Brush texture | MUST be fixed or removed: today it renders as a grey striped wing. Draw at alpha 0.22 in the edge colour (multiply off) along the whole polyline in at most 4 slices, or drop it; the procedural layers above carry the look |
| Cursor | art cursor as now; while cutting add a 0.5 s ring pulse at the blade head only on a cut (radius 30 to 60, alpha 0.6 to 0) |
RF: no streaks flicker (they are steady), sparks reduced by 70 percent, glow alpha 0.1. RM: unchanged (the blade is input feedback, not decoration), sparks halved.

### 2.8 Life lost and game over

Life lost: the leftmost HUD apple cracks along a jagged ink line (flash of the line, paper-white, 80 ms), the two halves rotate +-25 degrees and fall 160 px with gravity over 400 ms (alpha 1 to 0 in the last 150 ms), 8 juice shards; remaining apples do one heartbeat scale 1.0 to 1.15 to 1.0 in 150 ms; vermilion vignette alpha 0.30 in 300 ms out 300 ms (once, never repeated); shake 8 / 200; "Missed!" popup. RF: vignette alpha 0.15 over 600 ms, no crack flash. RM: halves fade in place, no shake.
Game over: slow-mo 0.30 / 700 ms (existing); 0 ms shake 14 / 400; "GAME OVER" / "Time's up!" 160 px banner look slams in at 200 ms (scale 2.4 to 1.0 in 160 ms, oB 2.4) with a ring of 16 ink flecks, holds until the panel; dim to ink alpha 0.55 over 500 ms; the results panel slides in at 900 ms (existing 400 ms). RF: no dim flash (the dim ramps over 700 ms), banner fades. RM: banner fades, no shake.

## 3. UI motion spec (for the UI engineer; effects are driven by pure functions of time, owner of the file: UI engineer, suggested `public/js/ui/motion.js`)

| Moment | Spec | RF | RM |
|---|---|---|---|
| Screen transition: ink-brush wipe | a PAPER-coloured (`#EADFC8`, not ink: no dark flash) brush edge sweeps left to right: cover 180 ms (oC), screen swap at the midpoint, reveal 180 ms (oC); the leading edge is a 10 px ink line with ragged noise (baked 1920 x 240 strip, tiled) | same | 120 ms crossfade |
| Menu entrance | logo drops from y -300 to rest in 560 ms (oB 1.9), lands with a squash (scaleY 0.88, scaleX 1.08 for 90 ms) and a splash: 16 ink droplets + 1 ring (radius 0 to 260 in 350 ms) + shake 6 px / 120 ms; tagline fades in at +300 ms over 250 ms; the three fruit rise in staggered by 90 ms each, 400 ms (oB 1.7) | no ring pulse | logo appears with a 200 ms fade |
| Menu fruit idle | bob +-8 px at 0.35 Hz (sine) and rotation +-3 degrees, phase offsets 0, 0.33, 0.66 turns | same | static |
| Focus ring pulse | scale 1.00 to 1.04 and alpha 0.7 to 1.0 at 1.1 Hz (sine) | static | static |
| Button press | scale 1 to 0.94 in 70 ms (oC), release 0.94 to 1.04 to 1.0 in 160 ms (oB 2.0), label drops 3 px while pressed | same | no scale |
| Panels (pause, results) | slide up 120 px and fade over 400 ms (oC) (existing), content staggers 60 ms per row | same | fade only |
| Results count-up | 1200 ms (oC), digits in cells (1.5), a tick every 50 ms (sound 4.7), score colour eases to gold in the last 200 ms | same | skipped (existing) |
| Rank stamp slam | 150 ms after the count-up ends: seal scale 3.0 to 1.0 in 140 ms (iC), rotation 4 degrees, then bounce 1.0 to 1.12 to 1.0 in 120 ms, 12 ink flecks + a ring (radius 0 to 220 in 300 ms), shake 10 / 200, taiko sound; "NEW RECORD!" repeats the slam in gold 200 ms later with 24 gold stars; the seal is 240 px (was 200) with the rank word in display face at 56 px | no ring pulse, no stars flash | seal appears with a 200 ms fade |
| Countdown numerals | each digit: scale 2.2 to 1.0 in 180 ms (oB 2.0), shockwave ring (radius 0 to 300 in 400 ms, stroke 22 to 2 px, paper to vermilion, alpha 0.8 to 0), exit scale 1.0 to 0.8 and alpha to 0 in the last 150 ms of its 800 ms; "GO!" 0.6 s: scale 2.8 to 1.0 in 140 ms, ring 480 px, 20 gold stars | ring static alpha 0.3 | fade only |
| HUD score pop | on change: scale 1.0 to 1.22 in 70 ms then to 1.0 in 160 ms (oB 1.7); 1.35 when the delta is 50 or more; colour eases toward gold for 120 ms; the displayed number rolls to the new value in at most 250 ms | same | no scale |
| Combo meter | a row of up to 10 pips (28 px circles, ink outline, gold fill) under the score while a combo is open; each pip pops in 100 ms (oB 2.0); the row fades 250 ms after the close | same | no pop |
| Timer ring urgency | at 10 s or less: ring and digits turn vermilion; each second tick pulses the digits 1.0 to 1.12 in 200 ms (existing `timerPulseMs`); last 3 s pulse 1.18 and the ring glow alpha rises 0.2 to 0.5 | colour only | colour only |

## 4. Audio direction (WebAudio synthesis, no sample files, voice limit 24, priority bomb > life > combo > power-up > slice > UI)

Levels (peak, pre master, after the compressor): ambient/UI -22 to -18 dBFS, slice -12, combo and golden -10, power-up -9, life -8, bomb and gong -4. Master target stays `0.8 x volume^2`. Ducking: three sub-buses `sliceBus`, `eventBus`, `uiBus` into `sfxBus`; on `bombBoom`, `gameOver`, `rankStamp` duck `sliceBus` and `uiBus` to 0.4 for 350 ms (`setTargetAtTime`, tau 40 ms, release tau 120 ms); on `golden` and `comboChime` n >= 4 duck `sliceBus` to 0.6 for 250 ms. The existing master low-pass dips (slowmo, Freeze) stay.

| Sound | Layered recipe |
|---|---|
| `slice` (pitch by fruit) | (a) click: noise highpass 3500 Hz, 8 ms, gain 0.4; (b) crack: noise highpass 1500, 90 ms, 0.45; (c) wet pop: sine `f0 -> 0.28 f0` over 110 ms, `f0 = (900 - 5r) x 2^(k/12)`, gain 0.35; (d) NEW: bright ting: triangle at `2 x f0`, 60 ms, gain 0.10, only for combo index 2 and above; (e) squelch for r >= 80: noise lowpass 600, 160 ms, 0.35 (existing). Pitch jitter +-6 percent. Per-fruit colour: cherry/strawberry add a 12 ms 2400 Hz sine tick, watermelon/pineapple add a 70 Hz sine thump 80 ms gain 0.25 |
| Combo escalation (new `comboStep(n)` on every update event, existing `comboChime` on close) | `comboStep`: one sine+triangle pair at `523.25 x 2^(pentatonic[min(n-1,9)]/12)`, 180 ms, gain 0.14 + 0.01 n (cap 0.22), pan 0; n=2 plain; n=3 adds a fifth (x1.5) at gain 0.08; n>=4 adds a shimmer (noise highpass 7000, 120 ms, 0.06) and a wood drum hit (sine 140 to 70 Hz, 120 ms, 0.25); n>=7 adds the gong (sine 196, 1.4 s, 0.25, plus partials 541 and 1058 Hz at 0.08 / 0.04) and a taiko hit. `comboChime` on close keeps design 10.2 |
| `bombBoom` | existing 3 layers plus: a 2 s reverb-like tail (noise lowpass 600 to 150 Hz, gain 0.25 to 0), a metallic ring (sines 1180 and 1830 Hz, 400 ms, 0.06), and the duck above. Bomb fuse loop and warn stay |
| `golden` | existing six partials plus a gong strike (sine 392 Hz, 1.0 s, 0.15) and an upward noise sweep (bandpass 2000 to 8000 Hz over 300 ms, 0.08) |
| Freeze | activate: existing + a glass chime (sines 2093, 2794, 3136 Hz staggered 40 ms, 600 ms decay, 0.08); end: three ice cracks (existing) then a shatter (noise highpass 6000, 200 ms, 0.15) |
| Frenzy | activate: existing + a low taiko roll (three sine 90 Hz hits 70 ms apart, 0.25); while active nothing looped; end: existing descending cue |
| Double | activate: coin strike pair (existing) + a 4-note sparkle (sine 1976, 2349, 2637, 3136 Hz, 40 ms apart, 0.07) |
| `countdown` | wood block: sine 880 to 600 Hz in 70 ms + noise bandpass 2500 Hz 15 ms; pitch rises per number: 3 at 523 Hz base, 2 at 659, 1 at 784 (gain 0.22), with a soft low thump sine 110 Hz 90 ms 0.2 |
| `go` (GO gong) | gong: sines 196, 541, 1058, 1650 Hz (gains 0.28, 0.12, 0.06, 0.03; decays 1.6, 1.1, 0.7, 0.4 s) + noise highpass 2000 Hz 120 ms 0.15 + taiko hit |
| Results fanfare (`rankStamp`, `resultsFanfare`) | `rankStamp`: taiko hit (sine 120 to 50 Hz, 250 ms, gain 0.5; noise lowpass 800 Hz, 120 ms, 0.3) at the slam; `resultsFanfare`: `record` arpeggio (C5 D5 E5 G5 C6, 80 ms apart) plus a sustained fifth pad (sines 523 and 784 Hz, 900 ms, 0.08) for S and A ranks; a single falling pair for the lowest rank; `countTick`: triangle 1800 to 2600 Hz (rises with progress), 12 ms, gain 0.07 every 50 ms |
| `lifeLost`, `gameOver`, `timeUp` | existing; `lifeLost` adds a crack tick (noise highpass 3000, 20 ms, 0.3) |
| UI `uiMove` (stick tick) | wood tick: sine 1500 to 1100 Hz 18 ms gain 0.07 + noise bandpass 3000 Hz 8 ms 0.04; pitch alternates +-3 percent so repeats do not machine-gun; rate limited to one per 40 ms |
| UI `uiSelect` (confirm) | sine 660 then 880 Hz (existing) + a soft bell (sine 1760 Hz, 250 ms, 0.05) |
| UI `uiBack` | sine 660 then 440 Hz (existing), no bell |
| UI `uiWhoosh` (transition) | noise bandpass sweep 400 to 2400 Hz over 220 ms, Q 1.5, gain 0.10 (reverse for the reveal: 2400 to 600 Hz); plays at the start of the ink wipe |
| UI `uiError` | two square pulses 180 Hz, 60 ms each, 50 ms apart, lowpass 900 Hz, gain 0.08 |
| `uiFocusPlate` (optional) | none; do not sound every pulse |
Optional P2: a very quiet menu bed (filtered noise "wind" gain 0.02 plus a pentatonic drone, off in Zen rounds); only if the owner asks.

## 5. Performance budgets, interfaces, ownership

### 5.1 Budgets (MUST, measured at 1080p, 60 fps)

| Item | Budget |
|---|---|
| Frame | render + fx update at most 8 ms average on the owner's Mac, 12 ms p99; auto-degrade (existing) at 20 ms average over 2 s |
| Particles | 400 total (pool, existing, oldest dropped first); soft per-kind caps: droplet 160, spark 100, smoke 60, ember 60, dust 80, ice 40, star 60; level 1 degrade halves counts, level 2 halves the decal cap |
| Decals (splats) | 24 (12 after degrade 2); one multiply pass per frame for all of them |
| Active effects | rings 4, bursts 6, banners 3, popups 12, slashes 8, shakes 6, vignettes 6, flashes 4, sparks (blade) 24, edge accents 2 |
| Canvas ops | at most 600 draw operations per frame at peak; particles of one kind and colour share one path or one `drawImage` source; `save/restore` at most 40 per frame; `globalCompositeOperation` changes at most 4 per frame |
| Forbidden | `shadowBlur`, `filter`, gradients created per frame, `new`, array or object literals, closures, template strings, `Math.random` and string concatenation in `update` and `draw` paths; all gradients, wedge/ray sprites, plates, vignettes and banner text are baked on resize or on a cache miss |
| Memory | all baked sprites together at most 24 MB of canvas at density 2; fonts at most 150 KB; no new image above 400 KB |
| Tests | extend `test-support/render` with a 600 frame allocation test (heap growth under 1 MB), a particle-cap test, a determinism test (same events and dt give the same `fx.serialize()`), a reduce-flashes test (no overlay, at most 1 flash per 500 ms) and a reduce-motion test (no shake, no zoom, no hit-hold) |

### 5.2 Interfaces between the three engineers (names are the contract; additions only, existing exports keep their signatures)

Assets and typography engineer provides:
```
fonts.js     FONT_FILES; loadFonts({document, baseUrl, timeoutMs}) -> Promise<{loaded:string[], failed:string[]}> (never rejects);
             fontsGeneration() -> number; onFontsChange(cb) -> unsubscribe
palette.js   FONTS {display, ui}; TEXT_STYLES[role] = {family, size, weight, tracking, minSize, look}; fontString(role, size?) (unchanged);
             letterSpacingPx(role, size) -> string like '1.5px'
draw-util.js drawText(ctx, text, x, y, {look:'plain'|'banner'|'plate'|'popup', tint:'gold'|'paper'|'vermilion'|'ice', ...existing});
             drawDigits(ctx, str, x, y, {style, size, align, scale}); fitText(ctx, text, font, maxWidth, minSize) -> size (cached);
             bakeTextSprite(createCanvas, key, text, {style, size, look, tint}) -> {canvas, w, h, ax, ay} (LRU 48);
             invalidateTextCaches() (called from onFontsChange); easeOutExpo, easeInCubic, easeInOutSine
art-config.js (owner: Effects) / assets: optional pictures by id, all with procedural fallbacks: fx_rays, fx_shockwave, fx_vignette_ice,
             fx_vignette_flame, fx_edge_streak, fx_ink_plate. None required; Effects paints them procedurally first.
```
Effects engineer provides (fx.js consumes the same game events as today: cut, combo, bomb, nearMiss, powerup, lifeLost, gameOver, timeUp, tick, slowmo):
```
fx.comboBannerView(out) -> {n, tier, scale, alpha, rot, reveal}      fx.cameraView(out) -> {dx, dy, scale, rot}
fx.hitHold() -> {active, remainingMs, catchUp}                        fx.decals (read-only pool, existing splats)
fx.auraView(out) -> {powerup:'none'|'freeze'|'frenzy'|'double', k}    fx.edgeAccents (read-only pool of 2)
fx.setSettings({reduceFlash, reduceMotion}) (existing)               fx.activeCounts() (existing, extended with the new pools)
trail.setAura(auraView) (blade colours and extras)                    renderer owns the held-snapshot logic of 2.1
```
Audio engineer provides (`audio.play(id, params)` exists; add ids; `handleGameEvent` also reacts to `combo` phase `update` with `comboStep`):
`comboStep{n}`, `rankStamp`, `resultsFanfare{rank}`, `countTick{progress}`, `uiWhoosh{reverse}`, `uiError`, `freezeEnd` shatter; `audio.duck(group, amount, ms)` internal; new sub-buses. The UI engineer later calls `audio.play` for the UI and results ids (no new API for them).

### 5.3 File ownership

- Assets and typography engineer: `public/js/render/fonts.js` (new), `palette.js`, `draw-util.js`, `tools/build-assets.mjs`, `public/assets/` (including `fonts/`), `design/fonts/`, `design/icons/`, `test/assets/`, their tests, the font and glyph docs.
- Effects engineer: `public/js/render/fx.js`, `painters.js`, `sprites.js`, `trail.js`, `renderer.js`, `stage.js`, tests in `test/render` and `test-support/render`. Proposed by this document for the two files nobody owns: `hud.js` and `art-config.js` go to the Effects engineer (HUD pops, combo meter, life crack, timer urgency are all there); `assets.js` goes to the Assets engineer.
- Audio engineer: `public/js/audio/**`, `test/audio/**`.
- Integrator (requests only): `server.js` MIME `.woff2: font/woff2` (the CSP `default-src 'self'` already allows same-origin fonts, no CSP change), `public/index.html` font preload.
- UI engineer (later): `public/js/ui/**`, `motion.js`; this document section 3 is the spec.

### 5.4 Order of work (time boxed, most visible first)

P0 (first 40 minutes): font files and `fonts.js` + new TEXT_STYLES and banner/popup looks; blade trail layers and brush fix; combo banner x2 to x7; bomb package (bigger explosion, rings, vignette, BOMB! slam); slice particles and flash; audio `comboStep`, bomb tail, UI tick/whoosh. P1: Golden rays and dust, three power-up auras, life crack and game over slam, hit-stop hold, countdown ring, rank stamp art (hands over to the UI engineer). P2: HUD combo meter, edge streaks, ambient bed, optional new pictures. Stop at the time box and ship what is done: every item is independent and has a fallback.

### 5.5 Risks

Dela Gothic One is wide: every string needs the fit guard. Font subsetting needs a dev tool (fonttools) and network to fetch the files; without them the fallback stack ships and the typography goal is only half met. The render-side hit-stop holds objects for 40 to 60 ms; an object near a cut can look as if it stopped then jump: the 60 ms catch-up must be tested with 8 or more objects. Bigger explosions, rings and the 18 droplets raise overdraw on the 1080p canvas: watch the 8 ms budget and the degrade level in the debug overlay. The flash limiter (one flash per 500 ms) must still hold when a bomb lands inside a x7 combo: banner vignettes count as flashes. The 2.5 s decal fade departs from design 9.2 (recorded in `docs/contract-notes.md`). The new `uiWhoosh` and wipe must not use a dark full-screen overlay (luminance flash).
