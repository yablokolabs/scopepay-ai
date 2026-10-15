# ScopePay deployment and setup

## Local run

```bash
npm install
cp .env.example .env      # fill in the values listed below; .env is git-ignored
npm run dev               # API on :8790 + Vite client on :5173
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
| `PAYPAL_MERCHANT_ID` | PayPal's payee merchant id for this sandbox app (`purchase_units[].payee.merchant_id`), used to check that a capture lands in the expected account. Not the same as `MERCHANT_ID`. Unset is treated as "unverified", not as a match |
| `PAYPAL_IDEMPOTENCY_KEY_PREFIX` | prefix for the local request key sent as `Paypal-Request-Id` (default `scopepay`) |
| `MERCHANT_ID` / `MERCHANT_NAME` | the single sandbox merchant this build is configured for |
| `PUBLIC_BASE_URL` | absolute base URL used for PayPal return/cancel URLs, and for the webhook URL in step 3. Must be the origin that serves the **client**: PayPal sends the buyer's browser to `/checkout/return`, which only the client app implements, so pointing this at the API process returns the buyer to a 404. Defaults to the local client origin `http://localhost:5173`; set it explicitly in every deployment |
| `PORT` | API port, default `8790` |
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
2. Create a sandbox **Personal** buyer test account, with the account **country set to United States** and a **USD** balance. Both matter, and they are easy to get wrong:
   - The buyer must be a *Personal* account. A *Business* account is the seller side; approving an order with it fails with PayPal's `CANNOT_PAY_SELF`.
   - The account's country must be one whose accounts can send this payment. An India-based Personal account signs in and shows a USD balance, but PayPal refuses the order with `UNSUPPORTED_PAYEE_CURRENCY`, because those accounts are receive-only.
   - **Country is fixed at creation and cannot be changed afterwards**, and the *Create Account* dialog defaults to your own country. Set it to **United States** explicitly; an account that was already created as India keeps failing regardless of its balance, its added currencies, or how many times it is re-supplied. Verify a candidate account from its profile page: a US account shows `(GMT-07:00) Pacific Time (Los Angeles)`, while an India account shows `(GMT+05:30) Kolkata`.

   Do not store the buyer's password in the repository, the video, or any export. On the Developer Dashboard, *Testing Tools → Sandbox Accounts → Create Account → Personal*, country United States; the generated password can be changed from `⋯ → View/Edit Account`.
3. Register a webhook on `POST {API origin}/api/webhooks/paypal` and subscribe to the four event types the handler applies: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `CHECKOUT.ORDER.APPROVED`. Copy the webhook id into `PAYPAL_WEBHOOK_ID`.
   - Note the asymmetry with `PUBLIC_BASE_URL`: the return/cancel URLs are followed by the buyer's **browser** and need the client origin, while a webhook is a server-to-server POST that needs the **API** origin. In a single-origin deployment they are the same host; in the local split they are not (`:5173` for the browser, `:8790`/tunnel for the webhook).
   - The app's own client id and secret are enough to do this over the API (`POST /v1/notifications/webhooks`) — no dashboard step is required, and no separate webhook credential exists. `docs/proof/m2-webhook-proof.mjs` performs it.
   - **The URL must be publicly reachable over HTTPS.** PayPal validates it: registering `https://localhost:<PORT>/api/webhooks/paypal` is refused with `400 VALIDATION_ERROR "url Not a valid webhook URL"`, measured against the sandbox host. This is why a webhook id alone cannot produce a signature — the signature exists only per delivery.
4. For local webhook testing, expose the API on an HTTPS URL you control for the duration of the test (an ephemeral tunnel is enough; the one used for the recorded evidence was cloudflared's, which needs no account), register the webhook on it, and delete it again when the tunnel closes. The signature check needs the raw body, and no scheduled job is required because `POST /api/scopes/:id/reconcile` performs the status refresh on demand.
5. Test refusal as well as acceptance: a delivery whose `paypal-transmission-sig` was not issued by PayPal must be answered `400` and stored as `invalid_signature`. A signed event that matches no local attempt is stored as `verified`/`ignored` and changes no state.

`PUBLIC_BASE_URL` needs one of the two origins, not either: the return/cancel URLs it builds are followed by the buyer's **browser**, and `/checkout/return` — which reconciles the order, captures it and shows the receipt — is a client route. The API process answers `404` on those paths, so a base URL pointed at the API leaves the buyer with an error page after a successful approval. `server/config.ts` resolves it, the startup log prints the value in use, and a warning is printed when it is unset or names the API process itself.

Order creation sends `Paypal-Request-Id` (PayPal's documented idempotency header) built from the scope id and version hash, so a retried creation returns the original order rather than a second one. The local key is longer than PayPal accepts, so the client projects it onto a deterministic 38-character value before sending; PayPal answers a longer value with `HTTP 500 INTERNAL_SERVICE_ERROR` rather than a validation error.

The capture payee check compares PayPal's reported `payee.merchant_id` against `PAYPAL_MERCHANT_ID`. On a real sandbox app that id is an opaque account id such as `H6EBGK2NMDSXC`, so it cannot be compared against the catalog's human-readable merchant label — doing so refuses every capture.

## Cloudflare Workers + D1

The demo at `https://scopepay.young-disk-9d1c.workers.dev` runs `worker/index.ts`. It serves `/api/*` and `/health` from the same Hono app as the Node server, and serves the built client from `dist/` with single-page fallback. `wrangler.toml` holds the bindings: D1 as `DB`, and `MODEL_RATE_LIMIT` (10 model calls per caller per minute).

You need a Cloudflare API token with **Workers Scripts: Edit** and **D1: Edit**, exported as `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`.

```bash
npx wrangler d1 create scopepay                     # put the id into wrangler.toml
npx wrangler d1 migrations apply scopepay --remote
npm run build
npx wrangler deploy
npx wrangler secret put CSCS_INFERENCE_API_KEY      # and PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
                                                    # PAYPAL_MERCHANT_ID, PAYPAL_WEBHOOK_ID
```

`PUBLIC_BASE_URL` defaults to the request's own origin on Workers, so PayPal returns the buyer to the deployed URL. Register the PayPal webhook on `<deployed URL>/api/webhooks/paypal` with `node docs/proof/m2-webhook-proof.mjs create <deployed URL>`, then set its id as `PAYPAL_WEBHOOK_ID`.

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
