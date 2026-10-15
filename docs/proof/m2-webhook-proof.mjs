/**
 * M2 webhook evidence driver — real PayPal sandbox webhooks, real signatures.
 *
 * The signature on a webhook delivery can only be produced by PayPal, so this
 * cannot be faked locally: the script registers a webhook on a publicly
 * reachable HTTPS URL, asks PayPal's own event simulator to deliver to it, and
 * then posts a deliberately forged signature to the same URL as a control.
 *
 * It reads the sandbox app credentials from the git-ignored `.env`, prints no
 * credential, and refuses any host that is not the sandbox API.
 *
 *   node docs/proof/m2-webhook-proof.mjs list
 *   node docs/proof/m2-webhook-proof.mjs create   https://<public-host>   # writes PAYPAL_WEBHOOK_ID to .env
 *   node docs/proof/m2-webhook-proof.mjs simulate PAYMENT.CAPTURE.COMPLETED
 *   node docs/proof/m2-webhook-proof.mjs forge    https://<public-host>
 *   node docs/proof/m2-webhook-proof.mjs delete   <webhook-id>
 *
 * A local endpoint cannot be registered: PayPal validates the URL and answers
 * `400 VALIDATION_ERROR "url Not a valid webhook URL"` for `https://localhost`.
 * Point it at an HTTPS tunnel you control for the duration of the test, then
 * delete the webhook again — the tunnel hostname does not outlive the session.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const HOST = 'https://api-m.sandbox.paypal.com';
const SCOPE_BASE = process.env.SCOPEPAY_BASE_URL ?? 'http://localhost:8790';

/** The four event types the handler in server/services/checkout.ts applies. */
const EVENT_TYPES = [
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
  'CHECKOUT.ORDER.APPROVED'
];

const [command, argument] = process.argv.slice(2);

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error('No sandbox client credentials in .env.');
  }
  return env;
}

async function token(env) {
  const res = await fetch(`${HOST}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`No access token (HTTP ${res.status}).`);
  return body.access_token;
}

const env = loadEnv();
const bearerHeaders = async () => ({ Authorization: `Bearer ${await token(env)}`, 'Content-Type': 'application/json' });

if (command === 'list') {
  const res = await fetch(`${HOST}/v1/notifications/webhooks`, { headers: await bearerHeaders() });
  const body = await res.json();
  console.log(`GET /v1/notifications/webhooks -> ${res.status}`);
  for (const hook of body.webhooks ?? []) {
    console.log(`  id=${hook.id} url=${hook.url}`);
    console.log(`    events=${(hook.event_types ?? []).map((e) => e.name).join(', ')}`);
  }
  if ((body.webhooks ?? []).length === 0) console.log('  (none registered)');
} else if (command === 'create') {
  if (!argument?.startsWith('https://')) throw new Error('usage: create https://<public-host>');
  const url = `${argument.replace(/\/+$/, '')}/api/webhooks/paypal`;
  const res = await fetch(`${HOST}/v1/notifications/webhooks`, {
    method: 'POST',
    headers: await bearerHeaders(),
    body: JSON.stringify({ url, event_types: EVENT_TYPES.map((name) => ({ name })) })
  });
  const body = await res.json();
  console.log(`POST /v1/notifications/webhooks -> ${res.status}`);
  if (res.status >= 300) {
    console.log(`  name=${body.name} message=${body.message}`);
    for (const detail of body.details ?? []) console.log(`  detail: ${detail.field ?? ''} ${detail.issue}`);
    process.exit(1);
  }
  console.log(`  webhook id: ${body.id}`);
  console.log(`  url: ${body.url}`);
  const lines = readFileSync('.env', 'utf8')
    .split('\n')
    .filter((line) => !/^\s*PAYPAL_WEBHOOK_ID\s*=/.test(line))
    .filter((line, index, all) => !(index === all.length - 1 && line.trim() === ''));
  lines.push(`PAYPAL_WEBHOOK_ID=${body.id}`);
  writeFileSync('.env', `${lines.join('\n')}\n`);
  console.log('  wrote PAYPAL_WEBHOOK_ID to .env (git-ignored); restart the server to load it');
} else if (command === 'simulate') {
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID is not set in .env.');
  const eventType = argument ?? 'PAYMENT.CAPTURE.COMPLETED';
  const res = await fetch(`${HOST}/v1/notifications/simulate-event`, {
    method: 'POST',
    headers: await bearerHeaders(),
    body: JSON.stringify({ webhook_id: webhookId, event_type: eventType })
  });
  const body = await res.json();
  console.log(`POST /v1/notifications/simulate-event (${eventType}) -> ${res.status}`);
  if (res.status >= 300) {
    console.log(`  name=${body.name} message=${body.message}`);
    process.exit(1);
  }
  console.log(`  event id: ${body.id}`);
  console.log('  PayPal delivers it asynchronously; read the result with:');
  console.log(`    curl -s '${SCOPE_BASE}/api/events?limit=5'`);
} else if (command === 'forge') {
  // Control: the same endpoint, a signature PayPal never issued. The handler must
  // refuse it, and PayPal's verifier is what says so.
  const base = (argument ?? '').replace(/\/+$/, '');
  if (!base.startsWith('https://')) throw new Error('usage: forge https://<public-host>');
  const res = await fetch(`${base}/api/webhooks/paypal`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'paypal-transmission-id': '00000000-0000-0000-0000-000000000000',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'forged-signature-not-issued-by-paypal',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270',
      'paypal-auth-algo': 'SHA256withRSA'
    },
    body: JSON.stringify({
      id: `WH-FORGED-${Date.now()}`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'FORGED-CAPTURE-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '1640.00' } }
    })
  });
  console.log(`POST ${base}/api/webhooks/paypal (forged signature) -> ${res.status}`);
  console.log(`  body: ${JSON.stringify(await res.json())}`);
} else if (command === 'delete') {
  if (!argument) throw new Error('usage: delete <webhook-id>');
  const res = await fetch(`${HOST}/v1/notifications/webhooks/${argument}`, {
    method: 'DELETE',
    headers: await bearerHeaders()
  });
  console.log(`DELETE /v1/notifications/webhooks/${argument} -> ${res.status}`);
  if (res.status === 204) console.log('  deleted; the ephemeral tunnel URL is no longer registered');
} else {
  console.log('usage: m2-webhook-proof.mjs list|create <url>|simulate [event-type]|forge <url>|delete <id>');
  process.exit(2);
}
