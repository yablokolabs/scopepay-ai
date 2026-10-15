/**
 * Cloudflare Workers entry.
 *
 * `/api/*` and `/health` run the same Hono app as the Node server (see
 * `wrangler.toml` → `run_worker_first`); everything else is the built client,
 * served by the static-assets binding with single-page fallback.
 *
 * Storage is D1. The model routes are limited per caller by the Rate Limiting
 * binding, so a public demo URL cannot drain the CSCS quota. PayPal stays
 * sandbox-only: `createPaypalClient` refuses any other environment.
 */
import { loadCscsConfigFromEnv, type CscsConfig } from '../lib/cscs.js';
import { createPaypalClient, type PaypalClient } from '../lib/paypal.js';
import type { D1Like } from '../lib/persistence.js';
import { fromWorkersBinding, type RateLimitBinding } from '../lib/rate-limit.js';
import { createScopeService } from '../lib/scope.js';
import { createD1Store } from '../lib/store-d1.js';
import { createApp } from '../server/app.js';

export interface Env {
  DB: D1Like;
  MODEL_RATE_LIMIT: RateLimitBinding;
  CSCS_INFERENCE_API_KEY?: string;
  CSCS_BASE_URL?: string;
  CSCS_MODEL?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  PAYPAL_MERCHANT_ID?: string;
  PAYPAL_IDEMPOTENCY_KEY_PREFIX?: string;
  /** Origin that serves the client; PayPal returns the buyer here. Defaults to the request's own origin. */
  PUBLIC_BASE_URL?: string;
}

function cscsConfig(env: Env): CscsConfig | null {
  try {
    return loadCscsConfigFromEnv(env as unknown as NodeJS.ProcessEnv);
  } catch {
    return null;
  }
}

function paypalClient(env: Env): PaypalClient | null {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return null;
  return createPaypalClient({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    env: 'sandbox',
    webhookId: env.PAYPAL_WEBHOOK_ID
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const store = createD1Store(env.DB);
    const cscs = cscsConfig(env);
    const app = createApp({
      store,
      scopes: createScopeService({ store }),
      paypal: paypalClient(env),
      paypalMerchantId: env.PAYPAL_MERCHANT_ID ?? null,
      cscs,
      requestKeyPrefix: env.PAYPAL_IDEMPOTENCY_KEY_PREFIX ?? 'scopepay',
      publicBaseUrl: env.PUBLIC_BASE_URL ?? new URL(request.url).origin,
      modelName: cscs ? (cscs.model ?? null) : null,
      modelRateLimit: fromWorkersBinding(env.MODEL_RATE_LIMIT)
    });
    return app.fetch(request);
  }
};
