#!/usr/bin/env node
/**
 * Local patch for an upstream packaging bug in videowright 0.1.x.
 *
 * videowright's package.json `files` field publishes only `dist`, `skill` and
 * `src/cli/entry`, but two of those published entry files import the package root
 * by source path:
 *
 *   src/cli/entry/render_entry.ts      -> from "../../index.js"      (src/index.ts, not shipped)
 *   src/cli/entry/views/video_view.ts  -> from "../../../index.js"   (src/index.ts, not shipped)
 *
 * So `videowright render` dies with:
 *   Failed to resolve import "../../index.js" from
 *   "node_modules/videowright/src/cli/entry/render_entry.ts"
 * and the page never signals render-ready (page.waitForFunction Timeout 30000ms).
 *
 * The built entry point *is* shipped (`dist/index.js`), so repointing those two
 * relative specifiers at it is a pure path fix. This runs on postinstall because
 * node_modules is not committed: a fresh `npm install` reproduces the working
 * tree instead of silently reverting to a broken one.
 *
 * Remove this script once upstream ships the file its own entry imports.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'node_modules', 'videowright', 'src', 'cli', 'entry');

/**
 * Published file -> the relative specifier it should use to reach the shipped build.
 *
 * The depth matters: from `src/cli/entry/`, `../../` is `src/` (which is why the
 * original import resolved to the unshipped `src/index.ts`). Reaching the published
 * `dist/` therefore needs one more level than the original specifier, not the same
 * number of levels — getting that wrong yields `src/dist/index.js`, which Vite
 * reports as the same "Failed to resolve import" error and looks like the fix
 * simply did not apply.
 */
const fixes = [
  { file: 'render_entry.ts', from: '"../../index.js"', to: '"../../../dist/index.js"', expect: join('dist', 'index.js') },
  { file: join('views', 'video_view.ts'), from: '"../../../index.js"', to: '"../../../../dist/index.js"', expect: join('dist', 'index.js') }
];

// Verify the replacement actually resolves from that file, before writing it.
for (const fix of fixes) {
  const target = join(entry, dirname(fix.file), fix.to.replace(/^"|"$/g, ''));
  if (!existsSync(target)) {
    throw new Error(`patch would not resolve: ${fix.file} -> ${fix.to} (looked for ${target})`);
  }
}

if (!existsSync(entry)) {
  console.log('patch-videowright: videowright is not installed yet; nothing to patch.');
  process.exit(0);
}

for (const { file, from, to } of fixes) {
  const path = join(entry, file);
  if (!existsSync(path)) {
    console.log(`patch-videowright: ${file} not present; skipped.`);
    continue;
  }
  const source = readFileSync(path, 'utf8');
  if (source.includes(to)) {
    console.log(`patch-videowright: ${file} already patched.`);
    continue;
  }
  if (!source.includes(from)) {
    console.log(`patch-videowright: ${file} does not contain ${from}; upstream may have fixed it.`);
    continue;
  }
  writeFileSync(path, source.split(from).join(to));
  console.log(`patch-videowright: ${file} ${from} -> ${to}`);
}

// The build output must exist for the fix to resolve.
const dist = join(root, 'node_modules', 'videowright', 'dist', 'index.js');
console.log(`patch-videowright: dist/index.js ${existsSync(dist) ? 'present' : 'MISSING'}`);
