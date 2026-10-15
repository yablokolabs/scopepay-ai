/**
 * PayPal REST client for ScopePay.
 *
 * SANDBOX ONLY by design: this build is for developer-sandbox testing, so
 * `env` is the literal 'sandbox' and the base URL defaults to
 * https://api-m.sandbox.paypal.com. There is deliberately no credential path,
 * flag or branch to the live api-m.paypal.com host; live payments are out of
 * scope for this project.
 *
 * The client reports only what PayPal actually returns. It never upgrades a
 * provider status to "completed" and never treats a browser approval as proof
 * of capture.
 */
import { z } from 'zod';
import { sha256Hex } from './hashing.js';

export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  /** Must be the literal 'sandbox'. */
  env: 'sandbox';
  webhookId?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export type PaypalErrorCode =
  | 'missing_credentials'
  | 'unsupported_env'
  | 'auth_failed'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'merchant_mismatch'
  | 'not_approved'
  | 'capture_failed'
  | 'webhook_unverified';

export class PaypalError extends Error {
  readonly code: PaypalErrorCode;
  readonly status?: number;
  readonly details: string[];

  constructor(code: PaypalErrorCode, message: string, options: { status?: number; details?: string[] } = {}) {
    super(message);
    this.name = 'PaypalError';
    this.code = code;
    this.status = options.status;
    this.details = options.details ?? [];
  }
}

export interface PaypalCreateOrderInput {
  scopeRef: string;
  scopeHash: string;
  amountMinor: number;
  currency: string;
  merchantId: string;
  requestKey: string;
  returnUrl: string;
  cancelUrl: string;
  description: string;
}

export interface PaypalCaptureResult {
  orderId: string;
  orderStatus: string;
  captureId: string | null;
  captureStatus: string | null;
  amountMinor: number | null;
  currency: string | null;
  payerEmail: string | null;
  providerMessage: string | null;
}

const DEFAULT_BASE_URL = 'https://api-m.sandbox.paypal.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * Length PayPal accepts for the `Paypal-Request-Id` idempotency header.
 *
 * PayPal's idempotency documentation recommends a UUID, i.e. 38 single-byte
 * characters. Measured against the sandbox Orders v2 API on 2026-10-14: 108
 * characters is accepted, and 109 or more is answered with HTTP 500
 * `INTERNAL_SERVICE_ERROR` rather than a validation error, so the value has to
 * be bounded before the request leaves this client. This stays inside the
 * documented maximum rather than the observed one.
 */
export const PAYPAL_REQUEST_ID_MAX_LENGTH = 38;

/**
 * Project a local idempotency key onto a value PayPal accepts.
 *
 * The local key is human-readable on purpose (prefix + scope version id +
 * version hash) and lives in the store, but it is far longer than PayPal
 * allows. Shortening it with a deterministic hash keeps the property that
 * matters: the same local key always produces the same header value, so a
 * retried create or capture replays the original request instead of starting a
 * second purchase. A random or per-call value would silently break that.
 */
export function requestIdFor(requestKey: string): string {
  if (requestKey.length <= PAYPAL_REQUEST_ID_MAX_LENGTH) return requestKey;
  const suffixLength = PAYPAL_REQUEST_ID_MAX_LENGTH - 'sp-'.length;
  return `sp-${sha256Hex(requestKey).slice(0, suffixLength)}`;
}

/** Integer cents -> PayPal's decimal string. No floating point arithmetic. */
export function minorToDecimalString(minor: number): string {
  if (!Number.isInteger(minor) || minor < 0) {
    throw new PaypalError('invalid_response', `Amount ${minor} is not a non-negative integer in minor units.`);
  }
  const whole = Math.floor(minor / 100);
  const cents = String(minor % 100).padStart(2, '0');
  return `${whole}.${cents}`;
}

/** PayPal's decimal string -> integer cents. Rejects sub-cent values instead of rounding. */
export function decimalStringToMinor(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new PaypalError('invalid_response', `Amount "${value}" is not a valid 2-decimal currency value.`);
  }
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const minor = whole * 100 + Number(fraction);
  if (!Number.isSafeInteger(minor)) {
    throw new PaypalError('invalid_response', `Amount "${value}" is outside the supported range.`);
  }
  return minor;
}

const LinkSchema = z.object({ href: z.string().min(1), rel: z.string().min(1), method: z.string().optional() });
const AmountSchema = z.object({ currency_code: z.string().min(1), value: z.string().min(1) });

const OrderSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  links: z.array(LinkSchema).optional(),
  payer: z.object({ email_address: z.string().optional() }).optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        custom_id: z.string().optional(),
        amount: AmountSchema.optional(),
        payee: z.object({ merchant_id: z.string().optional() }).optional(),
        payments: z
          .object({
            captures: z
              .array(z.object({ id: z.string().min(1), status: z.string().min(1) }))
              .optional()
          })
          .optional()
      })
    )
    .optional()
});

const TokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() });

const CaptureSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  message: z.string().optional(),
  name: z.string().optional(),
  details: z.array(z.object({ issue: z.string(), description: z.string().optional() })).optional(),
  purchase_units: z
    .array(
      z.object({
        payments: z
          .object({
            captures: z
              .array(
                z.object({
                  id: z.string().min(1),
                  status: z.string().min(1),
                  amount: AmountSchema.optional(),
                  custom_id: z.string().optional()
                })
              )
              .optional()
          })
          .optional()
      })
    )
    .optional()
});

const WebhookVerificationSchema = z.object({ verification_status: z.string() });

function toBase64(value: string): string {
  const globalBtoa = (globalThis as { btoa?: (input: string) => string }).btoa;
  if (typeof globalBtoa === 'function') return globalBtoa(value);
  return Buffer.from(value, 'utf8').toString('base64');
}

function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function providerDetails(body: unknown): string[] {
  const parsed = z
    .object({
      name: z.string().optional(),
      message: z.string().optional(),
      error_description: z.string().optional(),
      details: z.array(z.object({ issue: z.string(), description: z.string().optional() })).optional()
    })
    .safeParse(body);
  if (!parsed.success) return [];
  const details: string[] = [];
  if (parsed.data.name) details.push(parsed.data.name);
  if (parsed.data.message) details.push(parsed.data.message);
  if (parsed.data.error_description) details.push(parsed.data.error_description);
  for (const entry of parsed.data.details ?? []) {
    details.push(entry.description ? `${entry.issue}: ${entry.description}` : entry.issue);
  }
  return details;
}

export interface PaypalOrderSnapshot {
  orderId: string;
  status: string;
  amountMinor: number | null;
  currency: string | null;
  payerEmail: string | null;
  customId: string | null;
  referenceId: string | null;
  merchantId: string | null;
  /** Present once the order has been captured; the only honest source for reconciliation. */
  captureId: string | null;
  captureStatus: string | null;
}

