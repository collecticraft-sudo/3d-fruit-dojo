# 3D Fruit Dojo

[![tests](https://github.com/collecticraft-sudo/3d-fruit-dojo/actions/workflows/test.yml/badge.svg)](https://github.com/collecticraft-sudo/3d-fruit-dojo/actions/workflows/test.yml)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-3c873a)
![licence: MIT code, art all rights reserved](https://img.shields.io/badge/licence-MIT%20code%20%7C%20art%20all%20rights%20reserved-blue)

![3D Fruit Dojo gameplay: Classic and Arcade modes with combos, played by the built-in simulator bot](docs/img/hero.gif)

*Eight seconds of real gameplay, played by the built-in simulator bot.*

**Slice fruit by swinging a katana.** 3D Fruit Dojo is a fruit-slicing game that runs in your browser. The idea: a Nintendo Switch 2 **Joy-Con 2** sits on the hilt of a 3D-printed katana, and the way you swing it moves the blade on screen. No Joy-Con? The mouse and a built-in simulator work too.

It is a small web game with no dependencies: a tiny Node server, plus a native Bluetooth helper for macOS.

**Watch the 28-second video:** download `3d-fruit-dojo-presentation.mp4` from the [v1.0.0 release](https://github.com/collecticraft-sudo/3d-fruit-dojo/releases/tag/v1.0.0). It shows real gameplay played by a bot, and the katana is an illustration.

## Play it in two minutes

```bash
git clone https://github.com/collecticraft-sudo/3d-fruit-dojo.git
cd 3d-fruit-dojo
./start.command        # or: npm start, then open http://localhost:8137
```

You need a Mac, [Node.js](https://nodejs.org) 22 or newer (`brew install node`) and Google Chrome. For a real Joy-Con 2 you also need Apple's Command Line Tools (`xcode-select --install`), because the Bluetooth helper is compiled once, on first start.

No controller? On the connect screen choose **Simulator** or **Mouse only**, or open `http://localhost:8137/?input=sim`.

## Using a real Joy-Con 2

1. Mount the Joy-Con firmly on the hilt. Any way that does not wobble is fine: the game works out how it sits.
2. Start the game with `start.command` (from Terminal) and accept the safety screen. The first time, macOS asks whether Terminal may use Bluetooth: choose **Allow**.
3. Press **Connect Joy-Con** and hold the controller's **SYNC** button (next to the USB-C port) until its lights sweep. Never pair it in the macOS Bluetooth settings.
4. Follow the four short calibration screens (about 20 seconds), then play.

You hold SYNC again every session. The [guide](docs/GUIDE.md) has the whole procedure with pictures.

## How to play

Turn the sword and the cursor follows, like a mouse. Hold still and nothing moves. A cut only counts when the blade moves fast, so you can aim calmly and slash hard. Cut the fruit, dodge the bombs.

- **Classic**: three lives, survive as long as you can.
- **Arcade**: 60 seconds, best score. Bombs cost points and time.
- **Zen**: 90 calm seconds, no bombs.

Combos (several fruit in one swing), a Golden Apple and four power-ups (Freeze, Frenzy, Double, Clock) add some spice. Your best scores stay in your browser. The game never uses the network.

| | Right Joy-Con | Keyboard |
|---|---|---|
| Move in menus | stick | arrow keys |
| Confirm / back | A / B | Enter / Esc |
| Pause | + | P |
| Re-centre the cursor | ZR | Space |

Every action also works without a button, because buttons can be hard to reach on a sword. The Left Joy-Con, every setting and the rules in detail are in [the reference](docs/REFERENCE.md).

## Safety

You are swinging a sword-shaped object in a room. Keep 2 metres of free space around you, keep people, pets and fragile things away, and never play near stairs. Mount the Joy-Con firmly and always use the wrist strap. Take a 5-minute break for every 15 minutes of play, and stop if anything hurts. Children should play with an adult present. The game's first screen says all this, and Settings has "Reduce flashes" for people sensitive to flashing effects.

## Honest status

Nobody on the team could touch a real Joy-Con 2 except the owner, so only what the owner saw on real hardware counts as checked.

- **Checked on one real Joy-Con 2 Right:** it connects through the native bridge and streams at a steady 33 reports per second; the sensor scales and noise; the resting centre of the stick. The owner played the game, and the controls, hit boxes, fonts and effects were changed after that feedback.
- **Not checked on hardware (UNVERIFIED-ON-HARDWARE):** how the sword feels now, the real delay from swing to screen, the Left Joy-Con, the stick's full travel, whether A and B are within reach on a sword, the sound by ear, Chrome's own Bluetooth path, and the frame rate on a real display.
- Test results and speed numbers come from the development Mac (headless Chrome). They say nothing about your hardware.

A 10-minute [hardware checklist](docs/GUIDE.md#11-hardware-checklist) in the guide turns those open items into facts. The full list is in [`docs/FINAL-STATUS.md`](docs/FINAL-STATUS.md).

## Something not working?

| Symptom | What to do |
|---|---|
| "macOS is not letting this app use Bluetooth" | Quit, start again with `start.command` from Terminal and answer **Allow**. Already refused: System Settings > Privacy & Security > Bluetooth, switch Terminal on. |
| "No Joy-Con found." | Hold SYNC until the lights sweep, close to the Mac, right after pressing it. Switch the console off. After many tries wait a minute: the controller refuses repeated connects. |
| "The Bluetooth bridge is not available." | Run `xcode-select --install` once, then start again with `start.command`. The mouse and the simulator work meanwhile. |
| No sound | Click once anywhere on the page, then check `M` and the volume setting. |

More answers are in the guide's [troubleshooting table](docs/GUIDE.md#10-troubleshooting).

## For developers

```bash
npm test             # everything: unit, integration and headless-Chrome end-to-end (needs Chrome)
npm run test:unit    # everything except the browser tests
```

Zero dependencies, and the tests use Node's built-in runner only. Some URL flags (all optional, joined with `&`):

| Flag | Effect |
|---|---|
| `input` | `native`, `joycon`, `sim` or `mouse`: choose the control method at start |
| `mode` | `classic`, `arcade` or `zen`: skip the menu |
| `seed` | a fixed seed, so every round throws the same fruit |
| `assets` | `0` turns the generated art off: the procedural paper-and-ink drawing takes over and no image or font file is requested |
| `debug` | `1` shows frame rate, blade speed and hit circles |

All the flags, the `window.__ninja` automation API, performance numbers, the art layer, the project layout, the known limitations and how the project was made are in [`docs/REFERENCE.md`](docs/REFERENCE.md). The art layer's contract is [`docs/assets-integration.md`](docs/assets-integration.md) and the shipped files are described in [`docs/assets.md`](docs/assets.md). What the project learned about motion controls, written for the next game, is in [`playbook/NEW-GAME-PLAYBOOK.md`](playbook/NEW-GAME-PLAYBOOK.md).

## Credits and licences

- Game design, direction, hardware testing and the 3D-printed katana: collecticraft-sudo.
- Made with AI tools: the art was generated with Higgsfield GPT Image 2.5, and the code, tests and documents were written and reviewed by AI agents (Claude, from Anthropic) under the owner's direction.
- Fonts: Lilita One and Fredoka (SIL OFL 1.1). Video music: "Happy Beats / Business Moves" by Sascha Ende (ende.app), CC BY 4.0. Video sound effects: Kenney (kenney.nl), CC0. The Joy-Con 2 protocol comes from public community research (ndeadly, Peterksharma, JoeGeC, TheFrano, seitanmen, mascii and others). The full list is in [`CREDITS.md`](CREDITS.md).
- **Code: MIT** ([`LICENSE`](LICENSE)). **Art, logo, name and video: all rights reserved** ([`LICENSE-ASSETS.md`](LICENSE-ASSETS.md)): you may run the game and look at the art, but not reuse it elsewhere without permission.
- **Nintendo, Nintendo Switch 2 and Joy-Con are trademarks of Nintendo. This project is not affiliated with, endorsed by or sponsored by Nintendo.** It talks to the controller over standard Bluetooth Low Energy, using public community research.

*Naming note: the game was renamed from "Joy-Con Ninja" on 2026-09-30. The code name `joycon-ninja` stays in the folder, in the package name, in `window.__ninja` and in the browser storage keys `joyconNinja.*`, so that saved scores and settings survive. The old review reports in `docs/` keep the old name Joy-Con Ninja.*
