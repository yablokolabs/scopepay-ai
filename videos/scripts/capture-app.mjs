#!/usr/bin/env node
/**
 * Capture the running ScopePay app for the demo video.
 *
 * The demo is required to show the actual working app, so these are screenshots of
 * the local app driven through the real routes — not mockups, and not re-drawn
 * approximations. The scope shown is the recorded M2 run's scope, read from the
 * app's own store file, so the receipt screen carries the real capture id.
 *
 * The narration script labels which beats are captures and which are animations.
 *
 * Usage:
 *   npm run dev            # in the repo root: api on 8790, web on 5173
 *   node scripts/capture-app.mjs
 *
 * Env: SCOPEPAY_APP_URL (default http://localhost:5173)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const APP_URL = process.env.SCOPEPAY_APP_URL ?? 'http://localhost:5173';
const STORE = new URL('../../.data/scopepay-store.json', import.meta.url);
const OUT_DIR = fileURLToPath(new URL('../media/app/', import.meta.url));
const WIDTH = 1920;
const HEIGHT = 1080;

/** The recorded run: the newest scope is the paid one, the older one is superseded. */
async function loadRecordedRun() {
  const doc = JSON.parse(await readFile(STORE, 'utf8'));
  const scopes = [...doc.scopes].sort((a, b) => a.version - b.version);
  const paid = scopes.at(-1);
  const superseded = scopes.at(-2);
  const brief = doc.briefs[0];
  if (!paid || !brief) throw new Error('store does not hold the recorded run yet');
  return { paid, superseded, brief };
}

async function main() {
  const { paid, superseded, brief } = await loadRecordedRun();
  await mkdir(OUT_DIR, { recursive: true }); // playwright wants a filesystem path, not a URL
  console.log(`scope in use: v${paid.version} ${paid.id} (${paid.status}, ${paid.amountMinor} ${paid.currency})`);
  if (superseded) console.log(`superseded scope available: v${superseded.version} ${superseded.id}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  ! page error: ${error.message}`));

  /**
   * Every capture records the page text beside the image, so a screen can be
   * checked for the facts it is supposed to show without reading pixels. Two
   * screens that render identical text mean the route did not change the page,
   * which is the failure this guards against.
   */
  const screens = [];

  /** A screen is captured only after it has actually drawn its data. */
  async function capture(name, hash, prepare, readFields) {
    await page.goto(`${APP_URL}/${hash}`, { waitUntil: 'networkidle' });
    if (prepare) await prepare(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: `${OUT_DIR}${name}.png`,
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT }
    });
    const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim();
    // Text typed into a form field is visible on screen but absent from innerText.
    const fields = readFields ? (await readFields(page)).replace(/\s+/g, ' ').trim() : '';
    screens.push({ name, hash, file: `${name}.png`, text, fields });
    console.log(`  ${name}.png  ${text.length} chars of text, ${fields.length} chars in fields`);
  }

  // 1. The brief, with the brief text that produced the recorded run.
  await capture(
    '01-brief',
    '#/brief',
    async (p) => {
      await p.fill('textarea', brief.canonicalText);
    },
    (p) => p.inputValue('textarea')
  );

  // 2. Merchant review of the scope that was paid.
  await capture('02-review', `#/review/${paid.id}`);

  // 3. The buyer's own view of the same scope.
  await capture('03-client', `#/client/${paid.id}`);

  // 4. The receipt: PayPal's reported result, as stored.
  await capture('04-receipt', `#/receipt/${paid.id}`);

  // 5. The superseded version, which is the stale-scope beat.
  if (superseded) await capture('05-superseded', `#/review/${superseded.id}`);

  // 6. Sandbox status: what is configured, what is not.
  await capture('06-status', '#/status');

  // 7. Change requests against the paid scope.
  await capture('07-changes', `#/changes/${paid.id}`);

  await browser.close();

  const seen = new Map();
  for (const screen of screens) {
    const fingerprint = `${screen.text}\u0000${screen.fields}`;
    const twin = seen.get(fingerprint);
    if (twin) throw new Error(`${screen.name} renders the same content as ${twin}: the route did not change the page`);
    seen.set(fingerprint, screen.name);
  }
  await writeFile(`${OUT_DIR}screens.json`, `${JSON.stringify(screens, null, 2)}\n`, 'utf8');
  console.log(`\nwrote ${screens.length} screenshots and screens.json to ${OUT_DIR}`);
}

await main();
