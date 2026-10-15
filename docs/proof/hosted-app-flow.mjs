/**
 * Hosted demo, app half: drives the live Workers URL with Lightpanda over CDP.
 *
 * Usage: lightpanda serve --host 127.0.0.1 --port 9222
 *        node docs/proof/hosted-app-flow.mjs
 * Prints SCOPE=<id> and APPROVAL=<PayPal URL>. Approve with hosted-approve.mjs.
 */
import { chromium } from '@playwright/test';
const URL_ = 'https://scopepay.young-disk-9d1c.workers.dev/';
const browser = await chromium.connectOverCDP('ws://127.0.0.1:9222');
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const hash = () => new URL(page.url()).hash;
// Lightpanda has no layout, so pointer clicks fail; a DOM click still fires React's handler.
async function clickButton(match) {
  const ok = await page.evaluate((src) => {
    const re = new RegExp(src);
    const b = [...document.querySelectorAll('button')].find((el) => re.test(el.textContent ?? '') && !el.disabled);
    if (b) b.click();
    return Boolean(b);
  }, match);
  if (!ok) throw new Error(`no enabled button matching ${match} | ${(await page.locator('body').innerText()).slice(0, 300)}`);
}
async function waitHash(prefix, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (hash().startsWith(prefix)) return hash(); await page.waitForTimeout(500); }
  const text = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  throw new Error(`hash never became ${prefix}; now ${hash()} | ${text.slice(text.search(/error|could not|refused|limit/i), 400)}`);
}
await page.goto(URL_, { waitUntil: 'load' });
await page.getByRole('button', { name: /·/ }).first().waitFor({ timeout: 20000 });
log('home loaded, sample briefs listed');
await clickButton('·');
// Identical brief text maps to the same scope by hash, so tag each run to start a new one.
await page.evaluate((tag) => {
  const area = document.querySelector('textarea');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(area, `${area.value} (run ${tag})`);
  area.dispatchEvent(new Event('input', { bubbles: true }));
}, new Date().toISOString());
await page.waitForTimeout(300);
await clickButton('^Extract scope with Apertus$');
log('extracting with Apertus');
const review = await waitHash('#/review/', 150000);
log(`review page ${review}`);
await page.waitForTimeout(1500);
await clickButton('^Approve and send to client$');
const client = await waitHash('#/client/', 30000);
log(`client page ${client}`);
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.checked) b.click(); }));
await page.waitForTimeout(300);
await clickButton('^Approve and create sandbox order$');
log('creating sandbox order');
const end = Date.now() + 60000;
let approval = null;
while (Date.now() < end && !approval) {
  if (page.url().includes('paypal.com')) approval = page.url();
  else {
    const href = await page.locator('a[href*="paypal.com"]').first().getAttribute('href').catch(() => null);
    if (href) approval = href;
  }
  if (!approval) await page.waitForTimeout(500);
}
if (!approval) throw new Error(`no PayPal approval link | ${(await page.locator('body').innerText()).slice(0, 400)}`);
log(`PayPal approval URL host ${new URL(approval).host}, token ${new URL(approval).searchParams.get('token')}`);
console.log(`SCOPE=${client.split('/')[2]}`);
console.log(`APPROVAL=${approval}`);
await browser.close();
