import { describe, expect, it } from 'vitest';
import {
  PAYPAL_REQUEST_ID_MAX_LENGTH,
  PaypalError,
  createPaypalClient,
  decimalStringToMinor,
  minorToDecimalString,
  requestIdFor,
  type PaypalConfig
} from '../../lib/paypal.js';

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const SCOPE_HASH = 'a'.repeat(64);
const EXPECTED = { amountMinor: 1234, currency: 'USD', merchantId: 'M-1' };

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: RecordedCall = { url, init: init ?? {} };
    calls.push(call);
    return handler(url, call.init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const TOKEN_URL = '/v1/oauth2/token';

/** The Paypal-Request-Id actually sent on the nth call to `suffix`. */
function sentRequestId(calls: RecordedCall[], suffix: string, index = 0): string {
  const call = calls.filter((candidate) => candidate.url.endsWith(suffix))[index];
  if (!call) throw new Error(`expected a call to ${suffix} at index ${index}`);
  const value = (call.init.headers as Record<string, string>)['Paypal-Request-Id'];
  if (typeof value !== 'string') throw new Error(`no Paypal-Request-Id was sent to ${suffix}`);
  return value;
}

function tokenResponse() {
  return json({ access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' });
}

function makeClient(handler: (url: string, init: RequestInit) => Response | Promise<Response>, overrides: Partial<PaypalConfig> = {}) {
  const { impl, calls } = makeFetch(handler);
  const client = createPaypalClient(
    { clientId: 'cid', clientSecret: 'shh', env: 'sandbox', webhookId: 'WH-1', ...overrides },
    impl
  );
  return { client, calls };
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ORDER-1',
    status: 'APPROVED',
    payer: { email_address: 'buyer@example.com' },
    purchase_units: [
      {
        reference_id: SCOPE_HASH,
        custom_id: 'scope-1',
        amount: { currency_code: 'USD', value: '12.34' },
        payee: { merchant_id: 'M-1' }
      }
    ],
    ...overrides
  };
}

function captureBody(captureOverrides: Record<string, unknown> = {}, rootOverrides: Record<string, unknown> = {}) {
  return {
    id: 'ORDER-1',
    status: 'COMPLETED',
    purchase_units: [
      {
        payments: {
          captures: [
            {
              id: 'CAP-1',
              status: 'COMPLETED',
              amount: { currency_code: 'USD', value: '12.34' },
              ...captureOverrides
            }
          ]
        }
      }
    ],
    ...rootOverrides
  };
}

describe('PayPal sandbox client configuration', () => {
  it('refuses any environment other than sandbox', () => {
    expect(() =>
      createPaypalClient({ clientId: 'c', clientSecret: 's', env: 'live' } as unknown as PaypalConfig, makeFetch(() => tokenResponse()).impl)
    ).toThrowError(PaypalError);

    try {
      createPaypalClient({ clientId: 'c', clientSecret: 's', env: 'live' } as unknown as PaypalConfig, makeFetch(() => tokenResponse()).impl);
    } catch (error) {
      expect((error as PaypalError).code).toBe('unsupported_env');
    }
  });

  it('only ever calls the sandbox host', async () => {
    const { client, calls } = makeClient((url) =>
      url.includes('/v2/checkout/orders') ? json({ id: 'ORDER-1', status: 'CREATED', links: [] }) : tokenResponse()
    );
    await client.createOrder({
      scopeRef: 'scope-1',
      scopeHash: SCOPE_HASH,
      amountMinor: 1234,
      currency: 'USD',
      merchantId: 'M-1',
      requestKey: 'key-1',
      returnUrl: 'http://localhost:5173/checkout/return',
      cancelUrl: 'http://localhost:5173/checkout/cancel',
      description: 'ScopePay sandbox order'
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.url.startsWith(SANDBOX_BASE)).toBe(true);
    expect(calls.some((call) => call.url.includes('api-m.paypal.com'))).toBe(false);
  });

  it('reports missing credentials instead of attempting a call', async () => {
    const { client, calls } = makeClient(() => tokenResponse(), { clientId: '', clientSecret: '' });
    await expect(client.getAccessToken()).rejects.toMatchObject({ code: 'missing_credentials' });
    expect(calls.length).toBe(0);
  });
});

describe('amount formatting', () => {
  it('formats integer cents without floating point error', () => {
    expect(minorToDecimalString(0)).toBe('0.00');
    expect(minorToDecimalString(5)).toBe('0.05');
    expect(minorToDecimalString(100)).toBe('1.00');
    expect(minorToDecimalString(1234)).toBe('12.34');
  });

  it('parses provider decimals back to cents', () => {
    expect(decimalStringToMinor('12.34')).toBe(1234);
    expect(decimalStringToMinor('0.05')).toBe(5);
    expect(decimalStringToMinor('7')).toBe(700);
  });

  it('rejects sub-cent values rather than rounding them', () => {
    expect(() => decimalStringToMinor('1.234')).toThrowError(PaypalError);
    expect(() => decimalStringToMinor('abc')).toThrowError(PaypalError);
  });
});

describe('access tokens', () => {
  it('caches the token across calls', async () => {
    const { client, calls } = makeClient(() => tokenResponse());
    const first = await client.getAccessToken();
    const second = await client.getAccessToken();
    expect(first.token).toBe('tok-1');
    expect(second.token).toBe('tok-1');
    expect(calls.filter((call) => call.url.includes(TOKEN_URL)).length).toBe(1);
  });

  it('surfaces an authentication failure with the provider status', async () => {
    const { client } = makeClient((url) =>
      url.includes(TOKEN_URL) ? json({ error: 'invalid_client', error_description: 'Client Authentication failed' }, 401) : tokenResponse()
    );
    await expect(client.getAccessToken()).rejects.toMatchObject({ code: 'auth_failed', status: 401 });
  });
});

describe('order creation', () => {
  it('sends the idempotency key and reads the approval link', async () => {
    const { client, calls } = makeClient((url) =>
      url.includes('/v2/checkout/orders')
        ? json({
            id: 'ORDER-1',
            status: 'CREATED',
            links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1' }]
          })
        : tokenResponse()
    );
    const result = await client.createOrder({
      scopeRef: 'scope-1',
      scopeHash: SCOPE_HASH,
      amountMinor: 1234,
      currency: 'USD',
      merchantId: 'M-1',
      requestKey: 'key-1',
      returnUrl: 'http://localhost:5173/checkout/return',
      cancelUrl: 'http://localhost:5173/checkout/cancel',
      description: 'Landing page package'
    });

    expect(result.orderId).toBe('ORDER-1');
    expect(result.approvalUrl).toBe('https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1');

    const createCall = calls.find((call) => call.url.endsWith('/v2/checkout/orders'));
    expect(createCall).toBeDefined();
    const headers = createCall?.init.headers as Record<string, string>;
    expect(headers['Paypal-Request-Id']).toBe('key-1');
    const body = JSON.parse(String(createCall?.init.body));
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '12.34' });
    expect(body.purchase_units[0].custom_id).toBe('scope-1');
    expect(body.purchase_units[0].reference_id).toBe(SCOPE_HASH);
  });

  it('keeps the idempotency header inside the length PayPal accepts', async () => {
    const { client, calls } = makeClient((url) =>
      url.includes('/v2/checkout/orders') ? json({ id: 'ORDER-1', status: 'CREATED', links: [] }) : tokenResponse()
    );
    // The real key the checkout service builds: prefix + scope version id + version hash.
    const localKey = `scopepay:scope-68696e25-7129-47f8-b93e-9766f787ec68:${SCOPE_HASH}`;
    expect(localKey.length).toBeGreaterThan(PAYPAL_REQUEST_ID_MAX_LENGTH);

    await client.createOrder({
      scopeRef: 'scope-1',
      scopeHash: SCOPE_HASH,
      amountMinor: 1234,
      currency: 'USD',
      merchantId: 'M-1',
      requestKey: localKey,
      returnUrl: 'http://localhost:5173/checkout/return',
      cancelUrl: 'http://localhost:5173/checkout/cancel',
      description: 'ScopePay sandbox order'
    });

    // PayPal answers an over-long PayPal-Request-Id with HTTP 500, not a 4xx,
    // so the limit has to be enforced before the call leaves this client.
    const sent = sentRequestId(calls, '/v2/checkout/orders');
    expect(sent.length).toBeLessThanOrEqual(PAYPAL_REQUEST_ID_MAX_LENGTH);
    expect(sent).toBe(requestIdFor(localKey));
  });

  it('replays the same idempotency header when a create is retried', async () => {
    const { client, calls } = makeClient((url) =>
      url.includes('/v2/checkout/orders') ? json({ id: 'ORDER-1', status: 'CREATED', links: [] }) : tokenResponse()
    );
    const localKey = `scopepay:scope-68696e25-7129-47f8-b93e-9766f787ec68:${SCOPE_HASH}`;
    const input = {
      scopeRef: 'scope-1',
      scopeHash: SCOPE_HASH,
      amountMinor: 1234,
      currency: 'USD',
      merchantId: 'M-1',
      requestKey: localKey,
      returnUrl: 'http://localhost:5173/checkout/return',
      cancelUrl: 'http://localhost:5173/checkout/cancel',
      description: 'ScopePay sandbox order'
    };
    await client.createOrder(input);
    await client.createOrder(input);

    expect(calls.filter((call) => call.url.endsWith('/v2/checkout/orders'))).toHaveLength(2);
    // Same key on retry is what makes PayPal return the original order instead
    // of creating a second one; a per-call value would silently double-charge.
    expect(sentRequestId(calls, '/v2/checkout/orders', 0)).toBe(sentRequestId(calls, '/v2/checkout/orders', 1));
  });
});

describe('idempotency key projection', () => {
  it('passes a key that already fits through unchanged', () => {
    expect(requestIdFor('key-1')).toBe('key-1');
    expect(requestIdFor('a'.repeat(PAYPAL_REQUEST_ID_MAX_LENGTH))).toBe('a'.repeat(PAYPAL_REQUEST_ID_MAX_LENGTH));
  });

  it('shortens a long key deterministically, without collapsing distinct keys', () => {
    const longKey = `scopepay:scope-68696e25-7129-47f8-b93e-9766f787ec68:${SCOPE_HASH}`;
    const projected = requestIdFor(longKey);
    expect(projected.length).toBeLessThanOrEqual(PAYPAL_REQUEST_ID_MAX_LENGTH);
    expect(requestIdFor(longKey)).toBe(projected);
    expect(requestIdFor(`${longKey}-other`)).not.toBe(projected);
  });
});

describe('capture', () => {
  it('refuses to capture an order that is not approved', async () => {
    const { client } = makeClient((url) =>
      url.includes('/v2/checkout/orders') ? json(orderBody({ status: 'CREATED' })) : tokenResponse()
    );
    await expect(client.captureOrder({ orderId: 'ORDER-1', expected: EXPECTED })).rejects.toMatchObject({
      code: 'not_approved'
    });
    try {
      await client.captureOrder({ orderId: 'ORDER-1', expected: EXPECTED });
    } catch (error) {
      expect((error as PaypalError).details.join(' ')).toContain('CREATED');
    }
  });

  it('captures an approved order and returns the real capture identifiers', async () => {
    const { client } = makeClient((url) => {
      if (url.includes('/capture')) return json(captureBody());
      if (url.includes('/v2/checkout/orders')) return json(orderBody());
      return tokenResponse();
    });
    const result = await client.captureOrder({ orderId: 'ORDER-1', expected: EXPECTED, requestKey: 'key-1' });
    expect(result).toMatchObject({
      orderId: 'ORDER-1',
      orderStatus: 'COMPLETED',
      captureId: 'CAP-1',
      captureStatus: 'COMPLETED',
      amountMinor: 1234,
      currency: 'USD',
      payerEmail: 'buyer@example.com'
    });
  });

  it('keeps the capture idempotency header inside the length PayPal accepts', async () => {
    const { client, calls } = makeClient((url) => {
      if (url.includes('/capture')) return json(captureBody());
      if (url.includes('/v2/checkout/orders')) return json(orderBody());
      return tokenResponse();
    });
    const localKey = `scopepay:scope-68696e25-7129-47f8-b93e-9766f787ec68:${SCOPE_HASH}`;
    expect(localKey.length).toBeGreaterThan(PAYPAL_REQUEST_ID_MAX_LENGTH);
    await client.captureOrder({ orderId: 'ORDER-1', expected: EXPECTED, requestKey: localKey });

    const sent = sentRequestId(calls, '/capture');
    expect(sent.length).toBeLessThanOrEqual(PAYPAL_REQUEST_ID_MAX_LENGTH);
    expect(sent).toBe(requestIdFor(localKey));
  });

  it('captures without a payee check when no PayPal merchant id is configured, and says so', async () => {
    const { client } = makeClient((url) => {
      if (url.includes('/capture')) return json(captureBody());
      if (url.includes('/v2/checkout/orders')) {
        return json(
          orderBody({
            purchase_units: [
              {
                reference_id: SCOPE_HASH,
                custom_id: 'scope-1',
                amount: { currency_code: 'USD', value: '12.34' },
                payee: { merchant_id: 'A-REAL-PAYPAL-PAYEE-ID' }
              }
            ]
          })
        );
      }
      return tokenResponse();
    });

    // Unconfigured means "we cannot verify this", not "this is wrong": refusing
    // here would block a legitimate sandbox capture for a missing setting.
    const result = await client.captureOrder({ orderId: 'ORDER-1', expected: { ...EXPECTED, merchantId: null } });
    expect(result.captureId).toBe('CAP-1');
    expect(result.providerMessage).toContain('unverified');
  });

  it('returns a non-completed provider status unchanged', async () => {
    const { client } = makeClient((url) => {
      if (url.includes('/capture')) return json(captureBody({ status: 'PENDING' }, { status: 'COMPLETED' }));
      if (url.includes('/v2/checkout/orders')) return json(orderBody());
      return tokenResponse();
    });
    const result = await client.captureOrder({ orderId: 'ORDER-1', expected: EXPECTED });
    expect(result.captureStatus).toBe('PENDING');
    expect(result.captureStatus).not.toBe('COMPLETED');
  });

  it('rejects a provider amount that does not match the scope', async () => {
    const { client } = makeClient((url) =>
      url.includes('/v2/checkout/orders')
        ? json(
            orderBody({
              purchase_units: [
                {
                  reference_id: SCOPE_HASH,
                  custom_id: 'scope-1',
                  amount: { currency_code: 'USD', value: '99.00' },
                  payee: { merchant_id: 'M-1' }
                }
              ]
            })
          )
        : tokenResponse()
    );
    await expect(client.captureOrder({ orderId: 'ORDER-1', expected: EXPECTED })).rejects.toMatchObject({
      code: 'amount_mismatch'
    });
  });

  it('rejects an order created for a different merchant', async () => {
    const { client } = makeClient((url) =>
      url.includes('/v2/checkout/orders')
        ? json(
            orderBody({
              purchase_units: [
                {
                  reference_id: SCOPE_HASH,
                  custom_id: 'scope-1',
                  amount: { currency_code: 'USD', value: '12.34' },
                  payee: { merchant_id: 'OTHER-MERCHANT' }
                }
              ]
            })
          )
        : tokenResponse()
    );
    await expect(client.captureOrder({ orderId: 'ORDER-1', expected: EXPECTED })).rejects.toMatchObject({
      code: 'merchant_mismatch'
    });
  });

  it('reports a failed capture with the provider issue, never as captured', async () => {
    const { client } = makeClient((url) => {
      if (url.includes('/capture')) {
        return json(
          {
            name: 'UNPROCESSABLE_ENTITY',
            message: 'The requested action could not be performed.',
            details: [{ issue: 'INSTRUMENT_DECLINED', description: 'The instrument presented was declined.' }]
          },
          422
        );
      }
      if (url.includes('/v2/checkout/orders')) return json(orderBody());
      return tokenResponse();
    });
    await expect(client.captureOrder({ orderId: 'ORDER-1', expected: EXPECTED })).rejects.toMatchObject({
      code: 'capture_failed',
      status: 422
    });
    try {
      await client.captureOrder({ orderId: 'ORDER-1', expected: EXPECTED });
    } catch (error) {
      expect((error as PaypalError).details.join(' ')).toContain('INSTRUMENT_DECLINED');
    }
  });
});

describe('webhook verification', () => {
  const headers = {
    'paypal-transmission-id': 'tid-1',
    'paypal-transmission-time': '2026-10-13T00:00:00Z',
    'paypal-transmission-sig': 'sig-1',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
    'paypal-auth-algo': 'SHA256withRSA'
  };

  it('accepts a webhook only when PayPal returns SUCCESS', async () => {
    const { client, calls } = makeClient((url) =>
      url.includes('/verify-webhook-signature') ? json({ verification_status: 'SUCCESS' }) : tokenResponse()
    );
    const result = await client.verifyWebhook({ headers, body: JSON.stringify({ id: 'WH-EVENT-1' }) });
    expect(result.verified).toBe(true);
    const verifyCall = calls.find((call) => call.url.includes('/verify-webhook-signature'));
    const body = JSON.parse(String(verifyCall?.init.body));
    expect(body.webhook_id).toBe('WH-1');
    expect(body.transmission_id).toBe('tid-1');
    expect(body.webhook_event.id).toBe('WH-EVENT-1');
  });

  it('treats a non-SUCCESS verification status as unverified', async () => {
    const { client } = makeClient((url) =>
      url.includes('/verify-webhook-signature') ? json({ verification_status: 'FAILURE' }) : tokenResponse()
    );
    const result = await client.verifyWebhook({ headers, body: '{"id":"WH-EVENT-1"}' });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('FAILURE');
  });

  it('is unverified when signature headers are missing and when no webhook ID is set', async () => {
    const { client } = makeClient(() => tokenResponse());
    const missing = await client.verifyWebhook({ headers: { 'paypal-transmission-id': 'tid-1' }, body: '{}' });
    expect(missing.verified).toBe(false);
    expect(missing.reason).toContain('paypal-transmission-sig');

    const { client: noWebhookId } = makeClient(() => tokenResponse(), { webhookId: undefined });
    const unconfigured = await noWebhookId.verifyWebhook({ headers, body: '{}' });
    expect(unconfigured.verified).toBe(false);
    expect(unconfigured.reason).toContain('webhook ID');
  });

  it('is unverified when the body is not JSON', async () => {
    const { client } = makeClient(() => tokenResponse());
    const result = await client.verifyWebhook({ headers, body: 'not json' });
    expect(result.verified).toBe(false);
  });
});
