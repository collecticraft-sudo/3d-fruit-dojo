// ffmpeg wrappers for the asset pipeline (docs/assets-integration.md 1.1). OWNER: Asset engineer.
//
// ffmpeg is started with child_process.execFile and an argument array, never through a shell string. It is needed only to BUILD the
// assets: the shipped files are committed, so the game and its tests never need it.
//
// Determinism: `-fflags +bitexact -flags:v +bitexact -map_metadata -1` keep encoder versions and timestamps out of the files.

import { execFile } from 'node:child_process';

/** An error whose message is meant to be shown to the person who ran the tool (no stack trace). */
export class BuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildError';
  }
}

/** Run ffmpeg or ffprobe. Resolves with {stdout, stderr}; rejects with a BuildError that carries the tail of ffmpeg's message. */
export function run(bin, args, { timeoutMs = 180_000, maxBuffer = 64 * 1024 * 1024, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer, encoding, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') return reject(new BuildError(`${bin} was not found`));
        const tail = String(stderr || err.message).trim().split('\n').slice(-6).join('\n');
        return reject(new BuildError(`${bin} failed (${err.killed ? 'timeout' : `exit ${err.code}`}):\n${tail}`));
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Check that ffmpeg exists and has the filters the pipeline needs (premultiply, unpremultiply, scale). Throws a BuildError with an
 * instruction when it does not.
 * @returns {Promise<{bin:string, version:string}>}
 */
export async function checkFfmpeg(bin = process.env.FFMPEG || 'ffmpeg') {
  let version;
  try {
    const { stdout } = await run(bin, ['-hide_banner', '-version'], { timeoutMs: 15_000 });
    version = stdout.split('\n')[0].trim();
  } catch (err) {
    throw new BuildError(
      [
        `ffmpeg is required to build the game art and was not found (tried "${bin}").`,
        'Install it (macOS: "brew install ffmpeg", Debian or Ubuntu: "sudo apt install ffmpeg") and run the command again,',
        'or set the FFMPEG environment variable to the path of the executable.',
        'The game itself never needs ffmpeg: the built files are committed under public/assets/.',
        `(${err.message})`,
      ].join('\n'),
    );
  }
  const { stdout } = await run(bin, ['-hide_banner', '-filters'], { timeoutMs: 15_000 });
  const missing = ['premultiply', 'unpremultiply', 'scale'].filter((name) => !new RegExp(`\\s${name}\\s`).test(stdout));
  if (missing.length) throw new BuildError(`this ffmpeg (${version}) lacks the filter(s): ${missing.join(', ')}. Install a recent ffmpeg (4.0 or newer).`);
  return { bin, version };
}

const BITEXACT = ['-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1'];

/**
 * Arguments that write one PNG. With a target size the image is scaled in premultiplied alpha (so that transparent pixels never bleed
 * their hidden colour into the edge: no dark or light fringe) with a Lanczos filter; without one it is only re-encoded, losslessly.
 * Sprites: -compression_level 9 -pred mixed (contract 1.1).
 */
export function pngArgs(src, dst, size) {
  const filter = size
    ? `format=gbrap16le,premultiply=inplace=1,scale=${size.w}:${size.h}:flags=lanczos,unpremultiply=inplace=1,format=rgba`
    : 'format=rgba';
  return ['-y', '-v', 'error', '-nostdin', '-i', src, '-frames:v', '1', '-vf', filter, '-compression_level', '9', '-pred', 'mixed', ...BITEXACT, '-update', '1', dst];
}

/** Arguments that write one baseline JPEG far layer: -q:v <quality> -pix_fmt yuvj420p -huffman optimal (contract 1.1). */
export function jpegArgs(src, dst, size, quality) {
  return ['-y', '-v', 'error', '-nostdin', '-i', src, '-frames:v', '1', '-vf', `scale=${size.w}:${size.h}:flags=lanczos`, '-q:v', String(quality), '-pix_fmt', 'yuvj420p', '-huffman', 'optimal', ...BITEXACT, '-update', '1', dst];
}

/** Decode any image ffmpeg reads to raw RGB24 at the given size (area filter): used to measure the far JPEG layers. */
export async function decodeRawRgb(bin, file, size) {
  const args = ['-v', 'error', '-nostdin', '-i', file, '-frames:v', '1', '-vf', `scale=${size.w}:${size.h}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'];
  const { stdout } = await run(bin, args, { encoding: 'buffer', maxBuffer: size.w * size.h * 3 + 1024 });
  if (stdout.length !== size.w * size.h * 3) throw new BuildError(`ffmpeg returned ${stdout.length} bytes for ${file}, expected ${size.w * size.h * 3}`);
  return stdout;
}

/** MD5 of the decoded frames of an image file (used by --check to compare two encodings of the same picture). */
export async function decodedMd5(bin, file) {
  const { stdout } = await run(bin, ['-v', 'error', '-nostdin', '-i', file, '-frames:v', '1', '-f', 'md5', '-'], { timeoutMs: 120_000 });
  return stdout.trim();
}
