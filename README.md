<p align="center"><img src="scopepay-ai-logo.png" alt="ScopePay. Agree on the work. Approve the payment." width="560"></p>

# ScopePay
**Tagline:** Agree on the work. Approve the payment.
**Repository:** [yablokolabs/scopepay-ai](https://github.com/yablokolabs/scopepay-ai) (public).
**Live demo (PayPal sandbox):** https://scopepay.young-disk-9d1c.workers.dev · how to test: [`docs/TESTING.md`](docs/TESTING.md)
**Elevator pitch:** An AI scope-to-checkout assistant for freelancers that turns messy briefs into reviewed deliverables and prices, then links the approved scope to a PayPal sandbox payment.

Build state: the scope half runs end to end — brief → Apertus extraction →
merchant review → immutable version → buyer acceptance → version-bound change
requests — and the payment half has been **completed against real PayPal sandbox
end to end**: a sandbox buyer approved the order on PayPal's own page and the
server captured it, producing a **real capture id** (`6YS286962F723210Y`,
`COMPLETED`, `1640.00 USD`), which the sandbox merchant's own wallet shows as a
received payment. Nothing in this repository moves real money, and no live PayPal
credential is supported by design.

## What runs today

| Step | Route | State |
| --- | --- | --- |
| Brief → extraction | `POST /api/briefs` | live against CSCS Apertus 1.5 70B |
| Merchant review | `POST /api/scopes/:id/review` | working, quantity-only edits |
| Buyer acceptance | `POST /api/scopes/:id/accept` | working, hash + amount + currency checks |
| Sandbox order | `POST /api/scopes/:id/orders` | **live against real PayPal sandbox**; returns 503 until credentials are set |
| Capture | `POST /api/scopes/:id/capture` | **live end to end**; captured a buyer-approved sandbox order into a real capture id (`6YS286962F723210Y`), and refuses anything not `APPROVED` |
| Reconciliation | `POST /api/scopes/:id/reconcile` | **live against real PayPal sandbox** |
| Webhook | `POST /api/webhooks/paypal` | **live-verified with PayPal's own verifier**: a real signed delivery accepted, a forged signature refused. Receiving deliveries needs a publicly reachable HTTPS URL, so registration is a deployment step |
| Change request | `POST /api/scopes/:id/changes` | live via Apertus, server-priced |

Recorded evidence, including the exact commands and the defects they exposed:
[`docs/proof/SMOKE_TEST_M0.md`](docs/proof/SMOKE_TEST_M0.md) (scope half) and
[`docs/proof/PROOF_M2_SANDBOX.md`](docs/proof/PROOF_M2_SANDBOX.md) (PayPal
sandbox half).

## Architecture

![ScopePay payment flow](docs/payment-flow.png)

ScopePay payment flow: an untrusted brief becomes catalog ids that Apertus
proposes (never a price), a merchant-reviewed immutable version, and a buyer
acceptance of that exact hash and amount. The deterministic server gate rejects
a stale or tampered request, or lets it reach the PayPal sandbox. A capture counts
only when PayPal reports `COMPLETED`. A later change is priced by the server and
always becomes a new version. A paid version is never rewritten or re-charged.
Sources: [`docs/payment-flow.svg`](docs/payment-flow.svg) and
[`docs/payment-flow.html`](docs/payment-flow.html).

Components: browser client (Vite + React), Hono server routes, Zod schemas as the
only entry point for untrusted input, catalog-driven integer-cent pricing, three
storage adapters (memory / local file / Cloudflare D1) behind one interface.

![ScopePay architecture](docs/architecture.png)

ScopePay payment architecture: the buyer's browser, the server process and its
trust boundary, the CSCS Apertus model behind an id-only contract, the
deterministic gate that is the only path from a scope version to a provider call,
and the PayPal sandbox that decides whether money moved. Every box is implemented;
nothing is drawn as "planned".

Sources: [`docs/architecture.svg`](docs/architecture.svg) (standalone, scalable)
and [`docs/architecture.html`](docs/architecture.html) (the generator output).
Built with [diagram-design](https://github.com/cathrynlavery/diagram-design)
pinned at `11b08ea`. Export with `node videos/scripts/export-diagram.mjs`; check
with `node videos/scripts/check-diagram.mjs`.

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

`PUBLIC_BASE_URL` must name the origin that serves the client, because PayPal
returns the buyer's browser there after approval. It defaults to the local client
origin (`http://localhost:5173`) rather than to the API process, which serves no
`/checkout/*` route; set it explicitly for any non-local deployment. Startup
prints the value in use and warns when it cannot work.

Without PayPal sandbox credentials the payment routes answer
`503 paypal_not_configured` and the checkout control is disabled rather than
faked. Screen and document copy carries explicit `SANDBOX` labels; there is no
footer, copyright bar or credits strip on any page.

## Honest status

- Not production-ready: sandbox only, one merchant, one USD catalog, no tax,
  no shipping, no refunds, no payouts, no marketplace.
- The PayPal client refuses any environment other than `sandbox`.
- **A real capture id exists:** `6YS286962F723210Y` (`COMPLETED`, `1640.00 USD`),
  from a live run — real order, buyer approval on PayPal's own page, server
  capture — confirmed on the seller side as a received payment. Webhook signature
  verification is proven against PayPal's verifier too. What is still unexercised:
  a signed event that *applies* state (a simulated event matches no local
  attempt), redelivery of a real event (PayPal's resend endpoint answered 404 for
  a simulated one), and timeouts and declines.
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
