/**
 * M2 live evidence driver — real PayPal sandbox, through the public HTTP API.
 *
 * This script talks only to the running ScopePay server; it never reads, prints
 * or stores a credential. The server holds the sandbox client id/secret.
 *
 * Usage:
 *   SCOPEPAY_STORE=file PORT=8790 npm run start      # in one shell
 *   node docs/proof/m2-sandbox-flow.mjs              # in another
 *
 * The script is resumable. The same brief text is deduplicated by hash, so a
 * second run continues the version the first run produced instead of forking a
 * new one: acceptance and order creation are skipped when an order already
 * exists for that hash, and the run goes straight to reconciliation and capture.
 * That is the path used after a buyer approves the order on PayPal.
 *
 * Steps 1-7 need only sandbox app credentials. Step 8 (capture) additionally
 * needs the buyer approval to have happened on PayPal's own page with a sandbox
 * buyer test account; without that approval PayPal refuses the capture and the
 * script reports the real provider refusal.
 */
const BASE = process.env.SCOPEPAY_BASE_URL ?? 'http://localhost:8790';

const BRIEF =
  'We need a simple site for our bakery. About 5 pages: home, our story, breads, ' +
  'wholesale enquiries and contact. We have all the copy written already but it ' +
  'needs a tidy up pass. We have a logo. Please make it work nicely on phones.';

/** Attempt states that mean "an order already exists for this scope hash". */
const LIVE_STATES = ['created', 'approved', 'reconcile_required'];

const step = (n, title) => console.log(`\n### ${n}. ${title}`);

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json };
}

const lines = (scope) =>
  scope.lines.map((line) => `${line.catalogItemId} x${line.quantity}`).join(', ') || '(none)';

const attemptView = (attempt) =>
  attempt && {
    id: attempt.id,
    state: attempt.state,
    providerStatus: attempt.providerStatus,
    paypalOrderId: attempt.paypalOrderId,
    captureId: attempt.captureId,
    expectedAmountMinor: attempt.expectedAmountMinor,
    expectedCurrency: attempt.expectedCurrency,
    scopeHash: attempt.scopeHash?.slice(0, 12),
    approvalUrl: attempt.approvalUrl,
    lastError: attempt.lastError
  };

step(1, 'Server readiness — does the server hold sandbox credentials?');
const health = await call('GET', '/health');
console.log(`GET /health -> ${health.status}`, health.json);
if (!health.json?.paypalConfigured) {
  console.log('PayPal is not configured on this server; the paid steps below will stop at 503.');
  process.exit(1);
}

step(2, 'Real Apertus extraction — brief to scope version');
const brief = await call('POST', '/api/briefs', { text: BRIEF, submittedBy: 'live-proof-driver' });
console.log(`POST /api/briefs -> ${brief.status}`);
if (brief.status !== 201) {
  console.log(JSON.stringify(brief.json, null, 2));
  process.exit(1);
}
console.log(
  `scope ${brief.json.scope.id} v${brief.json.scope.version} ${brief.json.scope.status} ` +
    `amount=${brief.json.scope.amountMinor}${brief.json.scope.currency} hash=${brief.json.scope.hash.slice(0, 12)}`
);
console.log(`model=${brief.json.extraction?.model} ${brief.json.extraction?.latencyMs}ms`);
console.log(`lines: ${lines(brief.json.scope)}`);

step(3, 'Merchant review — finalize into a payable version');
let scope = brief.json.scope;
if (scope.status === 'draft') {
  const review = await call('POST', `/api/scopes/${scope.id}/review`, {
    action: 'approve',
    actor: 'merchant-owner',
    note: 'Prices match the catalog; exclusions confirmed.'
  });
  console.log(`POST /api/scopes/:id/review -> ${review.status}`);
  if (review.status !== 200) {
    console.log(JSON.stringify(review.json, null, 2));
    process.exit(1);
  }
  scope = review.json.scope;
} else {
  console.log(`already reviewed in an earlier run; resuming status=${scope.status} amount=${scope.amountMinor}`);
}
console.log(`scope ${scope.id} v${scope.version} ${scope.status} amount=${scope.amountMinor}${scope.currency}`);
console.log(`hash=${scope.hash}`);
console.log(`lines: ${lines(scope)}`);

const view = await call('GET', `/api/scopes/${scope.id}`);
if (view.status !== 200) {
  console.log(`GET /api/scopes/:id -> ${view.status}`, view.json);
  process.exit(1);
}
if (view.json.scope.status === 'paid') {
  console.log('\nThis version is already paid; the receipt is unchanged. Nothing further to prove here.');
  process.exit(0);
}

