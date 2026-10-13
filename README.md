# ScopePay
**Tagline:** Agree on the work. Approve the payment.
**Repository:** [yablokolabs/scopepay-ai](https://github.com/yablokolabs/scopepay-ai) (public).
**Elevator pitch:** An AI scope-to-checkout assistant for freelancers that turns messy briefs into reviewed deliverables and prices, then links the approved scope to a PayPal sandbox payment.

Build state: implementation running end to end for the scope half — brief →
Apertus extraction → merchant review → immutable version → buyer acceptance →
version-bound change requests — with the PayPal half implemented but **not yet
exercised against PayPal**, because no sandbox credentials exist on the build
host. Nothing in this repository moves real money, and no live PayPal credential
is supported by design.

## What runs today

| Step | Route | State |
| --- | --- | --- |
| Brief → extraction | `POST /api/briefs` | live against CSCS Apertus 1.5 70B |
| Merchant review | `POST /api/scopes/:id/review` | working, quantity-only edits |
| Buyer acceptance | `POST /api/scopes/:id/accept` | working, hash + amount + currency checks |
| Sandbox order | `POST /api/scopes/:id/orders` | implemented, returns 503 until credentials are set |
| Capture | `POST /api/scopes/:id/capture` | implemented, refuses anything not `APPROVED`, mock-tested only |
| Reconciliation | `POST /api/scopes/:id/reconcile` | implemented, mock-tested only |
| Webhook | `POST /api/webhooks/paypal` | implemented, signature-verified, mock-tested only |
| Change request | `POST /api/scopes/:id/changes` | live via Apertus, server-priced |

Recorded evidence, including the exact commands and the defects they exposed:
[`docs/proof/SMOKE_TEST_M0.md`](docs/proof/SMOKE_TEST_M0.md).

## Architecture

```
Brief (untrusted text)
   │  POST /api/briefs
   ▼
CSCS Apertus 1.5 70B ──── proposes catalog item ids + evidence spans + ambiguities
   │                      (never a price, never an approval)
   ▼
Zod-validated proposal ──► merchant review (quantity-only edits, authoritative)
   │                                                                    
   ▼
Immutable ScopeVersion (sha256 hash over the canonical payload, integer cents)
   │  buyer accepts THIS hash and THIS amount
   ▼
Deterministic server gate: status · merchant · hash · amount · currency   ← stale scope stops here
   │
   ▼
PayPal Sandbox: create order (Paypal-Request-Id idempotency)
   │  buyer approves on PayPal's own page
   ▼
Server capture ──► verified only when the provider reports COMPLETED
   │
   ▼
Receipt with the real capture id · verified webhooks · explicit reconciliation

Later changes ──► classification ──► server-priced delta ──► NEW version
                  (a paid version is never rewritten and never silently re-charged)
```

Components: browser client (Vite + React), Hono server routes, Zod schemas as the
only entry point for untrusted input, catalog-driven integer-cent pricing, three
storage adapters (memory / local file / Cloudflare D1) behind one interface.

The architecture diagram required by the submission (self-contained SVG plus a
PNG embedded here) has **not** been produced yet; no placeholder image is
embedded. See `docs/MEDIA_WORKFLOWS.md` for the intended workflow and palette.

### Trust boundary

The server recomputes the amount from merchant catalog data and never accepts a
price from the browser or the model. The model selects catalog ids and
quantities; the merchant approves; the buyer approves an exact version hash;
PayPal decides whether money moved. Model output is validated application-side —
structured-output support is not assumed. Brief text is data, never instructions.

## Run it

```bash
npm install
cp .env.example .env       # set CSCS_INFERENCE_API_KEY; add sandbox PayPal keys to test payments
npm run check              # typecheck + tests
npm run dev                # API on :8790, client on :5173
```

Without PayPal sandbox credentials the payment routes answer
`503 paypal_not_configured` and the checkout control is disabled rather than
faked. Screen and document copy carries explicit `SANDBOX` labels; there is no
footer, copyright bar or credits strip on any page.

## Honest status

- Not production-ready: sandbox only, one merchant, one USD catalog, no tax,
  no shipping, no refunds, no payouts, no marketplace.
- The PayPal client refuses any environment other than `sandbox`.
- Local mocked payment tests do not prove real PayPal error behaviour.
- The extraction evaluation over the 20 frozen briefs is not yet measured.
- Deviation from `PROJECT_BUILD.md`: this build uses Vite + React with a Hono
  server instead of the Sites Vinext starter, because the Sites/Vinext tooling is
  not installed on this host. Documented as unresolved in `docs/DEPLOYMENT.md`,
  not as equivalent.
- Public YouTube upload is required by the competition and has **not** been
  performed; it needs authorization.

Detail: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) ·
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) ·
[`docs/EVALUATION.md`](docs/EVALUATION.md) ·
[`docs/PROGRESS.md`](docs/PROGRESS.md) ·
[`LICENSE`](LICENSE)
