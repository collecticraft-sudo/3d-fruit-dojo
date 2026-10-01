#!/usr/bin/env bash
# STAGE 2 helper: sync the art, footage and audio, run the gate, render the final video, print the QA numbers.
# Usage: video/tools/render-final.sh [draft]      ("draft" = 15 fps quick look at 960x540 instead of the final 1080p/30 fps)
# Needs the real clips in video/footage/ (see video/capture-list.md); it refuses to render the final if a clip is still a placeholder.
set -euo pipefail
export HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_TELEMETRY=1
HERE="$(cd "$(dirname "$0")/.." && pwd)"
HF="npx --yes hyperframes@0.8.104"
MODE="${1:-final}"
cd "$HERE"
node tools/build-captions.mjs
node tools/fit-footage.mjs          # sets data-media-start of the footage slots from footage/*.events.json
node tools/build-audio.mjs          # places the slice sounds from footage/*.events.json when they exist
SYNC="$(./tools/sync-assets.sh)"; echo "$SYNC"
if [ "$MODE" = "final" ] && echo "$SYNC" | grep -qE "PLACEHOLDER|MISSING"; then echo "refusing to render the final: some clips are placeholders or missing (see above)"; exit 1; fi
cd composition
$HF check
mkdir -p renders
if [ "$MODE" = "draft" ]; then
  $HF render --quality draft --fps 15 --output renders/draft-1080p-15fps.mp4
  ffmpeg -y -loglevel error -i renders/draft-1080p-15fps.mp4 -vf scale=960:540 -c:v libx264 -crf 24 -preset fast -c:a aac -b:a 128k ../draft/draft-960x540.mp4
  echo "draft: video/draft/draft-960x540.mp4"; exit 0
fi
$HF render --quality delivery --fps 30 --output renders/3d-fruit-dojo-presentation.mp4
RAW=renders/3d-fruit-dojo-presentation.mp4
test -s "$RAW"
# loudness: the mix comes out of the renderer about 3 LU too quiet (about -19 LUFS); a two-pass linear loudnorm to -16 LUFS integrated, true peak -1.5 dBTP.
# The picture stream is copied untouched, only the audio is re-encoded (AAC 192 kb/s).
M="$(ffmpeg -hide_banner -i "$RAW" -vn -af loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')"
v() { echo "$M" | grep "\"$1\"" | sed 's/[^0-9.-]*\(-\{0,1\}[0-9.]*\).*/\1/'; }
OUT=renders/3d-fruit-dojo-presentation-loud.mp4
ffmpeg -y -loglevel error -i "$RAW" -map 0:v -map 0:a -c:v copy -af "loudnorm=I=-16:TP=-1.5:LRA=9:measured_I=$(v input_i):measured_TP=$(v input_tp):measured_LRA=$(v input_lra):measured_thresh=$(v input_thresh):offset=$(v target_offset):linear=true,aresample=48000" -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"
test -s "$OUT"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt:format=duration,size -of compact "$OUT"
ffmpeg -hide_banner -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|LRA|Peak):" | tail -3
ffmpeg -hide_banner -i "$OUT" -vf "blackdetect=d=0.2:pic_th=0.98" -an -f null - 2>&1 | grep -E "black_start" || echo "no black frames longer than 0.2 s"
cp "$OUT" "$HERE/3d-fruit-dojo-presentation.mp4"
echo "final: video/3d-fruit-dojo-presentation.mp4"
