# ScopePay deployment and setup

## Local run

```bash
npm install
cp .env.example .env      # fill in the values listed below; .env is git-ignored
npm run dev               # API on :8787 + Vite client on :5173
npm run typecheck         # tsc --noEmit
npm test                  # vitest run
```

`npm run dev` proxies `/api` from the Vite dev server to the API process. `npm run build` builds the client into `dist/`.

The API also runs without any credentials. In that state read-only routes work and the model/payment routes return an explicit `503` (`model_missing_key`, `paypal_not_configured`) instead of a fabricated result.

## Environment variables

Values live in `.env` locally or in the host's secret store; `.env` is git-ignored and `.env.example` contains names only.

| name | purpose |
| --- | --- |
| `CSCS_INFERENCE_API_KEY` | bearer key for CSCS inference; required for brief extraction and change classification |
| `CSCS_BASE_URL` | defaults to `https://api.inference.cscs.ch/v1` |
| `CSCS_MODEL` | defaults to `swiss-ai/Apertus-v1.5-70B` |
| `PAYPAL_ENV` | `sandbox`; the client refuses anything else |
| `PAYPAL_CLIENT_ID` | sandbox REST app client ID (publishable configuration, but still set per environment) |
| `PAYPAL_CLIENT_SECRET` | sandbox REST app secret — server-side only, never in client code, logs or exports |
| `PAYPAL_WEBHOOK_ID` | sandbox webhook id used to verify signatures |
| `PAYPAL_IDEMPOTENCY_KEY_PREFIX` | prefix for the local request key sent as `Paypal-Request-Id` (default `scopepay`) |
| `MERCHANT_ID` / `MERCHANT_NAME` | the single sandbox merchant this build is configured for |
| `PUBLIC_BASE_URL` | absolute base URL used for PayPal return/cancel URLs (default `http://localhost:<PORT>`) |
| `PORT` | API port, default `8787` |
| `SCOPEPAY_STORE` | `file` (default), `memory`, or `d1` |
| `SCOPEPAY_STORE_FILE` | optional path override for the file store (default `.data/scopepay-store.json`) |

There is no live-credential variable by design: `createPaypalClient` throws `unsupported_env` unless the environment is `sandbox`.

## Storage

Three adapters implement the same `Store` interface (`lib/persistence.ts`):

| `SCOPEPAY_STORE` | adapter | use |
| --- | --- | --- |
| `file` | `lib/store-file.ts` | local development; a single JSON document rewritten atomically |
| `memory` | `lib/store-memory.ts` | tests and ephemeral runs |
| `d1` | `lib/store-d1.ts` | durable hosted storage |

D1 setup: apply `migrations/0001_init.sql` (tables `briefs`, `scope_versions`, `acceptances`, `payment_attempts`, `events`; money as `INTEGER` cents, timestamps as ISO-8601 `TEXT`, JSON payload columns as text) and pass the binding to `createStore({ kind: 'd1', d1 })`. The binding only needs the structural shape declared in `lib/persistence.ts`:

```ts
interface D1Like {
  prepare(query: string): { bind(...values: unknown[]): D1LikeStatement; first<T>(): Promise<T | null>; all<T>(): Promise<{ results?: T[] }>; run(): Promise<unknown> };
  exec(query: string): Promise<unknown>;
}
```

Scope versions are insert-only; only the status lifecycle columns are ever updated. The D1 adapter has no live-database test in this repository — it is covered by assertions on the migration SQL only, so it must be exercised against a real D1 binding before it is trusted.

## PayPal sandbox setup

1. Create a developer app at `https://developer.paypal.com/dashboard/applications/sandbox` and copy its client ID and secret into `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
2. Create a sandbox buyer test account. Do not store its password in the repository, the video, or any export.
3. Add a webhook pointing at `POST {PUBLIC_BASE_URL}/api/webhooks/paypal` and subscribe to the four event types the handler applies: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `CHECKOUT.ORDER.APPROVED`. Copy the webhook id into `PAYPAL_WEBHOOK_ID`.
4. For local webhook testing, expose the local API with an HTTPS tunnel you already control; the signature check needs the raw body, and no scheduled job is required because `POST /api/scopes/:id/reconcile` performs the status refresh on demand.

Order creation sends `Paypal-Request-Id` (PayPal's documented idempotency header) built from the scope id and version hash, so a retried creation returns the original order rather than a second one.

## Deviation from the build specification

`PROJECT_BUILD.md` calls for a Sites/Vinext starter with server routes and D1. The Sites/Vinext CLI is **not installed on this host**, so this build uses Vite + React for the client and a Hono server (`@hono/node-server` locally, Worker-compatible routing) with Zod schemas and a D1 adapter behind the same `Store` interface. This is a **deviation to resolve**, not an equivalent: the client is a single-page React app rather than a Sites route tree, and the deployment path to Sites is unverified. Routes keep the intended names (`orders`, `capture`, `webhooks`, `reconcile`, `scope`, `accept`).

## What is not production-ready

- Sandbox only: no live PayPal app, no production credentials, and `lib/paypal.ts` refuses a non-sandbox environment.
- No refunds, payouts, subscriptions, FX, tax, shipping, escrow, dispute handling or marketplace features. `PAYMENT.CAPTURE.REFUNDED` is only recorded.
- One merchant, one fixed-price catalog, one currency (USD), one order at a time.
- The `file` store is single-process development storage; concurrent writers are not coordinated beyond a local write queue.
- The D1 adapter and the Sites deployment path are untested against real infrastructure.
- Webhook delivery is assumed possible but never assumed instant; scheduled/background reconciliation is not implemented.
- No production payments, security, privacy or legal review has been performed, and nothing here is legal advice or a certification of scope.
