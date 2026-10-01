# Art visual review, round 2

Role: visual critic. Date: 2026-09-30. Target: the game as served from `public/` with the generated art on (default), judged against
`docs/game-design.md` section 11 and `design/higgsfield-brief.md`. This round re-checks every round 1 finding
(`docs/art-visual-review-round-1.md`) and looks again at all screens.

**Verdict: PASS.** No critical and no major finding. All five round 1 majors (M1 to M5) are fixed or neutralised (details below). There are
14 minor findings: 7 are round 1 minors that are still open, 7 are new. Evidence pictures are in `docs/qa/art-review-round-2/` (file
numbers are quoted below).

## How this was checked (and what was not)

* Real screens of the real game, served by `PORT=8222 node server.js` (stopped at the end; the servers on 8200 and 8210 were not touched),
  driven with `window.__ninja` (manual clock, `?input=sim`) in headless Google Chrome through the `test-support/e2e` launcher and CDP
  helper, full-resolution PNG screenshots (converted to JPEG for the repository). Console errors, exceptions, 4xx and failed requests were
  checked on the sessions of the first batch, the combo, bomb, power-up, results and small-window sessions: none. `getAssets()` showed
  `core` 90 of 90 loaded, 0 failed, stage groups loaded lazily (Classic and Zen idle until used).
* Window sizes: 1920x1080 at ratio 1 (everything), 800x450 at 1, 1366x768 at 1, 1280x720 at ratio 2, 1000x1000 at 1 (letterbox), 2560x1440 at 1
  (menu and Arcade play, looked at as a size check only, pictures not kept).
* Screens seen: safety, connect (Joy-Con layout), menu, settings, sword tuning, calibration steps 1 to 4 (step 3 with the real `?simcal=1`
  wizard), countdown (three modes), HUD with all 10 fruit, the bomb and the golden apple in Classic, Arcade and Zen (two arrangements:
  mid air, and low over the dark band), a 5-fruit combo in the three modes, 11 fruit cut at once (halves against wholes), bomb telegraph
  and bomb hit (Classic and Arcade), the four power-up medallions in three modes, each power-up active (Arcade), pause (three modes),
  lives lost (Classic), game over and results (Classic, Arcade, Zen), blade trail on a dark band and in Zen, the disconnect overlay (sim).