// A live attempt for this exact hash means the buyer already accepted it and an
// order exists. Acceptance is only valid before the first order, and creating a
// second order would be a second purchase, so both are skipped on a resume.
const existing = (view.json.attempts ?? []).find(
  (attempt) => attempt.scopeHash === scope.hash && LIVE_STATES.includes(attempt.state)
);

step(4, 'Buyer acceptance of this exact hash + amount + currency');
if (existing) {
  console.log(`skipped: an order already exists for this hash (${existing.paypalOrderId}, state ${existing.state})`);
} else {
  const accept = await call('POST', `/api/scopes/${scope.id}/accept`, {
    hash: scope.hash,
    actor: 'buyer-client',
    confirmedAmountMinor: scope.amountMinor,
    confirmedCurrency: scope.currency
  });
  console.log(`POST /api/scopes/:id/accept -> ${accept.status}`);
  if (accept.status !== 200) {
    console.log(JSON.stringify(accept.json, null, 2));
    process.exit(1);
  }
  console.log(`accepted hash=${accept.json.acceptance.hash.slice(0, 12)} status=${accept.json.scope.status}`);
}

step(5, 'Real PayPal sandbox order');
let orderId = existing?.paypalOrderId ?? null;
if (existing) {
  console.log(`reusing the existing sandbox order ${orderId} — no second order is created`);
} else {
  const order = await call('POST', `/api/scopes/${scope.id}/orders`, {
    hash: scope.hash,
    actor: 'buyer-client',
    confirmedAmountMinor: scope.amountMinor,
    confirmedCurrency: scope.currency
  });
  console.log(`POST /api/scopes/:id/orders -> ${order.status}`);
  if (order.status !== 201) {
    console.log(JSON.stringify(order.json, null, 2));
    process.exit(1);
  }
  orderId = order.json.attempt.paypalOrderId;
  console.log(`order id=${orderId} providerStatus=${order.json.attempt.providerStatus} state=${order.json.attempt.state}`);
  console.log(`approval url: ${order.json.approvalUrl}`);
}

step(6, 'Duplicate submission — PayPal idempotency, no second purchase');
const repeat = await call('POST', `/api/scopes/${scope.id}/orders`, {
  hash: scope.hash,
  actor: 'buyer-client',
  confirmedAmountMinor: scope.amountMinor,
  confirmedCurrency: scope.currency
});
console.log(`POST /api/scopes/:id/orders (again) -> ${repeat.status} reused=${repeat.json.reusedExistingOrder}`);
console.log(`same order id as step 5: ${repeat.json.attempt.paypalOrderId === orderId}`);

step(7, 'Reconcile — read the real order back from PayPal');
const reconcile = await call('POST', `/api/scopes/${scope.id}/reconcile`, {});
console.log(`POST /api/scopes/:id/reconcile -> ${reconcile.status}`);
console.log(
  `source=${reconcile.json.source} providerStatus=${reconcile.json.providerStatus} changed=${reconcile.json.changed}`
);
console.log('attempt:', attemptView(reconcile.json.attempt));
const providerStatus = reconcile.json.providerStatus;
if (providerStatus !== 'APPROVED' && providerStatus !== 'COMPLETED') {
  console.log(
    `\nThe buyer has not approved order ${orderId} yet (PayPal reports "${providerStatus}"). ` +
      'Approve it at the approvalUrl with a sandbox Personal (buyer) account, then re-run this script.'
  );
}

step(8, 'Capture — what PayPal actually allows at this point');
const capture = await call('POST', `/api/scopes/${scope.id}/capture`, {});
console.log(`POST /api/scopes/:id/capture -> ${capture.status}`);
console.log(JSON.stringify(capture.json, null, 2));

step(9, 'Final stored state');
const finalView = await call('GET', `/api/scopes/${scope.id}`);
console.log(`GET /api/scopes/:id -> ${finalView.status} scopeStatus=${finalView.json.scope?.status}`);
console.log(`amount=${finalView.json.scope?.amountMinor}${finalView.json.scope?.currency}`);
for (const attempt of finalView.json.attempts ?? []) console.log('attempt:', attemptView(attempt));

if (capture.status === 200 && capture.json?.captured === true) {
  console.log(`\nREAL CAPTURE ID: ${capture.json.attempt.captureId} — provider status ${capture.json.attempt.providerStatus}`);
} else {
  console.log('\nNo capture id: the buyer approval step has not been completed. Nothing was captured.');
}
