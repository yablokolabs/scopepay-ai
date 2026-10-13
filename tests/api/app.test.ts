/**
 * HTTP-level tests for the money-safety rules.
 *
 * Everything runs through `createApp(...).request(...)` with a fake PayPal
 * transport injected into the client and a fake CSCS config that is never
 * called: no test in this file touches the network.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../lib/catalog.js';
import { createPaypalClient, minorToDecimalString } from '../../lib/paypal.js';
import type { ScopeLine, ScopeVersion } from '../../lib/schemas.js';
import { createScopeService } from '../../lib/scope.js';
import { createMemoryStore } from '../../lib/store-memory.js';
import { createApp } from '../../server/app.js';

const BRIEF_TEXT =
  'Ashgrove Bakery needs a small new website: one landing page plus a contact form. We will supply the text and the photos ourselves.';
const CLIENT = 'client@example.com';
const MERCHANT = 'merchant@example.com';

interface RecordedCall {
  url: string;
  init: RequestInit;
}

interface FakeOrder {
  orderId: string;
  amountValue: string;
  currency: string;
  customId: string | null;
  referenceId: string | null;
  captureId: string | null;
  captureStatus: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A fake PayPal sandbox transport. It remembers what the create-order call
 * actually asked for so the later GET/capture responses report the same money,
 * which is what lets the amount checks in the client run for real.
 */
