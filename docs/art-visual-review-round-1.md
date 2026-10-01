# Art visual review, round 1

Role: visual critic. Date: 2026-09-30. Target: the game as served from `public/` with the generated art on (default), judged against
`docs/game-design.md` section 11 and `design/higgsfield-brief.md`.

**Verdict: FAIL.** No critical finding (no blank, broken or unreadable screen, no console error, no failed asset request, about 64 fps in
headless Chrome). There are 5 major findings (play-relevant contrast, clutter and text readability) and 14 minor ones. Evidence pictures are in
`docs/qa/art-review-round-1/` (file numbers are quoted below).

## How this was checked (and what was not)

* Real screens of the real game, served by `node server.js` on port 8222 (stopped at the end), driven with `window.__ninja` in headless Chrome
  through `test-support/e2e` (manual clock, `?input=sim`), full-resolution PNG screenshots, plus pixel sampling of the drawn canvas.
* Window sizes: 1920x1080 at device pixel ratio 1 (all screens), 1280x720 at ratio 2 (menu, settings, Arcade play), 1366x768 and 800x450 at ratio 1
  (menu, settings, Arcade play).
* Screens seen: safety, connect (Joy-Con layout and simulator), menu, settings, sword tuning, calibration steps 1, 3 and 4 (step 4 through the real
  `?simcal=1` wizard), countdown (three modes), HUD and all 10 fruit, bomb and golden apple in Classic, Arcade and Zen, combo, the four power-ups,
  bomb hit, fruit halves against wholes, lost lives, pause, results (Arcade and Zen), blade trail on a dark band and a light band.
