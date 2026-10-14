#!/usr/bin/env node
/**
 * Rasterise the architecture diagram the way diagram-design's references/export.md
 * prescribes: render the source HTML, await document.fonts.ready, screenshot only the
 * <svg> element at 2x. It is a Node port because Playwright is installed here for the
 * video toolchain, not in Python.
 *
 * It refuses to write a PNG if the diagram's fonts did not load: a silent fallback
 * renders, but it is not the diagram that was drawn.
 *
 * Usage:
 *   node scripts/export-diagram.mjs <diagram.html> <out.png> [<out.png> ...]
 */
import { chromium } from '@playwright/test';
import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [html, first, ...rest] = process.argv.slice(2);
if (!html || !first) {
	console.error('usage: export-diagram.mjs <diagram.html> <out.png> [<out.png> ...]');
	process.exit(2);
}

const [, , vbW, vbH] = readFileSync(html, 'utf8').match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: vbW, height: vbH }, deviceScaleFactor: 2 });
await page.goto(`file://${resolve(html)}`, { waitUntil: 'networkidle' });
// The page frame puts the <svg> at a fractional offset, which shifts every edge by half
// a device pixel and makes the element box round outward. Pinning it to the viewport
// origin at viewBox size gives 1 user unit = 1 CSS px on whole pixels.
await page.addStyleTag({ content: `svg { position: fixed; left: 0; top: 0; width: ${vbW}px !important; min-width: 0; }` });
await page.evaluate(() => document.fonts.ready);

const missing = await page.evaluate(() =>
	["600 12px 'Geist'", "9px 'Geist Mono'"].filter((f) => !document.fonts.check(f)),
);
if (missing.length) {
	await browser.close();
	console.error(`fonts not loaded: ${missing.join(', ')}`);
	process.exit(1);
}

await page.locator('svg').first().screenshot({ path: first, omitBackground: true });
await browser.close();
for (const out of rest) copyFileSync(first, out);
console.log([first, ...rest].join('\n'));
