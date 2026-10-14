#!/usr/bin/env node
/**
 * Check the architecture diagram for the defects diagram-design's own checkers miss.
 *
 * `verify-geometry.py` only reports a label mask covered by a later node. It does not
 * see a connector that ends in empty space, or two labels drawn over each other. This
 * renders the SVG in Chromium and measures it:
 *
 *   - every connector starts and ends on a node edge (within 2px)
 *   - no two text runs overlap
 *   - each PNG given is a faithful raster of the SVG: it is compared pixel by pixel
 *     against a fresh render, so an export that dropped the text fails
 *
 * Usage:
 *   node scripts/check-diagram.mjs <diagram.svg> [<export.png> ...]
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [svgPath, ...pngPaths] = process.argv.slice(2);
if (!svgPath) {
	console.error('usage: check-diagram.mjs <diagram.svg> [<export.png> ...]');
	process.exit(2);
}

const browser = await chromium.launch();
// The viewport is the viewBox, as diagram-design's export does, so 1 user unit = 1 CSS px.
const [, , vbW, vbH] = readFileSync(svgPath, 'utf8').match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const page = await browser.newPage({ viewport: { width: vbW, height: vbH }, deviceScaleFactor: 2 });
await page.goto(`file://${resolve(svgPath)}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

const failures = await page.evaluate(() => {
	const out = [];
	const svg = document.querySelector('svg');
	const box = (el) => el.getBBox();

	// A node is a rect large enough for a title and sublabel (diagram-design's own rule),
	// excluding full-canvas backgrounds and zone containers.
	const nodes = [...svg.querySelectorAll('rect')]
		.filter((r) => !r.getAttribute('width')?.endsWith('%'))
		.map(box)
		.filter((b) => b.width >= 60 && b.height >= 40 && b.width < 400);
	const onEdge = (p) =>
		nodes.some((n) => {
			const inX = p.x >= n.x - 2 && p.x <= n.x + n.width + 2;
			const inY = p.y >= n.y - 2 && p.y <= n.y + n.height + 2;
			const nearX = Math.abs(p.x - n.x) <= 2 || Math.abs(p.x - n.x - n.width) <= 2;
			const nearY = Math.abs(p.y - n.y) <= 2 || Math.abs(p.y - n.y - n.height) <= 2;
			return (inX && nearY) || (inY && nearX);
		});

	const legendTop = Math.min(
		...[...svg.querySelectorAll('text')].filter((t) => t.textContent === 'LEGEND').map((t) => box(t).y),
	);
	for (const c of svg.querySelectorAll('line[marker-end], path[marker-end]')) {
		const len = c.getTotalLength();
		const a = c.getPointAtLength(0);
		if (a.y >= legendTop - 20) continue; // legend swatches are not connectors
		const b = c.getPointAtLength(len);
		for (const [end, p] of [['start', a], ['end', b]]) {
			if (!onEdge(p)) out.push(`connector ${end} (${p.x.toFixed(0)},${p.y.toFixed(0)}) is not on a node edge`);
		}
	}

	const texts = [...svg.querySelectorAll('text')].map((t) => ({ s: t.textContent, b: box(t) }));
	for (let i = 0; i < texts.length; i++) {
		for (let j = i + 1; j < texts.length; j++) {
			const p = texts[i].b;
			const q = texts[j].b;
			if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) {
				out.push(`text "${texts[i].s}" overlaps "${texts[j].s}"`);
			}
		}
	}
	return out;
});

const fresh = await page.locator('svg').first().screenshot();
for (const png of pngPaths) {
	const diff = await page.evaluate(
		async ([a, b]) => {
			const load = (b64) =>
				new Promise((ok, err) => {
					const img = new Image();
					img.onload = () => ok(img);
					img.onerror = err;
					img.src = `data:image/png;base64,${b64}`;
				});
			const [ia, ib] = await Promise.all([load(a), load(b)]);
			if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ib.width}x${ib.height} vs ${ia.width}x${ia.height}` };
			const px = (img) => {
				const c = new OffscreenCanvas(img.width, img.height);
				const g = c.getContext('2d');
				g.drawImage(img, 0, 0);
				return g.getImageData(0, 0, img.width, img.height).data;
			};
			const pa = px(ia);
			const pb = px(ib);
			let off = 0;
			for (let i = 0; i < pa.length; i += 4) {
				if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 48) off++;
			}
			return { ratio: off / (pa.length / 4) };
		},
		[fresh.toString('base64'), readFileSync(png).toString('base64')],
	);
	if (diff.size) failures.push(`${png}: size ${diff.size} (fresh render)`);
	else if (diff.ratio > 0.002) failures.push(`${png}: ${(diff.ratio * 100).toFixed(2)}% of pixels differ from a fresh render of the SVG`);
}

await browser.close();
for (const f of failures) console.error(`FAIL ${f}`);
console.log(failures.length ? `${failures.length} failure(s)` : 'OK');
process.exit(failures.length ? 1 : 0);
