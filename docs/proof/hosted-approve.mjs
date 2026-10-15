/**
 * Hosted demo, PayPal half: approves a sandbox order with Moli over CDP.
 *
 * Lightpanda cannot pass PayPal sign-in (DataDome, see PROOF_M2_SANDBOX.md section 7); Moli can.
 * Usage: moli serve --host 127.0.0.1 --port 9333 --layout --resource
 *        BUYER_EMAIL=... BUYER_PASSWORD=... node docs/proof/hosted-approve.mjs <approval-url>
 * Credentials come only from the environment; nothing is printed or stored.
 */
import { chromium } from '@playwright/test';
const approval = process.argv[2];
const { BUYER_EMAIL: email, BUYER_PASSWORD: password } = process.env;
if (!email || !password) throw new Error('buyer credentials missing from the environment');
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0] ?? (await browser.newContext());
for (const p of ctx.pages()) await p.close().catch(() => {});
const page = await ctx.newPage();
const visible = (sel) => page.locator(`${sel}:visible`);

// 1. Sign in on PayPal's own sign-in page (the route recorded in PROOF_M2_SANDBOX.md section 8).
await page.goto('https://www.sandbox.paypal.com/signin', { waitUntil: 'load', timeout: 60000 });
const signInNeeded = await visible('#email').waitFor({ timeout: 15000 }).then(() => true, () => false);
if (!signInNeeded) log(`already signed in, at ${new URL(page.url()).pathname}`);
else {
  await visible('#email').fill(email);
  if (await visible('#btnNext').count()) { await visible('#btnNext').click(); }
  await visible('#password').waitFor({ timeout: 30000 });
  await visible('#password').fill(password);
  await visible('#btnLogin').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 60000 });
  log(`signed in, at ${new URL(page.url()).pathname}`);
}

// 2. Open the order and complete it. Moli renders PayPal's checkout but reports no
// layout, so Playwright's visibility checks fail; read and click through the DOM.
await page.goto(approval, { waitUntil: 'load', timeout: 60000 });
const done = page.waitForURL(/workers\.dev/, { timeout: 120000 });
const shown = await page.waitForFunction(() => {
  const button = document.querySelector('[data-testid="submit-button-initial"]');
  return button ? document.body.textContent.match(/\$[\d,]+\.\d\d/)?.[0] ?? '?' : null;
}, null, { timeout: 60000 });
log(`PayPal shows Complete Purchase for ${await shown.jsonValue()}`);
await page.evaluate(() => document.querySelector('[data-testid="submit-button-initial"]').click());
await done;
log(`returned to ${new URL(page.url()).pathname}`);
await page.waitForTimeout(10000);
log(`app says: ${(await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '))).slice(0, 260)}`);
await browser.close();