export function createPaypalClient(config: PaypalConfig, fetchImpl: typeof fetch = fetch) {
  if (config.env !== 'sandbox') {
    throw new PaypalError('unsupported_env', 'ScopePay only supports the PayPal developer sandbox; live credentials are out of scope.');
  }
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cachedToken: { token: string; expiresAt: number } | null = null;

  async function call(input: {
    method: 'GET' | 'POST';
    path: string;
    token?: string;
    headers?: Record<string, string>;
    body?: unknown;
    basicAuth?: string;
  }): Promise<{ status: number; ok: boolean; json: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${input.path}`, {
        method: input.method,
        headers: {
          'Content-Type': 'application/json',
          ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
          ...(input.basicAuth ? { Authorization: `Basic ${input.basicAuth}` } : {}),
          ...(input.headers ?? {})
        },
        body: input.body === undefined ? undefined : typeof input.body === 'string' ? input.body : JSON.stringify(input.body),
        signal: controller.signal
      });
      const text = await response.text();
      let json: unknown = null;
      if (text.length > 0) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return { status: response.status, ok: response.ok, json };
    } catch (error) {
      if (error instanceof PaypalError) throw error;
      if ((error as { name?: string }).name === 'AbortError') {
        throw new PaypalError('timeout', `PayPal request ${input.path} exceeded the ${timeoutMs}ms timeout.`);
      }
      throw new PaypalError('http_error', `PayPal request ${input.path} failed to complete: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getAccessToken(): Promise<{ token: string; expiresInSeconds: number }> {
    if (!config.clientId || !config.clientSecret) {
      throw new PaypalError('missing_credentials', 'PayPal sandbox client ID and secret are required on the server.');
    }
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt > now) {
      return { token: cachedToken.token, expiresInSeconds: Math.floor((cachedToken.expiresAt - now) / 1000) };
    }
    const basicAuth = toBase64(`${config.clientId}:${config.clientSecret}`);
    const result = await call({
      method: 'POST',
      path: '/v1/oauth2/token',
      basicAuth,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    if (!result.ok) {
      throw new PaypalError('auth_failed', `PayPal rejected the sandbox credentials (HTTP ${result.status}).`, {
        status: result.status,
        details: providerDetails(result.json)
      });
    }
    const parsed = TokenSchema.safeParse(result.json);
    if (!parsed.success) {
      throw new PaypalError('invalid_response', 'PayPal token response did not contain an access token.', {
        status: result.status
      });
    }
    const expiresInSeconds = parsed.data.expires_in ?? 3000;
    cachedToken = { token: parsed.data.access_token, expiresAt: now + expiresInSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS };
    return { token: parsed.data.access_token, expiresInSeconds };
  }

  async function authedToken(): Promise<string> {
    return (await getAccessToken()).token;
  }

  async function fetchOrder(orderId: string): Promise<PaypalOrderSnapshot> {
    const token = await authedToken();
    const result = await call({ method: 'GET', path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`, token });
    if (!result.ok) {
      throw new PaypalError('http_error', `PayPal could not return order ${orderId} (HTTP ${result.status}).`, {
        status: result.status,
        details: providerDetails(result.json)
      });
    }
    const parsed = OrderSchema.safeParse(result.json);
    if (!parsed.success) {
      throw new PaypalError('invalid_response', `PayPal order ${orderId} response was not in the documented shape.`, {
        status: result.status
      });
    }
    const order = parsed.data;
    const unit = order.purchase_units?.[0];
    let amountMinor: number | null = null;
    if (unit?.amount) {
      try {
        amountMinor = decimalStringToMinor(unit.amount.value);
      } catch (error) {
        throw new PaypalError('invalid_response', `PayPal order ${orderId} returned an unparseable amount.`, {
          details: [(error as Error).message]
        });
      }
    }
    return {
      orderId: order.id,
      status: order.status,
      amountMinor,
      currency: unit?.amount?.currency_code ?? null,
      payerEmail: order.payer?.email_address ?? null,
      customId: unit?.custom_id ?? null,
      referenceId: unit?.reference_id ?? null,
      merchantId: unit?.payee?.merchant_id ?? null,
      captureId: unit?.payments?.captures?.[0]?.id ?? null,
      captureStatus: unit?.payments?.captures?.[0]?.status ?? null
    };
  }

  return {
    getAccessToken,

    async createOrder(input: PaypalCreateOrderInput): Promise<{ orderId: string; status: string; approvalUrl: string | null }> {
      const token = await authedToken();
      const body = {
        intent: 'CAPTURE',
        application_context: {
          brand_name: 'ScopePay (Sandbox)',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl
        },
        purchase_units: [
          {
            reference_id: input.scopeHash,
            custom_id: input.scopeRef,
            description: input.description.slice(0, 127),
            amount: { currency_code: input.currency, value: minorToDecimalString(input.amountMinor) }
          }
        ]
      };
      // Paypal-Request-Id is PayPal's documented idempotency header: a retried
      // creation with the same key returns the original order instead of a second one.
      const result = await call({
        method: 'POST',
        path: '/v2/checkout/orders',
        token,
        headers: { 'Paypal-Request-Id': requestIdFor(input.requestKey) },
        body
      });
      if (!result.ok) {
        throw new PaypalError('http_error', `PayPal refused to create the sandbox order (HTTP ${result.status}).`, {
          status: result.status,
          details: providerDetails(result.json)
        });
      }
      const parsed = OrderSchema.safeParse(result.json);
      if (!parsed.success) {
        throw new PaypalError('invalid_response', 'PayPal order creation response was not in the documented shape.', {
          status: result.status
        });
      }
      const link = (parsed.data.links ?? []).find((entry) => entry.rel === 'payer-action' || entry.rel === 'approve');
      return { orderId: parsed.data.id, status: parsed.data.status, approvalUrl: link?.href ?? null };
    },

    async getOrder(orderId: string): Promise<PaypalOrderSnapshot> {
      return fetchOrder(orderId);
    },

    async captureOrder(input: {
      orderId: string;
      /**
       * `merchantId` is the PayPal payee id this sandbox app collects for, not
       * the human-readable merchant label in the catalog. It is null when the
       * operator has not configured it, and a null expectation means "cannot
       * verify", never "matches": refusing there would block a legitimate
       * capture over a missing setting.
       */
      expected: { amountMinor: number; currency: string; merchantId: string | null };
      requestKey?: string;
    }): Promise<PaypalCaptureResult> {
      const notes: string[] = [];
      // Never capture blind: read the order back and check what PayPal says now.
      const order = await fetchOrder(input.orderId);
      if (order.status !== 'APPROVED') {
        throw new PaypalError('not_approved', `Order ${order.orderId} is not in an approvable state for capture.`, {
          details: [`PayPal reports status "${order.status}"; only APPROVED orders are captured.`]
        });
      }
      if (order.amountMinor === null || order.amountMinor !== input.expected.amountMinor) {
        throw new PaypalError('amount_mismatch', 'PayPal order amount does not match the scope amount being paid.', {
          details: [
            `PayPal: ${order.amountMinor === null ? 'no amount returned' : minorToDecimalString(order.amountMinor)} ${order.currency ?? ''}`.trim(),
            `ScopePay expected: ${minorToDecimalString(input.expected.amountMinor)} ${input.expected.currency}`
          ]
        });
      }
      if (order.currency !== input.expected.currency) {
        throw new PaypalError('currency_mismatch', 'PayPal order currency does not match the scope currency.', {
          details: [`PayPal: ${order.currency ?? 'none'}; ScopePay expected: ${input.expected.currency}`]
        });
      }
      if (order.merchantId === null) {
        notes.push('PayPal did not return a payee merchant_id for this order, so merchant match is unverified.');
      } else if (input.expected.merchantId === null) {
        notes.push(
          `PayPal reported payee merchant ${order.merchantId}; no PAYPAL_MERCHANT_ID is configured, so merchant match is unverified.`
        );
      } else if (order.merchantId !== input.expected.merchantId) {
        throw new PaypalError('merchant_mismatch', 'PayPal order was created for a different merchant account.', {
          details: [`PayPal payee: ${order.merchantId}`, `ScopePay expected payee: ${input.expected.merchantId}`]
        });
      }
      const token = await authedToken();
      const result = await call({
        method: 'POST',
        path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
        token,
        headers: input.requestKey ? { 'Paypal-Request-Id': requestIdFor(input.requestKey) } : {},
        body: {}
      });
      if (!result.ok) {
        throw new PaypalError('capture_failed', `PayPal capture for order ${input.orderId} failed (HTTP ${result.status}).`, {
          status: result.status,
          details: providerDetails(result.json)
        });
      }
      const parsed = CaptureSchema.safeParse(result.json);
      if (!parsed.success) {
        throw new PaypalError('invalid_response', `PayPal capture response for order ${input.orderId} was not in the documented shape.`, {
          status: result.status
        });
      }
      const capture = parsed.data.purchase_units?.[0]?.payments?.captures?.[0];
      let captureAmountMinor: number | null = null;
      let captureCurrency: string | null = null;
      if (capture?.amount) {
        try {
          captureAmountMinor = decimalStringToMinor(capture.amount.value);
          captureCurrency = capture.amount.currency_code;
        } catch {
          notes.push('PayPal returned a capture amount ScopePay could not parse; treat reconciliation as required.');
        }
      }
      const messageParts = [parsed.data.message, ...providerDetails(result.json), ...notes].filter(
        (entry): entry is string => Boolean(entry)
      );
      return {
        orderId: parsed.data.id,
        // The real provider status. A non-COMPLETED capture is reported as-is.
        orderStatus: parsed.data.status,
        captureId: capture?.id ?? null,
        captureStatus: capture?.status ?? null,
        amountMinor: captureAmountMinor,
        currency: captureCurrency,
        payerEmail: order.payerEmail,
        providerMessage: messageParts.length > 0 ? messageParts.join(' | ') : null
      };
    },

    async verifyWebhook(input: {
      headers: Record<string, string | undefined>;
      body: string;
    }): Promise<{ verified: boolean; reason: string }> {
      if (!config.webhookId) {
        return { verified: false, reason: 'No PayPal webhook ID is configured, so signature verification cannot run.' };
      }
      const transmissionId = headerValue(input.headers, 'paypal-transmission-id');
      const transmissionTime = headerValue(input.headers, 'paypal-transmission-time');
      const transmissionSig = headerValue(input.headers, 'paypal-transmission-sig');
      const certUrl = headerValue(input.headers, 'paypal-cert-url');
      const authAlgo = headerValue(input.headers, 'paypal-auth-algo');
      const missing = [
        ['paypal-transmission-id', transmissionId],
        ['paypal-transmission-time', transmissionTime],
        ['paypal-transmission-sig', transmissionSig],
        ['paypal-cert-url', certUrl],
        ['paypal-auth-algo', authAlgo]
      ]
        .filter(([, value]) => !value)
        .map(([name]) => name);
      if (missing.length > 0) {
        return { verified: false, reason: `Missing webhook signature header(s): ${missing.join(', ')}.` };
      }
      let event: unknown;
      try {
        event = JSON.parse(input.body);
      } catch {
        return { verified: false, reason: 'Webhook body is not valid JSON, so it cannot be verified.' };
      }
      const token = await authedToken();
      const result = await call({
        method: 'POST',
        path: '/v1/notifications/verify-webhook-signature',
        token,
        body: {
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: config.webhookId,
          webhook_event: event
        }
      });
      if (!result.ok) {
        return { verified: false, reason: `PayPal signature verification call failed with HTTP ${result.status}.` };
      }
      const parsed = WebhookVerificationSchema.safeParse(result.json);
      if (!parsed.success) {
        return { verified: false, reason: 'PayPal signature verification response was not in the documented shape.' };
      }
      const verified = parsed.data.verification_status === 'SUCCESS';
      return {
        verified,
        reason: verified ? 'PayPal verified the webhook signature.' : `PayPal returned verification_status "${parsed.data.verification_status}".`
      };
    }
  };
}

export type PaypalClient = ReturnType<typeof createPaypalClient>;
