/**
 * Process bootstrap.
 *
 * Reads `.env` when present, then builds the store, the CSCS client config and
 * the PayPal client. Missing credentials degrade specific routes to an explicit
 * 503 with a setup instruction instead of silently faking a provider result.
 */
import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { CATALOG } from '../lib/catalog.js';
import { loadCscsConfigFromEnv, type CscsConfig } from '../lib/cscs.js';
import { createPaypalClient, type PaypalClient } from '../lib/paypal.js';
import { createStore } from '../lib/store-factory.js';
import { createScopeService } from '../lib/scope.js';
import { createApp } from './app.js';

loadDotEnv(new URL('../.env', import.meta.url).pathname);

function loadDotEnv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    const value = (match[2] as string).trim().replace(/^"|"$/g, '');
    if (process.env[key] === undefined && value.length > 0) {
      process.env[key] = value;
    }
  }
}

function buildCscsConfig(): CscsConfig | null {
  try {
    return loadCscsConfigFromEnv();
  } catch {
    return null;
  }
}

function buildPaypalClient(): PaypalClient | null {
  const clientId = process.env.PAYPAL_CLIENT_ID ?? '';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) return null;
  return createPaypalClient({
    clientId,
    clientSecret,
    env: 'sandbox',
    webhookId: process.env.PAYPAL_WEBHOOK_ID
  });
}

const store = createStore();
const cscs = buildCscsConfig();
const paypal = buildPaypalClient();
const port = Number(process.env.PORT ?? '8787');

const app = createApp({
  store,
  scopes: createScopeService({ store }),
  paypal,
  cscs,
  requestKeyPrefix: process.env.PAYPAL_IDEMPOTENCY_KEY_PREFIX ?? 'scopepay',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
  modelName: cscs ? (cscs.model ?? null) : null
});

serve({ fetch: app.fetch, port }, (info) => {
  const lines = [
    `ScopePay server on http://localhost:${info.port}`,
    `merchant: ${CATALOG.merchantId} | catalog: ${CATALOG.version}`,
    `CSCS Apertus extraction: ${cscs ? 'configured' : 'MISSING (set CSCS_INFERENCE_API_KEY)'}`,
    `PayPal sandbox: ${paypal ? 'configured' : 'MISSING (set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)'}`
  ];
  console.log(lines.join('\n'));
});