* Numbers for contrast are WCAG relative luminance computed from sampled screenshot pixels (text colour `inkText2` #4E4740 = 0.065). They are
  estimates: a few samples include anti-aliased text pixels.
* NOT done: no colour-blind simulation was run (the colour-blind remarks are by eye, from the silhouettes); no real Joy-Con (nobody can test it);
  the native bridge connect layout, the disconnect overlay and the Classic results screen after a real game over were not captured (the Classic run
  was still in play at the capture time; Arcade and Zen results were captured); frame rate was read once (`getPerf`, 63.8 fps in headless
  Chrome) and is not a performance test.
* One false alarm, for the record: with `forceScreen('calibration', {step: 4})` the practice apple is missing. That is only because forcing the
  screen does not start the practice round. In the real flow the apple is there (picture 05).

## What works (keep it)

* The three day stages and the night stage load, dissolve and sit behind the gameplay. The Classic stage is the best one: calm, flat sun, clear
  centre, the lower ridge is the only heavy part.
* Fruit sprites are consistent with each other and with the UI kit (same ink outline weight, same hard shadow, same white highlight arc). All ten
  fruit, the bomb, the golden apple (glow ring plus procedural sparkles) and the medallions are readable at 1x.
* Silhouettes: apple (heart with stem), strawberry (cone with calyx) and cherry (two balls and a long stem) are clearly different; pineapple, pear,
  lemon, kiwi and watermelon are unique. See minor finding m3 for orange versus peach.
* Halves match their wholes (picture 13): no visible scale jump for any fruit; the pineapple and watermelon halves are the largest, the kiwi and
  strawberry halves about 5 to 10 percent smaller than the whole body, which reads as natural.
* Button plates fit their labels everywhere (longest: "Reset high scores", "Recalibrate", "Quit to menu", "Got it, let's go"); the game draws
  the text and the plate is empty, as planned. Focus state (gold halo) is visible. The hit boxes are 84 px or more on the settings screen.
* The blade trail (cream body, ink outline, gold head when fast) is visible on the dark Classic ridge and on the cream Zen sky (picture 15).
* The bomb explosion, slice flash, juice stains, combo banner and life apples (full and empty) look like one game.
* Procedural fallback was not broken by anything seen here (no console errors, no 4xx, no exceptions in the sessions).

## Findings

Severity: critical = unreadable or broken screen; major = play-relevant problem (a fruit hard to see, text unreadable); minor = taste and polish.

### Major

**M1. Arcade: the near-layer lanterns look like fruit and sit where fruit fly (and under the score).**
Four glossy, ink-outlined lanterns per side (red, red, gold, gold) fill the top corners: about x 40 to 370 and x 1550 to 1890, y 0 to 410 (pictures
07, 09, 16). They use the fruit palette (vermilion, orange, gold), the same ink outline weight and the same white highlight arc, and the big red one
is about fruit size. Game arcs stay inside x 100 to 1820 and apexes are at y 240 to 560 (`config.js`: `arcXMin`, `arcXMax`, `apex`), so every fruit
crosses this zone. A red apple or an orange passing a red lantern, or a pineapple or golden apple passing a gold lantern (seen in picture 07,
pineapple next to the gold lantern), loses its silhouette. `layerAlpha.arcade.near = 0.8` is far too weak to fix this. The score block
("SCORE", number, "BEST") is drawn on top of a gold and a red lantern, and the digits grow into the big red one as the score rises.
Recommendation (any one): drop the lantern clusters from the near layer and keep only the thin side posts; or re-generate them flat (no
highlight arc, no ink outline, desaturated to the sky); or at least move them up and out (max y 200, max x 260) and dim the near layer to about 0.45
with a desaturation, then test with the bomb and the golden apple.

**M2. The bomb loses its silhouette on the dark lower band of every stage.**
Measured on the composed play area (64 px cells, y 120 to 980): Classic has 36 of 338 cells darker than relative luminance 0.12 (the ink-wash ridge,
x 160 to 1770, y 736 to 930, cells at 0.05 to 0.11); Arcade has 23 (the navy rooftops, y > 830, down to 0.024); Zen has 5 (the two big slate rocks,
x 70 to 490 y 710 to 920 and x 1510 to 1830 y 760 to 930). The bomb body is nearly black (about 0.01), so the contrast of body against band is about
1.5 to 2.4 to 1 (picture 17). The bomb is still recognised by its orange stripe, its fuse spark and the thin red danger ring, but the ring is
semi-transparent and the silhouette, which is the rule of the brief ("fruit, bomb and blade always have the strongest contrast"), is gone where it
sits on the band. Every object falls through this band, so the bomb spends part of each throw on it.
Recommendation: give the bomb sprite a light outer rim (for example a 6 px paper-coloured stroke outside the ink outline, drawn procedurally under
the sprite) and make the danger ring opaque and thicker on dark grounds; and/or lighten the lower 25 percent of the Classic and Arcade far and mid
layers by 15 to 20 percent. The Zen rocks need the same rim treatment (or a lighter slate).

**M3. Menu, connect, calibration, settings and tuning: grey secondary text on the veiled night stage is below 3 to 1 in places, and the stage is a flat grey.**
The night stage under the paper veil (0.58 on the menu, 0.62 elsewhere) has relative luminance 0.22 to 0.35 (samples in pictures 01 to 04). The
secondary text (`inkText2` #4E4740, 0.065) therefore gets 2.4 to 3.0 to 1: the tagline "Slice the fruit. Avoid the bombs.", the mode descriptions
("3 lives...", "60 seconds...", "90 seconds..."), the connect notes ("Careful: after an attempt...", "Or play without a Joy-Con"), "Threshold preset",
"Make a firm swing", "Sword calibration", "Back: right click". All are 28 to 34 px, so the 3 to 1 large-text rule is the bar, and the bad spots
miss it; the big moon sits behind the tuning sentence (picture 04, the word "right." lands on the cream moon). Also, the veil turns an indigo night into a
muddy grey: it reads as a loading or disabled state, not as a stage, and it kills the colour of the menu fruit's surroundings.
Recommendation: darken the secondary text to `ink` on the night stage (or draw a paper plate behind each text block), lower the veil only under the
text blocks, move or dim the moon behind text, and give the night stage a warmer or bluer tint instead of pure paper alpha.

**M4. Arcade: the bottom hint line sits on the rooftop edge.**
"Pause: middle click   Recenter: double click" (in play), "Rest your arm: ..." (pause) and "Rest your arm before you start again." (results) are drawn
at y about 1020 to 1045, exactly across the boundary between the navy rooftops and a cream strip (pictures 07, 11). Samples under the letters: about
0.22 against a text of 0.065, which is about 2.3 to 1, with gold window lights under some letters. In Zen the same line crosses the small centre rock,
and in Classic it is fine (it sits on the mist). The line is also the only way a mouse or simulator player learns how to pause.
Recommendation: give hint lines a paper plate or a stronger paper halo (the combo popups already use one), or move them 70 px up onto the
open sky, or let the Arcade far layer end its rooftops 60 px higher.

**M5. The Joy-Con glyphs are close copies of the real controller (owner decision, recommendation below).**
`glyph_joycon_l` and `glyph_joycon_r` (connect screen, picture 02 and crop 18) are slim rounded controllers with a top tab, a thumbstick and a four
button diamond, in the real layout: stick on top and buttons below for the L one, buttons on top and stick below for the R one. Both are red, where
a real Joy-Con L is blue, so the pair is a Joy-Con R twice; the silhouette and the layout still say "Nintendo Joy-Con" and the brief asked for glyphs
"drawn generically, NOT copied from Nintendo artwork". They are behind `ART_CONFIG.glyphs.enabled`.
Recommendation: ship with `glyphs.enabled = false` until replaced; the replacement should keep the pill shape but lose the stick, the four-dot diamond and the
top tab, be one neutral colour (indigo or paper with an ink outline) and show a single dot or a wireless arc, identical for left and right (the text
already says left or right). The mouse, keyboard and sync glyphs are fine (they are not controllers).
I rate this major because it is a ship decision, not because it hurts play; it can be downgraded by the owner.

### Minor

**m1. Zen petals and branch.** Ink-outlined pink petals sit inside the play area (about x 20 to 330 and x 1500 to 1890, y 290 to 620, pictures 08, 13) in
the colour of the peach and the cherry flesh; the upper-left branch covers half of the sun and the HUD score ("BEST 0" sits on a blossom, the cream halo
is what keeps it readable). Fruit are bigger, so this is not play-breaking, but a petal behind a cherry half or peach half is easy to misread.
Lower `layerAlpha.zen.near` to 0.6 as foreseen in `assets-integration.md` 9.2, and move the score block 40 px right.

**m2. HUD on busy parts.** Classic: the score digits and "BEST" sit on the bamboo leaves and the lives and "LIVES" sit on the sun (readable thanks to
the halo, picture 06). Arcade and Zen: see M1 and m1. A narrow paper plate or a wider halo under the score would calm all three.

**m3. Orange versus peach.** Both are round, similar in size and adjacent in hue; the peach also has a salmon body that is close to the Arcade sky and
to the Zen petals, so it depends on its ink outline. Distinct enough for people with normal colour vision (the peach has a cleft, a leaf and a
blush), but orange and peach are the pair most likely to merge for a colour-blind player (not simulated). Keep an eye on it; a cleft that is deeper
or a darker blush on the peach would help.

**m4. Score popups take the colour of the stain under them.** Juice-coloured text on a stain of the same colour gets thin contrast: "+15" gold
on the gold apple stain, "+60" gold on the peach sky, "+15" orange on the orange stain (crop of picture 09). The spec says a 5 px ink stroke; it
looks about 3 px here. Increase the stroke.

**m5. "BOMB!" over the explosion.** The vermilion word sits on the orange and yellow flame of `fx_bomb_explosion` and on the black smoke (picture 10);
readable through its ink stroke but muddy in the letters "O" and "M". Draw the word a little above or below the flame, or add the paper halo.

**m6. Results stat grid.** Labels ("Fruit sliced", "Accuracy", "Power-ups") are about 80 px above their value and the value is about 70 px above the next
label, so a value can be read as belonging to the label under it (picture 11). Tighten the pairs or add row separators. A full-width red bar under
the two buttons (x 510 to 1410) looks like a stray line; it is the lock countdown, so draw it inside the button or label it.

**m7. Mixed widgets on the settings and tuning screens.** The "Hand" choice (Right/Left), "Threshold preset" (Easy/Normal/Hard) and the blade speed bar are
procedural flat rectangles with a thin border, next to the new art toggles with thick ink, gloss and hard shadow (picture 03). They look like a
different game. Also the toggle art is 290 px wide but its two hit boxes are 210 px each (430 px in total), so the active area sticks out 70 px on
the right of "Off" with nothing drawn there.

**m8. Glyphs on button plates.** The keyboard and mouse glyphs are drawn over the rotated label plate and cross its border (crop in picture 02); it looks
like a sticker placed a few pixels off. Put the glyph fully inside the plate or fully left of it.

**m9. Logo margin.** The logo's top edge is about 10 px from the screen edge (picture 01) and the tagline touches its bottom. Keep 40 to 50 px of
safe margin at the top (TV overscan) and 14 px more before the tagline.

**m10. Softness at 2x.** Menu fruit are 512 px sources drawn up to about 380 px logical, so at device pixel ratio 2 they are about 1.5x upscaled: soft
but acceptable (crop in the session, orange). The outline and highlight stay crisp enough. No pixelation was seen in play sizes at 1x or 2x. If larger
art is ever ordered, the three menu fruit and the logo come first.

**m11. Calibration progress ring.** On steps 1 and 3 the "hold still" ring is dark grey on the grey night stage (about 1.5 to 1), so the player cannot see
the progress (picture 05 is step 4; ring visible in the step 1 capture). Use the vermilion or paper colour for the ring.

**m12. Heavy halo on text over art.** Calibration instructions use a wide cream halo on ink text to survive the stage; it looks blotchy (an outlined sticker
look). A paper plate would be cleaner (same fix as M3).

**m13. Arcade bottom edge.** A cream strip with a torn edge (y about 1030 to 1080) under the roofs looks like the layer ends early; it reads as mist but is
a hard edge next to navy (picture 07). It could fade.

**m14. Sun and moon.** Classic and Arcade suns are flat and calm (good). The Zen sun is a small pale disc half hidden by the branch (reads as a stain);
the night moon is a big soft cream disc that competes with text (see M3) and is the brightest thing on the menu. Dim it by 30 percent.

## Numbers used

| Stage | Mean relative luminance of the play area (x 100 to 1820, y 120 to 980) | Cells darker than 0.12 | Where |
|---|---|---|---|
| Classic | 0.52 (0.05 to 0.70) | 36 of 338 | ridge band y 736 to 930 |
| Arcade | 0.55 (0.02 to 0.68) | 23 of 338 | rooftops y > 830 |
| Zen | 0.62 (0.06 to 0.72) | 5 of 338 | rocks y 710 to 930 |
| Menu (night, veiled) | 0.22 to 0.35 sampled around text | not applicable | |

Text colour `inkText2` #4E4740 = 0.065; the ink (#14141C) is about 0.008. Arcade hint background about 0.22, so 2.3 to 1.

## Suggested order of fixes

1. M2 (bomb rim and dark band), M1 (lanterns), M5 (glyph switch): these change play or legal exposure.
2. M3 and M4 (text plates, secondary text colour, veil): data and small drawing changes in `art-config.js`, `hud.js` and the night stage.
3. m1, m4 to m7, m11 as one polish pass; the rest at the owner's taste.
