#!/usr/bin/env bash
# Copies the game art, the footage and the audio into the HyperFrames project (video/composition/).
# Run it again whenever public/assets (the game art), video/footage or video/audio change (stage 2 re-runs it after the restyling).
# Sources of truth: public/assets (shipped art), design/phase1 + design/phase2 (raw art sheets), video/footage, video/audio.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"        # video/
ROOT="$(cd "$HERE/.." && pwd)"                  # project root
C="$HERE/composition"
A="$ROOT/public/assets"
mkdir -p "$C/assets/bg" "$C/assets/sprites" "$C/assets/ui" "$C/assets/fx" "$C/assets/icons" "$C/assets/sheets" "$C/footage" "$C/audio"

# backdrops: far / mid / near for the three stages
for s in classic arcade zen; do
  for l in far mid near; do
    f=$(ls "$A/backgrounds/bg_${s}_${l}".* | head -1)
    cp -f "$f" "$C/assets/bg/"
  done
done
# sprites, ui, fx, icons
cp -f "$A"/sprites/*.png "$C/assets/sprites/"
cp -f "$A"/ui/logo_title.png "$A"/ui/cursor_idle.png "$A"/ui/cursor_cutting.png "$C/assets/ui/"
cp -f "$A"/fx/*.png "$C/assets/fx/"
cp -f "$A"/icons/icon_freeze.png "$A"/icons/icon_combo.png "$A"/icons/icon_warning.png "$A"/icons/icon_trophy.png "$C/assets/icons/" 2>/dev/null || true

# raw art sheets (the generated sheets that were sliced into sprites), downscaled to JPEG on near-black
for s in phase1/sheet_apple phase1/sheet_orange phase1/sheet_strawberry phase1/sheet_watermelon phase1/sheet_golden phase1/sheet_splash phase2/sheet_cherry phase2/sheet_kiwi phase2/sheet_lemon phase2/sheet_peach phase2/sheet_pear phase2/sheet_pineapple; do
  b=$(basename "$s")
  [ -f "$C/assets/sheets/$b.jpg" ] && [ "$C/assets/sheets/$b.jpg" -nt "$ROOT/design/$s.png" ] && continue
  ffmpeg -y -loglevel error -f lavfi -i color=c=0x0b0c10:s=2688x1520 -i "$ROOT/design/$s.png" -filter_complex "[0][1]overlay=0:0:shortest=1,scale=1920:-2" -frames:v 1 -q:v 3 "$C/assets/sheets/$b.jpg"
done

# footage (placeholders or real clips) and audio
for n in classic arcade zen combo bomb freeze; do
  if [ -f "$HERE/footage/$n.mp4" ]; then
    cp -f "$HERE/footage/$n.mp4" "$C/footage/$n.mp4"
    if [ -f "$HERE/footage/$n.placeholder" ] && [ ! "$HERE/footage/$n.mp4" -nt "$HERE/footage/$n.placeholder" ]; then echo "  footage/$n.mp4: PLACEHOLDER slate"; else echo "  footage/$n.mp4: real footage"; fi
  else echo "  footage/$n.mp4: MISSING"; fi
done
if [ -d "$HERE/audio/final" ]; then cp -f "$HERE"/audio/final/narration.wav "$HERE"/audio/final/music.mp3 "$HERE"/audio/final/sfx.wav "$C/audio/"; fi
echo "synced into $C"