function createFakePaypal() {
  const calls: RecordedCall[] = [];
  const orders = new Map<string, FakeOrder>();
  const state = {
    orderStatus: 'APPROVED',
    captureStatus: 'COMPLETED',
    verification: 'SUCCESS',
    orderCount: 0
  };

  function snapshot(order: FakeOrder) {
    return {
      id: order.orderId,
      status: state.orderStatus,
      payer: { email_address: 'buyer@example.com' },
      purchase_units: [
        {
          reference_id: order.referenceId,
          custom_id: order.customId,
          amount: { currency_code: order.currency, value: order.amountValue },
          payee: { merchant_id: CATALOG.merchantId },
          ...(order.captureId
            ? {
                payments: {
                  captures: [
                    {
                      id: order.captureId,
                      status: order.captureStatus,
                      amount: { currency_code: order.currency, value: order.amountValue }
                    }
                  ]
                }
              }
            : {})
        }
      ]
    };
  }

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const requestInit: RequestInit = init ?? {};
    calls.push({ url, init: requestInit });
    const path = new URL(url).pathname;
    const method = requestInit.method ?? 'GET';

    if (path === '/v1/oauth2/token') {
      return json({ access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' });
    }
    if (path === '/v1/notifications/verify-webhook-signature') {
      return json({ verification_status: state.verification });
    }
    if (path === '/v2/checkout/orders' && method === 'POST') {
      const body = JSON.parse(String(requestInit.body)) as {
        purchase_units?: {
          amount?: { currency_code?: string; value?: string };
          custom_id?: string;
          reference_id?: string;
        }[];
      };
      const unit = body.purchase_units?.find(() => true);
      if (!unit?.amount?.value || !unit.amount.currency_code) {
        return json({ name: 'MALFORMED_REQUEST', message: 'missing amount' }, 400);
      }
      state.orderCount += 1;
      const orderId = `ORDER-${state.orderCount}`;
      orders.set(orderId, {
        orderId,
        amountValue: unit.amount.value,
        currency: unit.amount.currency_code,
        customId: unit.custom_id ?? null,
        referenceId: unit.reference_id ?? null,
        captureId: null,
        captureStatus: null
      });
      return json({
        id: orderId,
        status: 'CREATED',
        links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` }]
      });
    }

    const captureMatch = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(path);
    if (captureMatch) {
      const order = orders.get(captureMatch[1] ?? '');
      if (!order) return json({ name: 'RESOURCE_NOT_FOUND' }, 404);
      order.captureId = `CAP-${order.orderId}`;
      order.captureStatus = state.captureStatus;
      return json({
        id: order.orderId,
        status: 'COMPLETED',
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: order.captureId,
                  status: order.captureStatus,
                  amount: { currency_code: order.currency, value: order.amountValue },
                  custom_id: order.customId
                }
              ]
            }
          }
        ]
      });
    }

    const orderMatch = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(path);
    if (orderMatch) {
      const order = orders.get(orderMatch[1] ?? '');
      if (!order) return json({ name: 'RESOURCE_NOT_FOUND' }, 404);
      return json(snapshot(order));
    }

    return json({ name: 'NOT_IMPLEMENTED', message: path }, 501);
  }) as unknown as typeof fetch;

  return { impl, calls, orders, state };
}

function setup() {
  const store = createMemoryStore();
  const scopes = createScopeService({ store });
  const fake = createFakePaypal();
  const paypal = createPaypalClient(
    { clientId: 'test-client', clientSecret: 'test-secret', env: 'sandbox', webhookId: 'WH-TEST' },
    fake.impl
  );
  const app = createApp({
    store,
    scopes,
    paypal,
    cscs: { apiKey: 'test-key', baseUrl: 'http://model.invalid/v1', model: 'swiss-ai/Apertus-v1.5-70B' },
    requestKeyPrefix: 'scopepay-test',
    publicBaseUrl: 'http://localhost:8787',
    modelName: 'swiss-ai/Apertus-v1.5-70B'
  });
  return { app, store, scopes, calls: fake.calls, state: fake.state };
}

type Ctx = ReturnType<typeof setup>;

function postJson(app: Ctx['app'], path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

/** Merchant unit price straight from the catalog, so no test hardcodes money. */
function catalogPriceMinor(catalogItemId: string): number {
  const item = CATALOG.items.find((candidate) => candidate.id === catalogItemId);
  if (!item) throw new Error(`fixture references an unknown catalog item: ${catalogItemId}`);
  return item.unitPriceMinor;
}

const createOrderCalls = (ctx: Ctx) =>
  ctx.calls.filter((call) => call.url.endsWith('/v2/checkout/orders') && (call.init.method ?? 'GET') === 'POST');
const captureCalls = (ctx: Ctx) => ctx.calls.filter((call) => call.url.endsWith('/capture'));

const defaultLines: ScopeLine[] = [
  { catalogItemId: 'landing-page', quantity: 1, sourceSpan: null, rationale: 'the brief asks for a landing page' }
];

/** Draft -> merchant review, so the returned version is payable but not yet accepted. */
async function payableScope(ctx: Ctx, lines: ScopeLine[] = defaultLines) {
  const draft = await ctx.scopes.createDraft({
    text: BRIEF_TEXT,
    submittedBy: MERCHANT,
    proposal: { lines, exclusions: [], revisionLimit: 2, ambiguities: [] }
  });
  const reviewed = await ctx.scopes.applyMerchantReview({
    scopeId: draft.scope.id,
    review: { action: 'approve', actor: MERCHANT, note: '' }
  });
  return { v1: draft.scope, v2: reviewed };
}

/** Buyer accepts the version, then the buyer starts the sandbox checkout. */
async function acceptAndCreateOrder(ctx: Ctx, scope: ScopeVersion) {
  const accept = await postJson(ctx.app, `/api/scopes/${scope.id}/accept`, {
    hash: scope.hash,
    actor: CLIENT,
    confirmedAmountMinor: scope.amountMinor,
    confirmedCurrency: 'USD'
  });
  const order = await postJson(ctx.app, `/api/scopes/${scope.id}/orders`, {
    hash: scope.hash,
    actor: CLIENT,
    confirmedAmountMinor: scope.amountMinor,
    confirmedCurrency: 'USD'
  });
  return { accept, order };
}

async function orderIdOf(ctx: Ctx, scope: ScopeVersion): Promise<string> {
  const attempts = await ctx.store.listPaymentAttemptsForScope(scope.id);
  const orderId = attempts[attempts.length - 1]?.paypalOrderId;
  if (!orderId) throw new Error('no sandbox order was created for this scope');
  return orderId;
}

const WEBHOOK_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'paypal-transmission-id': 'tid-1',
  'paypal-transmission-time': '2026-10-13T00:00:00Z',
  'paypal-transmission-sig': 'sig-1',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
  'paypal-auth-algo': 'SHA256withRSA'
};

describe('runtime configuration', () => {
  it('reports sandbox status and leaks no provider credential', async () => {
    const ctx = setup();

    const health = await ctx.app.request('/health');
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as {
      ok: boolean;
      sandbox: boolean;
      paypalConfigured: boolean;
      modelConfigured: boolean;
    };
    expect(healthBody).toMatchObject({ ok: true, sandbox: true, paypalConfigured: true, modelConfigured: true });

    const config = await ctx.app.request('/api/config');
    expect(config.status).toBe(200);
    const raw = await config.text();
    const body = JSON.parse(raw) as {
      sandbox: boolean;
      merchantId: string;
      merchantName: string;
      currency: string;
      catalogVersion: string;
      taxIncluded: boolean;
      standardExclusions: string[];
    };
    expect(body.sandbox).toBe(true);
    expect(body.merchantId).toBe(CATALOG.merchantId);
    expect(body.merchantName).toBe(CATALOG.merchantName);
    expect(body.currency).toBe(CATALOG.currency);
    expect(body.catalogVersion).toBe(CATALOG.version);
    expect(body.taxIncluded).toBe(false);
    expect(body.standardExclusions.length).toBeGreaterThan(0);
    expect(raw).not.toContain('test-secret');
    expect(raw).not.toContain('client_secret');
    expect(raw).not.toContain('test-client');
  });

  it('serves the merchant catalog with integer-cent prices', async () => {
    const ctx = setup();
    const res = await ctx.app.request('/api/catalog');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      catalog: { items: { id: string; unitPriceMinor: number; minQty: number; maxQty: number }[] };
    };
    expect(body.catalog.items.length).toBe(CATALOG.items.length);
    for (const item of body.catalog.items) {
      expect(Number.isInteger(item.unitPriceMinor)).toBe(true);
      expect(item.unitPriceMinor).toBeGreaterThan(0);
      expect(item.minQty).toBeGreaterThanOrEqual(1);
      expect(item.maxQty).toBeGreaterThanOrEqual(item.minQty);
    }
    expect(body.catalog.items.find((item) => item.id === 'landing-page')?.unitPriceMinor).toBe(
      catalogPriceMinor('landing-page')
    );
  });
});

describe('scope views', () => {
  it('returns the scope, its catalog breakdown and its version history', async () => {
    const ctx = setup();
    const { v1, v2 } = await payableScope(ctx);

    const res = await ctx.app.request(`/api/scopes/${v2.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scope: ScopeVersion;
      breakdown: { catalogItemId: string; quantity: number; lineTotalMinor: number }[];
      history: ScopeVersion[];
      acceptance: unknown;
      amountFormatted: string;
    };
    expect(body.scope.hash).toBe(v2.hash);
    expect(body.scope.amountMinor).toBe(catalogPriceMinor('landing-page'));
    expect(body.breakdown.length).toBe(1);
    expect(body.breakdown[0]?.catalogItemId).toBe('landing-page');
    expect(body.breakdown[0]?.lineTotalMinor).toBe(v2.amountMinor);
    expect(body.history.map((version) => version.id)).toContain(v1.id);
    expect(body.acceptance).toBeNull();
    expect(body.amountFormatted).toBe(`${minorToDecimalString(v2.amountMinor)} USD`);
  });

  it('answers 404 with scope_not_found for a version that does not exist', async () => {
    const ctx = setup();
    const res = await ctx.app.request('/api/scopes/scope-does-not-exist');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('scope_not_found');
  });
});

describe('buyer acceptance', () => {
  it('rejects a mismatched amount and a fabricated hash, then stores a valid acceptance', async () => {
    const ctx = setup();
    const { v2 } = await payableScope(ctx);

    const wrongAmount = await postJson(ctx.app, `/api/scopes/${v2.id}/accept`, {
      hash: v2.hash,
      actor: CLIENT,
      confirmedAmountMinor: v2.amountMinor + 500,
      confirmedCurrency: 'USD'
    });
    expect(wrongAmount.status).toBe(409);
    expect(((await wrongAmount.json()) as { error: { code: string } }).error.code).toBe('amount_mismatch');

    const wrongHash = await postJson(ctx.app, `/api/scopes/${v2.id}/accept`, {
      hash: 'b'.repeat(64),
      actor: CLIENT,
      confirmedAmountMinor: v2.amountMinor,
      confirmedCurrency: 'USD'
    });
    expect(wrongHash.status).toBe(409);
    expect(((await wrongHash.json()) as { error: { code: string } }).error.code).toBe('hash_mismatch');

    const accepted = await postJson(ctx.app, `/api/scopes/${v2.id}/accept`, {
      hash: v2.hash,
      actor: CLIENT,
      confirmedAmountMinor: v2.amountMinor,
      confirmedCurrency: 'USD'
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as {
      scope: ScopeVersion;
      acceptance: { hash: string; confirmedAmountMinor: number; actor: string };
    };
    expect(acceptedBody.scope.status).toBe('accepted');
    expect(acceptedBody.acceptance.hash).toBe(v2.hash);
    expect(acceptedBody.acceptance.confirmedAmountMinor).toBe(v2.amountMinor);
    expect(acceptedBody.acceptance.actor).toBe(CLIENT);

    const view = (await (await ctx.app.request(`/api/scopes/${v2.id}`)).json()) as { acceptance: { hash: string } | null };
    expect(view.acceptance?.hash).toBe(v2.hash);
  });
});

describe('sandbox order creation', () => {
  it('creates the order from the server-computed catalog amount', async () => {
    const ctx = setup();
    const { v2 } = await payableScope(ctx);

    const res = await postJson(ctx.app, `/api/scopes/${v2.id}/orders`, {
      hash: v2.hash,
      actor: CLIENT,
      confirmedAmountMinor: v2.amountMinor,
      confirmedCurrency: 'USD'
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      attempt: { paypalOrderId: string; expectedAmountMinor: number; state: string };
      approvalUrl: string;
      reusedExistingOrder: boolean;
      sandbox: boolean;
    };
    expect(body.sandbox).toBe(true);
    expect(body.reusedExistingOrder).toBe(false);
    expect(body.approvalUrl).toContain('checkoutnow');
    expect(body.attempt.expectedAmountMinor).toBe(catalogPriceMinor('landing-page'));
    expect(body.attempt.state).toBe('created');

    const createCall = createOrderCalls(ctx).find(() => true);
    expect(createCall).toBeDefined();
    const headers = createCall?.init.headers as Record<string, string>;
    expect(headers['Paypal-Request-Id']).toBe(`scopepay-test:${v2.id}:${v2.hash}`);

    const payload = JSON.parse(String(createCall?.init.body)) as {
      intent: string;
      purchase_units: {
        amount: { currency_code: string; value: string };
        custom_id: string;
        reference_id: string;
      }[];
    };
    expect(payload.intent).toBe('CAPTURE');
    const unit = payload.purchase_units.find(() => true);
    expect(unit?.amount).toEqual({ currency_code: 'USD', value: minorToDecimalString(v2.amountMinor) });
    expect(unit?.custom_id).toBe(v2.id);
    expect(unit?.reference_id).toBe(v2.hash);
  });

  it('treats a repeated submission as the same purchase instead of a second order', async () => {
    const ctx = setup();
    const { v2 } = await payableScope(ctx);
    const first = await acceptAndCreateOrder(ctx, v2);
    expect(first.order.status).toBe(201);
    const firstBody = (await first.order.json()) as { attempt: { paypalOrderId: string } };

    const second = await postJson(ctx.app, `/api/scopes/${v2.id}/orders`, {
      hash: v2.hash,
      actor: CLIENT,
      confirmedAmountMinor: v2.amountMinor,
      confirmedCurrency: 'USD'
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { attempt: { paypalOrderId: string }; reusedExistingOrder: boolean };
    expect(secondBody.attempt.paypalOrderId).toBe(firstBody.attempt.paypalOrderId);
    expect(secondBody.reusedExistingOrder).toBe(true);
    expect(createOrderCalls(ctx).length).toBe(1);
  });

  it('rejects a tampered amount before any order reaches the provider', async () => {
    const ctx = setup();
    const { v2 } = await payableScope(ctx);

    const res = await postJson(ctx.app, `/api/scopes/${v2.id}/orders`, {
      hash: v2.hash,
      actor: CLIENT,
      confirmedAmountMinor: v2.amountMinor - 1,
      confirmedCurrency: 'USD'
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('amount_mismatch');
    expect(createOrderCalls(ctx).length).toBe(0);
    expect(await ctx.store.listPaymentAttemptsForScope(v2.id)).toEqual([]);
  });
});

describe('capture', () => {
  it('captures an approved order exactly once and marks the version paid', async () => {
    const ctx = setup();
    const { v2 } = await payableScope(ctx);
    await acceptAndCreateOrder(ctx, v2);
    const orderId = await orderIdOf(ctx, v2);

    const capture = await postJson(ctx.app, `/api/scopes/${v2.id}/capture`, { orderId });
    expect(capture.status).toBe(200);
    const captureBody = (await capture.json()) as {
      captured: boolean;
      attempt: { captureId: string; state: string };
      scopeStatus: string;
    };
    expect(captureBody.captured).toBe(true);
    expect(captureBody.attempt.captureId).toBe(`CAP-${orderId}`);
    expect(captureBody.attempt.state).toBe('captured');
    expect(captureBody.scopeStatus).toBe('paid');
    expect(captureCalls(ctx).length).toBe(1);

    const again = await postJson(ctx.app, `/api/scopes/${v2.id}/capture`, { orderId });
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { captured: boolean; attempt: { captureId: string } };
    expect(againBody.captured).toBe(true);
    expect(againBody.attempt.captureId).toBe(`CAP-${orderId}`);
    expect(captureCalls(ctx).length).toBe(1);
  });

  it('refuses to capture an order the buyer has not approved', async () => {
    const ctx = setup();
    const { v2 } = await payableScope(ctx);
    await acceptAndCreateOrder(ctx, v2);
    const orderId = await orderIdOf(ctx, v2);
    ctx.state.orderStatus = 'CREATED';

    const res = await postJson(ctx.app, `/api/scopes/${v2.id}/capture`, { orderId });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('paypal_not_approved');
    expect(captureCalls(ctx).length).toBe(0);
  });

  it('refuses to capture an order once its scope version has been superseded', async () => {
    const ctx = setup();
    const { v2 } = await payableScope(ctx);
    await acceptAndCreateOrder(ctx, v2);
    const orderId = await orderIdOf(ctx, v2);

    // A change request on the unpaid version drafts a successor and supersedes it.
    const change = await ctx.scopes.proposeChange({
      scopeId: v2.id,
      changeText: 'Please also add one more content page.',
      assessment: {
        changeClass: 'new_scope_delta',
        summary: 'One additional content page.',
        lines: [
          {
            catalogItemId: 'content-page',
            quantity: 1,
            sourceSpan: null,
            rationale: 'requested by the client'
          }
        ],
        exclusions: [],
        deltaAmountMinor: 0,
        confident: true,
        modelNotes: ''
      },
      requestedBy: CLIENT
    });
    expect(change.scope.status).toBe('draft');
    expect((await ctx.store.getScope(v2.id))?.status).toBe('superseded');

    const res = await postJson(ctx.app, `/api/scopes/${v2.id}/capture`, { orderId });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('stale_scope');
    expect(captureCalls(ctx).length).toBe(0);
  });
});

describe('webhooks', () => {
  it('applies a verified capture event once and records the replay as a duplicate', async () => {
    const ctx = setup();
    const { v2 } = await payableScope(ctx);
    await acceptAndCreateOrder(ctx, v2);
    const orderId = await orderIdOf(ctx, v2);
    const webhookBody = JSON.stringify({
      id: 'WH-EVENT-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: `CAP-${orderId}`,
        status: 'COMPLETED',
        supplementary_data: { related_ids: { order_id: orderId } }
      }
    });

    const first = await ctx.app.request('/api/webhooks/paypal', { method: 'POST', headers: WEBHOOK_HEADERS, body: webhookBody });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { accepted: boolean; applied: boolean };
    expect(firstBody.accepted).toBe(true);
    expect(firstBody.applied).toBe(true);

    const view = (await (await ctx.app.request(`/api/scopes/${v2.id}`)).json()) as {
      scope: { status: string };
      attempts: { state: string; captureId: string | null }[];
    };
    expect(view.scope.status).toBe('paid');
    expect(view.attempts[0]?.state).toBe('captured');
    expect(view.attempts[0]?.captureId).toBe(`CAP-${orderId}`);

    const replay = await ctx.app.request('/api/webhooks/paypal', { method: 'POST', headers: WEBHOOK_HEADERS, body: webhookBody });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { applied: boolean; reason: string };
    expect(replayBody.applied).toBe(false);
    expect(replayBody.reason.toLowerCase()).toContain('duplicate');

    const events = (await (await ctx.app.request('/api/events')).json()) as { events: { eventId: string }[] };
    expect(events.events.some((event) => event.eventId === 'WH-EVENT-1')).toBe(true);
  });

  it('refuses an unverified webhook and stores it as an invalid signature', async () => {
    const ctx = setup();
    ctx.state.verification = 'FAILURE';
    const body = JSON.stringify({
      id: 'WH-EVENT-BAD',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-X', status: 'COMPLETED' }
    });

    const res = await ctx.app.request('/api/webhooks/paypal', { method: 'POST', headers: WEBHOOK_HEADERS, body });
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { accepted: boolean; applied: boolean };
    expect(resBody.accepted).toBe(false);
    expect(resBody.applied).toBe(false);

    const events = (await (await ctx.app.request('/api/events')).json()) as {
      events: { eventId: string; verificationState: string }[];
    };
    const stored = events.events.find((event) => event.eventId === 'WH-EVENT-BAD');
    expect(stored?.verificationState).toBe('invalid_signature');
  });

  it('never exposes provider credentials through the event log', async () => {
    const ctx = setup();
    ctx.state.verification = 'FAILURE';
    await ctx.app.request('/api/webhooks/paypal', {
      method: 'POST',
      headers: WEBHOOK_HEADERS,
      body: JSON.stringify({ id: 'WH-EVENT-SECRET', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-X' } })
    });

    const raw = await (await ctx.app.request('/api/events')).text();
    expect(raw).toContain('WH-EVENT-SECRET');
    expect(raw).not.toContain('test-secret');
    expect(raw).not.toContain('test-client');
    expect(raw).not.toContain('tok-1');
    expect(raw).not.toContain('Authorization');
    expect(raw).not.toContain('access_token');
  });
});
