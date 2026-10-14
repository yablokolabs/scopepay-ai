#!/usr/bin/env node
/**
 * Check an exported MP4 for the properties this project's style actually promises.
 *
 * Reading frames by eye does not scale and is not reproducible, so this decodes
 * frames with ffmpeg and measures them:
 *
 *   - the container matches the requested resolution, frame rate and frame count
 *   - every sampled beat has ink on it (a beat that never drew is a real defect,
 *     and it looks identical to a deliberate blank frame)
 *   - nothing is clipped off the canvas: the outer border ring of every sampled
 *     frame is paper, so no text or image is bleeding past the safe area
 *   - no two *different* beats render identical frames (that means a transition did
 *     not change the scene). Two samples inside one beat may legitimately be
 *     identical: a beat that holds a still visual while narration runs over it is
 *     intended, and is reported as a hold rather than failed
 *   - the teal accent stays an accent, not a wash (reported, and flagged if the
 *     accent covers more than 2% of a frame)
 *
 * Usage:
 *   node scripts/check-export.mjs <file.mp4> [--expect-width 1920 --expect-height 1080 --expect-fps 30]
 *
 * `--at` takes the sample times in seconds, comma separated. `--beats` takes the beat
 * ranges (`start-end`, comma separated) and is what makes the duplicate rule
 * meaningful: two identical samples inside one beat are reported as a hold, while two
 * identical samples from different beats fail — that is a scene that never changed.
 *
 * Example, the six beats of the M2 demo cut:
 *   node scripts/check-export.mjs out.mp4 \
 *     --beats 0-16,16-42,42-62,62-85,85-107,107-150 \
 *     --at 8,24,38,48,58,70,80,92,102,115,140
 */
import { execFileSync } from 'node:child_process';

const PAPER = [250, 246, 238]; // --color-bg, ivory
const ACCENT = [15, 123, 114]; // --color-accent, teal
const BORDER = 8; // px ring checked for clipping
const INK_MAX_LUMA = 160; // a pixel darker than this counts as ink
const TOLERANCE = 8; // per-channel tolerance for "this pixel is paper"

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const file = process.argv[2];
if (!file) throw new Error('usage: check-export.mjs <file.mp4> [--at t1,t2,...]');

const expectWidth = Number(arg('expect-width', 1920));
const expectHeight = Number(arg('expect-height', 1080));
const expectFps = Number(arg('expect-fps', 30));
const times = (arg('at', '') || '').split(',').map((t) => t.trim()).filter(Boolean).map(Number);
/** Optional beat ranges (`start-end`, comma separated) so a hold can be told from a frozen scene. */
const beats = (arg('beats', '') || '')
  .split(',')
  .map((range) => range.trim())
  .filter(Boolean)
  .map((range, index) => {
    const [start, end] = range.split('-').map(Number);
    return { index, start, end };
  });

function beatOf(t) {
  const found = beats.find((beat) => t >= beat.start && t < beat.end);
  return found ? `beat ${found.index + 1}` : 'unknown beat';
}

function probe(...args) {
  return execFileSync('ffprobe', ['-v', 'error', ...args, file]).toString().trim();
}

/** Decode one frame to raw RGB so it can be measured rather than admired. */
function frameAt(seconds, width, height) {
  return execFileSync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 64 * 1024 * 1024 }
  );
}

function near(pixel, target) {
  return Math.abs(pixel[0] - target[0]) <= TOLERANCE && Math.abs(pixel[1] - target[1]) <= TOLERANCE && Math.abs(pixel[2] - target[2]) <= TOLERANCE;
}

const failures = [];
const report = [];

const width = Number(probe('-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0'));
const height = Number(probe('-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0'));
const fps = probe('-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0');
const frames = probe('-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0');
const duration = Number(probe('-show_entries', 'format=duration', '-of', 'csv=p=0'));

report.push(`container: ${width}x${height} @ ${fps} fps, ${frames} frames, ${duration.toFixed(3)}s`);
if (width !== expectWidth || height !== expectHeight) failures.push(`resolution is ${width}x${height}, expected ${expectWidth}x${expectHeight}`);
if (Number(frames) !== Math.round(duration * expectFps)) failures.push(`${frames} frames does not match ${duration.toFixed(3)}s at ${expectFps}fps`);

const seen = new Map();
for (const t of times) {
  const raw = frameAt(t, width, height);
  if (raw.length !== width * height * 3) {
    failures.push(`t=${t}s: decoded ${raw.length} bytes, expected ${width * height * 3}`);
    continue;
  }
  let ink = 0;
  let accent = 0;
  let borderOffPaper = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const pixel = [raw[i], raw[i + 1], raw[i + 2]];
      const luma = 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
      if (luma < INK_MAX_LUMA) ink += 1;
      if (near(pixel, ACCENT)) accent += 1;
      const onBorder = x < BORDER || y < BORDER || x >= width - BORDER || y >= height - BORDER;
      if (onBorder && !near(pixel, PAPER)) borderOffPaper += 1;
    }
  }
  const total = width * height;
  const inkShare = (ink / total) * 100;
  const accentShare = (accent / total) * 100;
  const borderShare = (borderOffPaper / total) * 100;

  let fingerprint = 0;
  for (let i = 0; i < raw.length; i += 4096) fingerprint = (fingerprint * 31 + raw[i]) % 2147483647;

  const twin = seen.get(fingerprint);
  if (twin !== undefined) {
    if (beats.length > 0 && beatOf(t) === beatOf(twin)) {
      report.push(`t=${String(t).padStart(5)}s  hold: identical to t=${twin}s inside the same ${beatOf(t)}, which is what a held visual looks like`);
    } else {
      failures.push(`t=${t}s is visually identical to t=${twin}s but they are in different scenes (${beatOf(twin)} vs ${beatOf(t)})`);
    }
  } else {
    seen.set(fingerprint, t);
  }

  if (inkShare < 0.2) failures.push(`t=${t}s has almost no ink (${inkShare.toFixed(2)}%): the beat may not have drawn`);
  if (borderShare > 0) failures.push(`t=${t}s has ${borderOffPaper} pixels on the ${BORDER}px border ring that are not paper: something is clipped`);
  if (accentShare > 2) failures.push(`t=${t}s: teal covers ${accentShare.toFixed(2)}% of the frame, so it is a wash rather than an accent`);

  report.push(`t=${String(t).padStart(5)}s  ink ${inkShare.toFixed(2)}%  accent ${accentShare.toFixed(3)}%  border-clean ${borderShare === 0 ? 'yes' : 'NO'}`);
}

console.log(report.join('\n'));
if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nall checks passed on ${times.length} sampled frames`);