* Numbers are computed on the drawn canvas (WCAG relative luminance). Body-against-background contrast of every object at 28 positions
  per stage and per type (1008 measurements) is in `contrast-body-vs-background.json`. Text contrast is the median luminance of the
  background pixels in each text box against `ink` (#14141C, 0.008).
* NOT done: no real Joy-Con (nobody can test it), no native bridge layout (connect screen of the helper app), no real-time frame rate or
  performance measurement (the art layer has its own tests), no test with people who have a colour vision deficiency. The colour-blind remarks
  use a simulation of the mean colours (Machado 2009 matrices) plus my own eye, and are an estimate. The Classic disconnect overlay was seen
  only with the simulator (no controller picture, see M5). Hover, pressed and focus states of the buttons were seen only where they
  appear in the pictures above (the gold focus halo on "Recalibrate" in the pause menu).

## Round 1 findings: status

| Round 1 | Now | Evidence |
|---|---|---|
| M1 Arcade lanterns look like fruit and sit on the score | **Fixed.** The two lantern clusters are gone; only the thin dark posts (x up to 36 and from 1885) remain. The small sky lanterns of the far layer are about 25 px and sit below y 650, far from the score and from the play arcs | 10-arcade-all-fruit, 21-arcade-combo-a |
| M2 Bomb loses its silhouette on the dark band | **Fixed.** Paper rim plus thick opaque danger ring: the bomb reads on the Classic ridge, the Arcade roofs and the Zen rocks. Measured body against background (outside the rim) is 3.1 to 1 at worst in Classic, 6.1 in Zen, 8.3 in Arcade; median 10 to 11 | 11-classic-low-band, 11-arcade-low-band, 11-zen-low-band |
| M3 Grey text on the veiled night stage under 3 to 1 | **Fixed.** The stage is a blue night, the moon is dimmed, the small text is drawn in `ink`. Measured `ink` against the night stage: menu tagline 4.5, mode descriptions 4.2, "Best" 4.4, bottom hint 8.1, tuning text 4.8 to 5.2, calibration text 5.3 | 03-menu, 05-tuning, 06-calibration-* |
| M4 Arcade hint line across the roof edge | **Fixed.** The hint sits on a paper label in play, pause and results (measured about 8 to 1 on the menu, plate is cream elsewhere) | 10-arcade-all-fruit, 41-classic-pause, 43-arcade-results |
| M5 Joy-Con glyphs too close to a real Joy-Con | **Neutralised.** `ART_CONFIG.glyphs.enabled` is `false`: no controller picture is drawn on the connect screen or the disconnect overlay. The files are unchanged, see "Controller glyphs" below | 02-connect-joycon, 61-disconnect |

## What works (keep it)

* The four stages read as one set with the fruit and the UI kit: same ink outline, hard shadow and white highlight arc. The Classic stage
  is calm and the best one; Arcade is warm and the roofs are now a quiet band; Zen is pleasant.
* All ten fruit, the golden apple (glow ring plus procedural sparkles), the bomb and the four medallions are sharp at 1x and at 2x (the
  logo and the menu fruit at ratio 2 show no pixelation; see m10 for the softness of the largest ones).
* Halves match their wholes in every stage (22-arcade-halves-a, 21-arcade-combo-*): no scale jump; pineapple and watermelon halves are
  the largest, kiwi and strawberry halves slightly smaller, which reads as natural.
* Silhouettes are distinct: apple (heart with stem and leaf), strawberry (cone with calyx), cherry (ball with a long stem), pear, lemon, kiwi,
  pineapple (crown) and watermelon (size and stripes) cannot be mistaken; the golden apple is the apple shape with a glow and sparkles.
* The medallions differ by icon (snowflake, flame, coins, clock) and by their procedural extras (dotted ring, orbit dots, sparkles, tick
  ring): 71-crop-medallions-arcade. Their cream body is pale on the Arcade sky but it has the full ink outline.
* Button plates fit their labels in all screens ("Reset high scores", "Quit to menu", "Got it, let's go", "Recalibrate" are the longest).
  The gold focus halo is visible. The steppers, toggles and panels are consistent with each other.
* The combo banner (dark brush band with cream and gold text), the power-up banners, the bomb explosion, the slice flash, the juice stains
  and the blade trail (thin ink line with a cream wake, readable on the dark ridge and on the pale sky) look like one game.
* The calibration "hold still" ring now shows a clear vermilion progress arc (63-calib-flow).
* Letterboxing at 1000x1000 is clean (dark bars, nothing stretched); 800x450 keeps everything in the frame.

## Findings

Severity: critical = unreadable or broken screen; major = play-relevant problem (a fruit hard to see, text unreadable); minor = taste and polish.

### Critical

None.

### Major

None.

### Minor

**m1. (open, round 1 m1) Zen: petals, branch and blossoms near the play area and under the score.**
The falling petals are ink-outlined and salmon, the colour of the peach and the cherry flesh, and some sit inside the fruit arcs (about x 20 to 330 and
1500 to 1890, y 290 to 620). In 11-zen-low-band a petal peeks out from behind the lemon and another touches the bomb ring; a peach half next to
a petal is easy to misread. The score block sits on the branch and a blossom ("SCORE" on a flower, "BEST 0" across a twig, crop 72), readable only
thanks to the cream halo. Zen has no bombs, so the cost of a misread is small. `layerAlpha.zen.near` is still 0.8; lower it to about 0.6 and move
the score block 40 px right (round 1 advice, not applied).

**m2. (open, round 1 m2) Score block on busy parts.** Classic: the digits and "BEST" sit on bamboo leaves (readable, halo). Zen: see m1. A narrow paper
plate under the score, as the hint lines have now, would calm all three stages.

**m3. (open, round 1 m3) Orange, peach and apple on the Arcade sky, and colour-blind pairs.**
The Arcade sky is coral, so the body of the orange (0.33), the peach (0.44) and the golden apple (0.49) is close to the sky (0.50 to 0.59): body against
background is 1.3 to 1.7 to 1 for the orange and 1.1 to 1.3 for the peach and the golden apple in the lower half of the stage (json). The silhouette
comes from the ink outline only (about 4 px). In the pictures they are still clearly readable, hence minor; the lemon on the pale Classic and Zen sky
is the extreme case (body 1.0 to 1 against the paper, outline only). Simulated colour deficiency on the mean colours: orange against pineapple
(deuteranopia delta E 2.7) and kiwi against watermelon (protanopia 4.0) have almost the same colour, but their silhouettes and sizes are very
different; orange against golden apple (8.2) is separated by the glow ring and sparkles. No pair relies on colour alone. Keep an eye on peach
against orange and strawberry against apple in future art.

**m4. (open, round 1 m4) Score popups are weak on a stain of their own colour.** "+10" (watermelon) on the red stain, "+15" on the orange and gold
stains, "+100" on the peach sky (crop 70). The stroke looks about 3 px, the spec says 5 px. Raise the stroke to 5 px or draw the popup on a small
paper plate. Popups are transient and the score is in the HUD, so not major.

**m5. (open, round 1 m5) "BOMB!" over the explosion.** The vermilion word sits on the orange flame and black smoke (30-classic-bomb-hit-a, b).
Readable through the ink stroke, but the letters "O M B" are muddy. Draw it 80 px above the flame or add a paper halo.

**m6. (open, round 1 m6) Results grid and stray red bar.** Labels ("Fruit sliced", "Accuracy", "Power-ups") are 80 px above their value and the
value is 70 px above the next label, so a value reads as belonging to the label under it (43-*-results). The red bar under the two buttons
(x 510 to 1410, y 935) is the lock countdown; it looks like a stray underline. The same bar sits under "Got it, let's go" on the safety screen
(01-safety). Put it inside the button plate or give it a label.

**m7. (open, round 1 m7) Two widget styles on settings and tuning.** The steppers and toggles are art (thick ink, gloss); the "Hand" and "Threshold
preset" choices are flat cream and vermilion rectangles with a thick outline (much closer than in round 1) but without gloss or hard shadow, and
the "Blade speed" bar is a translucent grey-blue strip with no outline, no gloss and no label plate (04-settings, 05-tuning), where the art has a
`meter_bar`. The safety screen "Reduce flashes" checkbox is a thin-outline pill. Small, but it is the one place where the two styles sit side by side.

**m8. (open, round 1 m8) Glyphs on button plates.** On the connect screen the keyboard and mouse glyphs are drawn across the left border of the
plate of "Simulator" and "Mouse only" (02-connect-joycon), like a sticker placed a few pixels off. Put the glyph fully inside the plate or fully left of it.

**m9. (open, round 1 m9) Logo margin.** The logo top is about 12 px from the screen edge and the tagline nearly touches the bottom of "DOJO"
(03-menu, 73-crop-logo-2x). Keep 40 to 50 px of safe margin at the top (TV overscan) and about 14 px more before the tagline. Rated
minor, but on a television with overscan the top of "3D FRUIT" may be cut.

**m10. (open, round 1 m10) Softness at 2x for the largest art.** The menu fruit are 512 px sources drawn up to about 380 px logical: about 1.5x
upscaled at ratio 2, soft but acceptable (50-menu-1280x720@2). The logo is crisp. If larger art is ever ordered, the three menu fruit come first.

**m11. (new) Countdown numerals sit under the cursor.** The numeral (132 px, vermilion with thick ink stroke) is drawn at the centre of the screen
(960, 540) and the recentred cursor ring is at the same point, so "3" and "1" are half covered by the ring and the red dot (20-classic-countdown-a,
20-arcade-countdown-b). Still legible, but the most important number of the countdown is partly hidden. Move the numeral 120 px up, or draw the
cursor under the numeral during the countdown.

**m12. (new) Disconnect overlay looks unfinished.** The panel is a large empty paper rectangle (about 900 x 640) with a title, one line and a small
red arc placed about 35 px right of the centre; with the controller pictures off there is nothing else in it (61-disconnect), and the round behind it
is washed out to almost plain paper. Shrink the panel to its content or put the sync glyph (which is not a controller picture) in the empty space;
centre the arc. Seen only with the simulator (`simulateLoss`); the native bridge variant was not captured.

**m13. (new) Calibration text halo and ring track.** The instruction text of calibration steps 1 to 3 uses a wide cream halo that looks blotchy next to the
clean paper panels used elsewhere (06-calibration-1, 06-calibration-3) (round 1 m12, still open); the empty track of the "hold still" ring is a faint
dark grey on the blue mountains (about 1.3 to 1), only the progress arc is easy to see. A paper plate behind the instruction block and a paper-coloured
track would fix both.

**m14. (new) Small icon on the connect screen.** The "How to connect" heading has a tiny sync-button glyph (about 30 x 65 px) that reads as the edge of a
slim controller with a red rail (crop in the session; `glyph_sync_button`). It is not a close copy of a real Joy-Con, but at this size it carries no
meaning. Drop it or enlarge it to 84 px; it is the last controller-like picture that is still drawn. Also minor: the sun of Zen is a small salmon disc
half behind a blossom and reads as a stain (round 1 m14); the small sky lanterns of Arcade (about 25 px) are fine but the one at x 1835, y 680
sits beside the bomb fuse in the test arrangement.

## Controller glyphs

`glyph_joycon_l` and `glyph_joycon_r` (design/icons) are still the same two pictures: an orange-red slim controller with a top tab, a
big thumbstick above and a four-dot diamond below (left one), so the layout and the silhouette are those of a real Joy-Con, and both are red
(the pair is a Joy-Con R twice). They are not drawn (`enabled: false`), which is the right state. Recommendation (unchanged from round 1): keep
them off until a replacement exists; the replacement should keep the pill shape but have no stick, no four-dot diamond and no top tab, be one
neutral colour (indigo or paper with an ink outline), be identical for left and right (the text says which), and carry a single dot or a wireless
arc. The mouse and keyboard glyphs are fine. Do not claim that these glyphs show the real hardware: the game does not draw the real controller
and this review did not test any.

## Numbers used

| Stage | Bomb body against background, worst of 28 positions | Orange body against background, worst | Lemon body against background, median |
|---|---|---|---|
| Classic | 3.1 to 1 (ridge, outside the rim) | 1.0 to 1 (mist, ridge) | 1.04 |
| Arcade | 8.3 to 1 | 1.5 to 1 | 1.03 |
| Zen | 6.1 to 1 | 1.3 to 1 | 1.06 |

Text on the night stage (ink 0.008): menu tagline 4.5, mode descriptions 4.2, "Best" 4.4, hint 8.1, tuning body 4.8 to 5.2, calibration body 5.3.
These are medians of the background pixels of each box and are estimates (the halo around the text raises the real value a little).

## Suggested order of fixes

1. m1, m2, m4, m11: small play-relevant polish (Zen near layer and score position, popup stroke, countdown numeral off the cursor).
2. m6, m12, m13, m14: the odd-looking bits (stray lock bar, empty disconnect panel, calibration halo, tiny glyph).
3. m3, m5, m7, m8, m9, m10: at the owner's taste. m9 first if the game will be shown on a television.
4. Replace the two controller pictures before `glyphs.enabled` is ever set to `true`.
