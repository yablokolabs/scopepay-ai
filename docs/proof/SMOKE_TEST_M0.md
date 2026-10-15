# M0/M1 live smoke test — recorded evidence

Date: October 13, 2026 (Asia/Kolkata). Host: build VM. Branch: `main`.
Every line below was produced by the command above it against the running
server (`npm run start`, `SCOPEPAY_STORE=file`, port 8790) with the real CSCS
inference endpoint. No PayPal sandbox credentials were available, so every
payment step is deliberately reported as unconfigured rather than simulated.

This file contains no credential, no access token and no buyer password. Scope
ids, hashes and amounts are not secrets.

## 1. Provider access check (CSCS)

`GET https://api.inference.cscs.ch/v1/models` → **200**, 11 models.
`swiss-ai/Apertus-v1.5-70B` is listed, along with `-thinking`, 8B and
`Apertus-70B-Instruct-2509` variants.

`POST /v1/chat/completions` with `model: swiss-ai/Apertus-v1.5-70B` → **200**,
`vllm-0.23.1rc1` fingerprint, content `{"ok":true}`.

## 2. Server readiness

```
GET /health        → 200 {"ok":true,"store":"ready","paypalConfigured":false,"modelConfigured":true,"sandbox":true}
GET /api/config    → 200 sandbox:true, merchant sandbox-merchant-1, catalog-2026-10-13,
                          model swiss-ai/Apertus-v1.5-70B, paypalConfigured:false
```

Startup log line: `CSCS Apertus extraction: configured` /
`PayPal sandbox: MISSING (set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)`.

## 3. Real extraction — brief to draft scope

Brief (350 characters, synthetic bakery site, deliberately mixes a budget cap and
an out-of-catalog request):

> We need a simple site for our bakery. About 5 pages: home, our story, breads,
> wholesale enquiries and contact. We have all the copy written already but it
> needs a tidy up pass. We have a logo. Please make it work nicely on phones. Our
> budget is tight, about $1,200. Also we would love an online ordering system
> with card payments if that is possible.

`POST /api/briefs` → **201**

```
scope: scope-c6b8d88c-… v1 draft
amount: 1640.00 USD      hash: 36c025ad2788760a…
model: swiss-ai/Apertus-v1.5-70B 10781ms 806p/708c attempts:1
lines: landing-page x1, content-page x4, copy-editing x1, basic-seo x1, deployment-handover x1
spans: "We have all the copy written already but it needs a tidy up pass."
       (each line carries the brief text it came from)
ambiguities: ["Online ordering system with card payments is requested but not available
               in the studio catalog.",
              "Budget of $1,200 is mentioned but the studio's catalog pricing is not
               provided; total cost will be computed by the studio server."]
warnings: []
```

The model reported the out-of-catalog request and the budget conflict as
ambiguities; it did not invent an item, a discount or a price.

## 4. Merchant review produces a new immutable version

`POST /api/scopes/<v1>/review` with `action: "edit"`, `content-page` reduced 4 → 3
→ **200** `v2 awaiting_buyer parent: <v1> 1460.00 USD`

v1 became `superseded`. Amount difference equals exactly one catalog
`content-page` at $180.00 — the server recomputed from the catalog.

## 5. Deterministic buyer-acceptance checks

| Request | Result |
| --- | --- |
| accept with `confirmedAmountMinor = 145999` (one cent low) | **409** `amount_mismatch`, details `scopeAmountMinor=146000`, `confirmedAmountMinor=145999` |
| accept with an all-zero hash | **409** `hash_mismatch` with current and accepted hashes |
| accept with the stored hash and amount | **200**, acceptance stored |

## 6. Payment gate without sandbox credentials

| Request | Result |
| --- | --- |
| `POST /orders` with correct values | **503** `paypal_not_configured` — no order is created and no amount is invented |
| `POST /orders` sending v1's hash to v2 | **409** `stale_scope`, details show `currentHash` vs `acceptedHash` |
| `POST /orders` against the superseded v1 | **409** `scope_not_awaiting_buyer`, `status=superseded` |
| `POST /capture` with no order | **404** `attempt_not_found` |
| `POST /reconcile` with no order | returns no attempt, `source: "no order exists yet"` |

The deterministic scope checks run before the provider gate, so a stale or
mismatched request is answered on its own merits even while credentials are
missing.

## 7. Real change classification, and two defects it exposed

`POST /api/scopes/<v2>/changes` with "add another content page … and online
ordering with card payments":

```
changeClass: new_scope_delta  confident: true
lines: []            server delta: 0.00 USD
```

The first run created a new version with identical lines and a zero delta, and
that is what the fix now prevents: with no catalog line there is nothing the
server can price, so the agreed version is left untouched
(`tests/domain/scope.test.ts` covers it).

Two further defects were found and fixed while re-running this path:

1. Change-request quotes were resolved against the original brief instead of the
   change text, so every change line lost its source span.
2. Merging a change could exceed a catalog maximum (a second `contact-form`)
   and fail the whole request. It is now capped at the catalog maximum with an
   explicit shortfall message instead.

Verified after the fixes, same live endpoint:

```
changeClass: in_scope_adjustment confident: true
lines: content-page x2 (quote "Please add two more content pages"),
       contact-form x1 (quote "and a contact form with email delivery.")
delta: 360.00 USD   createdNewVersion: true
warnings: ["Contact form with email delivery is at its catalog maximum of 1 form,
            so the extra 1 form in this request cannot be added. It needs a
            separate agreement."]
new version: v5 lines: landing-page x1, content-page x7, copy-editing x1,
                       basic-seo x1, deployment-handover x1, contact-form x1
```

## 8. What is still unproven

- No PayPal sandbox order, approval, capture, webhook or reconciliation has been
  executed against PayPal **at the time of this M0/M1 run**. Those paths were
  covered by mocked-transport tests only, which do not prove real provider
  behaviour. Superseded for the payment half by
  [`PROOF_M2_SANDBOX.md`](PROOF_M2_SANDBOX.md), which records a real order,
  approval and capture; webhook verification remains unproven there too.
- The evaluation in `docs/EVALUATION.md` (per-field precision/recall over the 20
  frozen briefs) has not been run; only single live calls are recorded above.
- No currency other than USD, no tax, no shipping, no refund has been exercised.

## Reproduce

```bash
npm install
cp .env.example .env    # then set CSCS_INFERENCE_API_KEY; add PayPal sandbox keys to test payments
npm run check           # typecheck + tests (95 when this run was recorded; the suite has grown since)
npm run start           # http://localhost:8790
```
