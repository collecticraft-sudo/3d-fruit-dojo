# Credits

## People and tools

- Game design, direction, hardware testing, the 3D-printed sword and every decision: the owner of this repository (collecticraft-sudo). Only the owner touched the real controller.
- Code, tests, documentation and the presentation video: built, tested and reviewed by a team of AI agents working with Claude (Anthropic) under the owner's direction. Nobody on the AI side could hold a Joy-Con; see "Honest status" in the README and `docs/FINAL-STATUS.md`.
- Art: generated with Higgsfield GPT Image 2.5 (`gpt_image_2_5`). Provenance of every picture: `design/assets.csv`, `public/assets/PROVENANCE.csv`.
- Narration of the video: Higgsfield text-to-speech.
- Video: HyperFrames (HeyGen, npm package `hyperframes`) and ffmpeg.

## Fonts (SIL Open Font License 1.1)

- **Lilita One** by Juan Montoreano (display text). https://fonts.google.com/specimen/Lilita+One
- **Fredoka** by The Fredoka Project Authors (interface text). https://fonts.google.com/specimen/Fredoka

The licence texts are in `design/fonts/licenses/` and `public/assets/fonts/`. Details of the subsetting: `docs/typography.md`.

## Music and sound (presentation video only)

- Music: "Happy Beats / Business Moves" by Sascha Ende (https://ende.app), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Shortened to the length of the video, faded, and lowered under the narration.
- Sound effects: Kenney (https://kenney.nl), CC0 1.0. The list of the files used is in `video/CREDITS.md`.

The video credit line, as burned into its last scene: "Music: Happy Beats / Business Moves by Sascha Ende (ende.app), CC BY 4.0. Sound effects: Kenney (kenney.nl), CC0. Voice and art: Higgsfield (GPT Image 2.5). Built with Claude."

## Research that made the controller work

The Joy-Con 2 Bluetooth protocol was reverse engineered by the community, and this project would not exist without them. The sources, with their licences and how far each one was trusted, are listed in `docs/joycon2-protocol.md` (sources table) and `docs/protocol-audit.md`. Among them: ndeadly (switch2_controller_research), Peterksharma (switch2mac), JoeGeC (joycon2android), TheFrano (joycon2cpp), seitanmen (Joycon2forMac), mascii (Web Bluetooth demo) and the SDL project. Facts (UUIDs, offsets, constants) were reused and no code was copied (one of the projects is GPL-3.0 and several have no licence, so the code here is written from scratch, as `docs/joycon2-protocol.md` says); the owner's real controller then confirmed that it connects and streams.

## Trademarks

Nintendo and Joy-Con are trademarks of Nintendo. This project has no affiliation with Nintendo.
