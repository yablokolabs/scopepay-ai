#!/usr/bin/env node
/**
 * Build a caption file for a video from the video's own beats.
 *
 * Videowright has no caption support, so this reads the two things the project
 * already declares — the order of segments in `timeline.ts` and, from each segment
 * module, its `advances` and its `voiceover` — and derives one cue per line of
 * narration. Importing the real modules (rather than parsing them) is deliberate:
 * `node --experimental-strip-types` loads them, so the captions cannot drift from
 * the segments they describe.
 *
 * Without `--voiceover`, cue times are estimated from each segment's `advances` and
 * the output is marked provisional. With `--voiceover <slug>`, each cue runs from its
 * first spoken word to its last, read from that voiceover's `timing.json`; the words
 * must match the segments' narration exactly, or the build fails.
 *
 * Usage (from the videos/ directory):
 *   node --experimental-strip-types scripts/build-captions.mjs <video-slug> [--expect-duration 98] [--voiceover v1]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { register } from 'node:module';

// Segments import their own .png media and timelines import .css; Node cannot load
// either, so stub those specifiers before importing any segment module.
register('./asset-stub-hooks.mjs', import.meta.url);

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // videos/
const MAX_LINE = 42; // characters per caption line
const MAX_LINES = 2;
const MIN_CUE = 1.0; // seconds; shorter cues cannot be read
const READING_RATE = 14; // characters per second a viewer can comfortably read

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const slug = process.argv[2];
if (!slug) throw new Error('usage: build-captions.mjs <video-slug> [--expect-duration <seconds>]');
const expectDuration = arg('expect-duration', null);
const voiceoverSlug = arg('voiceover', null);

/** Segment ids in the order the timeline plays them. */
async function segmentsInOrder(timelinePath) {
  const source = await readFile(timelinePath, 'utf8');
  const ids = [...source.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((match) => match[1]);
  if (ids.length === 0) throw new Error(`no segments found in ${timelinePath}`);
  return ids;
}

/** Wrap narration into caption-sized lines, greedily, without splitting words. */
function linesOf(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line === '' ? word.length <= MAX_LINE : `${line} ${word}`.length <= MAX_LINE) {
      line = line === '' ? word : `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function stamp(seconds, separator) {
  const clamped = Math.max(0, seconds);
  const whole = Math.floor(clamped);
  const ms = Math.round((clamped - whole) * 1000);
  const s = String(whole % 60).padStart(2, '0');
  const m = String(Math.floor(whole / 60) % 60).padStart(2, '0');
  const h = String(Math.floor(whole / 3600)).padStart(2, '0');
  return `${h}:${m}:${s}${separator}${String(ms).padStart(3, '0')}`;
}

const timelinePath = join(ROOT, 'videos', slug, 'timeline.ts');
const ids = await segmentsInOrder(timelinePath);

const beats = [];
let cursor = 0;
for (const id of ids) {
  const modulePath = join(ROOT, 'segments', id, 'index.ts');
  const segment = (await import(pathToFileURL(modulePath).href)).default;
  if (segment.id !== id) throw new Error(`${id}: the segment calls itself "${segment.id}" but lives in segments/${id}/`);
  const duration = segment.advances.at(-1);
  if (typeof duration !== 'number' || duration <= 0) throw new Error(`${id}: no usable advances`);
  beats.push({ id, start: cursor, end: cursor + duration, text: String(segment.voiceover ?? '').trim() });
  cursor += duration;
}
const total = cursor;

if (expectDuration !== null && Math.abs(total - Number(expectDuration)) > 0.01) {
  throw new Error(`beats total ${total.toFixed(2)}s but the video is ${expectDuration}s`);
}

/**
 * One cue per caption-sized group of lines. A cue lasts at least as long as its text
 * takes to read at READING_RATE, and when a beat's narration does not fit its span
 * every cue in that beat is squeezed proportionally — the beat is then reported, because
 * it means that segment's advance is too short for what the narration says.
 */
const cues = [];
const tightBeats = [];
const normal = (word) => word.toLowerCase().replace(/[^a-z0-9']/g, '');
if (voiceoverSlug !== null) {
  const timingPath = join(ROOT, 'videos', slug, 'audio', 'originals', 'voiceovers', voiceoverSlug, 'timing.json');
  // SSML break tags in the provider script come back as tokens; they are not speech.
  const spoken = JSON.parse(await readFile(timingPath, 'utf8')).words.filter(
    (w) => !/^<|^time=|^\/>$/.test(w.word) && normal(w.word) !== ''
  );
  let next = 0;
  for (const beat of beats) {
    for (const group of [linesOf(beat.text)].flatMap((lines) => {
      const groups = [];
      for (let i = 0; i < lines.length; i += MAX_LINES) groups.push(lines.slice(i, i + MAX_LINES));
      return groups;
    })) {
      const words = group.join(' ').split(/\s+/).filter((w) => normal(w) !== '');
      const first = spoken[next];
      for (const word of words) {
        if (!spoken[next] || normal(spoken[next].word) !== normal(word)) {
          throw new Error(`${beat.id}: narration "${word}" does not match spoken "${spoken[next]?.word}" in ${timingPath}`);
        }
        next++;
      }
      cues.push({ segment: beat.id, start: first.start, end: Math.max(spoken[next - 1].end, first.start + MIN_CUE), lines: group });
    }
  }
  if (next !== spoken.length) throw new Error(`${spoken.length - next} spoken words have no narration in the segments`);
  // A cue held for MIN_CUE must not run into the next one.
  for (let i = 0; i + 1 < cues.length; i++) cues[i].end = Math.min(cues[i].end, cues[i + 1].start);
}
for (const beat of voiceoverSlug === null ? beats : []) {
  if (beat.text === '') continue;
  const lines = linesOf(beat.text);
  const groups = [];
  for (let i = 0; i < lines.length; i += MAX_LINES) groups.push(lines.slice(i, i + MAX_LINES));
  const span = beat.end - beat.start;
  const wanted = groups.map((group) => Math.max(MIN_CUE, group.join(' ').length / READING_RATE));
  const needed = wanted.reduce((sum, seconds) => sum + seconds, 0);
  const scale = needed > span ? span / needed : 1;
  if (needed > span) tightBeats.push(`${beat.id} (narration needs ${needed.toFixed(1)}s in a ${span.toFixed(1)}s beat)`);
  let at = beat.start;
  for (const [index, group] of groups.entries()) {
    const end = Math.min(beat.end, at + Math.max(MIN_CUE * 0.5, wanted[index] * scale));
    cues.push({ segment: beat.id, start: at, end, lines: group });
    at = end;
  }
}

const srt = cues
  .map((cue, index) => `${index + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cue.lines.join('\n')}\n`)
  .join('\n');
const vtt = `WEBVTT\n\n${cues
  .map((cue, index) => `${index + 1}\n${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cue.lines.join('\n')}\n`)
  .join('\n')}`;

const outDir = join(ROOT, 'videos', slug, 'captions');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, `${slug}.srt`), srt, 'utf8');
await writeFile(join(outDir, `${slug}.vtt`), vtt, 'utf8');
await writeFile(
  join(outDir, 'captions.json'),
  `${JSON.stringify(
    {
      slug,
      provisional: voiceoverSlug === null,
      reason:
        voiceoverSlug === null
          ? 'Cues are derived from each segment\'s `advances`, which estimate narration pacing. Rebuild with --voiceover once synthesized narration exists.'
          : `Cue times are the spoken words' own timestamps from voiceover ${voiceoverSlug}.`,
      totalSeconds: voiceoverSlug === null ? total : cues.at(-1).end,
      cues: cues.length
    },
    null,
    2
  )}\n`,
  'utf8'
);

if (voiceoverSlug === null) console.log(`beats: ${beats.map((beat) => `${beat.id} ${beat.start.toFixed(0)}-${beat.end.toFixed(0)}s`).join(', ')}`);
console.log(`cues: ${cues.length} over ${(voiceoverSlug === null ? total : cues.at(-1).end).toFixed(2)}s, fastest ${Math.min(...cues.map((cue) => cue.end - cue.start)).toFixed(2)}s`);
if (tightBeats.length > 0) console.log(`tight beats (narration does not fit the current advance):\n  - ${tightBeats.join('\n  - ')}`);
console.log(`wrote ${resolve(outDir)}/${slug}.srt, ${slug}.vtt, captions.json`);
