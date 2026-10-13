# ScopePay API contract

Derived from `server/app.ts`, `server/services/checkout.ts` and the Zod schemas in `lib/schemas.ts`. Every request body is parsed with Zod before any domain code runs; unparsed fields are dropped.

All money is an integer number of cents (`amountMinor`, `confirmedAmountMinor`, `unitPriceMinor`). There is no float money in the API. Currency is fixed to `USD` for this build.

Errors always use one envelope shape:

```json
{ "error": { "code": "stale_scope", "message": "…", "details": ["…"] } }
```

## Sandbox status of the payment routes

The PayPal integration is **sandbox only**. `lib/paypal.ts` refuses to construct a client unless `env` is the literal `'sandbox'`, and its base URL is `https://api-m.sandbox.paypal.com`; there is no code path that reaches `api-m.paypal.com`. Without `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` the process builds no PayPal client and every route that would call PayPal answers:

| status | code | meaning |
| --- | --- | --- |
| 503 | `paypal_not_configured` | no sandbox credentials on the server; nothing was sent to PayPal |

Read-only routes (`/health`, `/api/config`, `/api/catalog`, `/api/fixtures`, `/api/events`, `GET /api/scopes/:id`) still work in that state.

## Read routes

### `GET /health`

`200` → `{ ok: true, store: "ready", paypalConfigured: boolean, modelConfigured: boolean, sandbox: true }`

### `GET /api/config`

`200` → `sandbox`, `merchantId`, `merchantName`, `currency`, `catalogVersion`, `taxIncluded` (always `false`), `shippingIncluded` (always `true`), `model`, `modelConfigured`, `paypalConfigured`, `standardExclusions[]`.

### `GET /api/catalog`

`200` → `{ catalog }` — items with `id`, `label`, `unitPriceMinor`, `minQty`, `maxQty`, `unit`, `deliverableTemplate`, `description`.

### `GET /api/fixtures`

`200` → `{ briefs: [{ id, category, text, notes }], changes: [{ id, kind, text, expectedChangeClass }] }` — the frozen synthetic evaluation set.

### `GET /api/events?limit=`

`200` → `{ events }` — persisted webhook records, most recent first. `limit` is clamped to 1–100, default 25. Each event carries `eventId`, `eventType`, `resourceId`, `verificationState` (`verified` / `invalid_signature` / `unverifiable`), `receivedAt`, `processedState` (`applied` / `duplicate` / `ignored` / `out_of_order`), `note`.

### `GET /api/scopes/:id`

`200` → `{ scope, breakdown, acceptance, history, attempts, amountFormatted }`

| field | content |
| --- | --- |
| `scope` | the scope version row, including `hash`, `status`, `lines`, `exclusions`, `amountMinor`, `revisionLimit` |
| `breakdown` | buyer-facing line rows built from **catalog** data only (`priceBreakdown`), never from model text |
| `acceptance` | the stored acceptance, or `null` |
| `history` | all versions for the same brief |
| `attempts` | payment attempts for this scope: `state`, `providerStatus`, `captureId`, `paypalOrderId`, `expectedAmountMinor`, `scopeHash`, `approvalUrl`, `updatedAt`, `lastError` |

`409 scope_not_found` when the id does not exist (domain error codes are mapped to 409 by `errorResponse`).

## Workflow routes

### `POST /api/briefs`

Body (`BriefSubmission`): `{ "text": string (20–8000), "submittedBy": string (1–120) }`

Calls Apertus (`swiss-ai/Apertus-v1.5-70B` by default), validates the model output, then creates an immutable version 1 draft with status `draft`.

`201` → `{ brief, scope, breakdown, proposal, extraction, warnings, reusedExisting, amountFormatted }`

`extraction` is the real inference metadata: `{ model, latencyMs, promptTokens, completionTokens, attempts }`.

| status | code | when |
| --- | --- | --- |
| 400 | `invalid_request` | body outside the schema |
| 409 | `invalid_lines` | a model line names an unknown catalog item, a quantity outside `minQty`/`maxQty`, a duplicate item, or a source span that does not match the brief text |
| 502 | `model_http_error`, `model_timeout`, `model_invalid_json`, `model_model_unavailable` | the model call or its validation failed |
| 503 | `model_missing_key` | `CSCS_INFERENCE_API_KEY` is not set |

`reusedExisting: true` means an identical brief (same canonical text hash) already had a live scope version; no duplicate version is created and the existing one is returned.

### `POST /api/scopes/:id/review`

Merchant review (`MerchantReview`): `{ action: "approve" | "edit" | "reject", actor, note (default ""), lines?, exclusions?, revisionLimit? }`

An `approve` or `edit` creates a **new** version whose `parentId` is the reviewed one and marks the parent `superseded`; the amount is recomputed from the catalog. The merchant supplies lines, never prices.

`200` → `{ scope, amountFormatted }`

| status | code |
| --- | --- |
| 409 | `scope_not_found`, `scope_not_draft`, `invalid_review`, `invalid_lines` |

### `POST /api/scopes/:id/accept`

Buyer acceptance (`BuyerAcceptance`): `{ hash (64 hex), actor (1–120), confirmedAmountMinor: integer, confirmedCurrency: "USD" }`

`200` → `{ scope, acceptance, amountFormatted }`. Repeating the same acceptance is idempotent.

| status | code | when |
| --- | --- | --- |
| 409 | `scope_not_found` | unknown id |
| 409 | `scope_not_awaiting_buyer` | version is a draft, rejected or superseded |
| 409 | `hash_mismatch` | the accepted hash is not this version's hash |
| 409 | `amount_mismatch` | the echoed amount is not the stored amount |
| 409 | `currency_mismatch` | the echoed currency is not the stored currency |
| 409 | `already_paid` | this version already has a captured payment |

### `POST /api/scopes/:id/orders`

Body: `{ hash (64 hex), actor (1–120), confirmedAmountMinor: integer, confirmedCurrency: "USD" }`

Records acceptance of that hash, runs the server gate, then creates the PayPal sandbox order from the **stored** scope amount.

`201` → `{ attempt, approvalUrl, reusedExistingOrder, sandbox: true, note }`

- `reusedExistingOrder: true` — an order already exists for this exact hash and was not yet captured; the existing order is returned instead of creating a second one.
- `approvalUrl` — PayPal approval link (`payer-action` relative link) for the buyer; `null` if the provider returned none.

| status | code | when |
| --- | --- | --- |
| 503 | `paypal_not_configured` | no sandbox credentials |
| 404 | `scope_not_found` | unknown scope id |
| 409 | `stale_scope` / `hash_mismatch` | the hash belongs to a superseded version / is not this version's hash |
| 409 | `amount_mismatch` / `currency_mismatch` / `merchant_mismatch` | server-side gate failed |
| 409 | `scope_not_payable`, `not_accepted`, `already_paid` | lifecycle refusal |
| 502 | `paypal_auth_failed`, `paypal_http_error`, `paypal_invalid_response`, `paypal_timeout` | provider failure; nothing was captured |

### `POST /api/scopes/:id/capture`

Body: `{ orderId?: string }` — defaults to the most recent attempt for the scope.

Re-reads the order from PayPal and refuses to capture unless the provider status is `APPROVED` and provider amount/currency match the stored attempt.

`200` → `{ attempt, captured, message, scopeStatus, amountFormatted }`

`captured: true` is set **only** when the provider capture status is `COMPLETED`. Provider statuses map to states as `COMPLETED → captured`, `DECLINED → declined`, `FAILED → failed`, `PENDING → reconcile_required`, anything else → `reconcile_required`.

| status | code | when |
| --- | --- | --- |
| 404 | `scope_not_found`, `attempt_not_found` | no scope, or no PayPal order for it |
| 409 | `stale_scope` | the scope hash changed after the order was created; the attempt is marked `expired` and nothing is captured |
| 502 | `paypal_not_approved`, `paypal_amount_mismatch`, `paypal_currency_mismatch`, `paypal_merchant_mismatch`, `paypal_capture_failed`, `paypal_timeout` | provider refusal, with the real provider status/message in `details` |

### `POST /api/scopes/:id/reconcile`

Body: `{ orderId?: string }`. Explicit status refresh — the MVP has no background process and webhook arrival is not assumed to be instantaneous.

`200` → `{ attempt, providerStatus, changed, source }`. Terminal states (`captured`, `declined`) are never regressed. A capture found at the provider (`captureId` + `COMPLETED`) promotes the attempt and the scope to paid.

### `POST /api/scopes/:id/changes`

Body (`ChangeRequest`): `{ "text": string (5–4000), "requestedBy": string (1–120) }`

Classifies the request with Apertus and, when it adds work, creates a **new draft version** derived from the current lines.

`201` → `{ assessment, deltaAmountMinor, deltaFormatted, supersededPaidVersion, currentScope, history, warnings, extraction }`

- `deltaAmountMinor` is computed **server-side** from the catalog; the value the model returns inside `assessment.deltaAmountMinor` is overwritten before it is returned.
- `supersededPaidVersion: true` reports that a paid version was intentionally left untouched: a paid scope keeps its own receipt and is never re-priced.
- `assessment.changeClass` is one of `no_change`, `clarification`, `in_scope_adjustment`, `new_scope_delta`, with `confident` false when the model's answer could not be classified.

| status | code |
| --- | --- |
| 400 | `invalid_request` |
| 409 | `scope_not_found`, `invalid_lines` |
| 502 | `model_*` |
| 503 | `model_missing_key` |

### `POST /api/webhooks/paypal`

Raw JSON body plus the `paypal-transmission-*` headers. The handler verifies the signature through `POST /v1/notifications/verify-webhook-signature` using `PAYPAL_WEBHOOK_ID` and the untouched request body.

`200` → `{ accepted: true, reason, applied }` — acknowledged (PayPal expects 2xx). `applied` is true only when this event changed local state.
`400` → `{ accepted: false, reason, applied: false }` — signature not verified; the event is stored with `verificationState: "invalid_signature"` for audit and nothing is applied.

Handled `event_type` values:

| event | effect |
| --- | --- |
| `PAYMENT.CAPTURE.COMPLETED` | promotes the attempt to `captured` and the scope to `paid`, but only when the attempt's hash still equals the current scope hash; otherwise recorded as `out_of_order` |
| `CHECKOUT.ORDER.APPROVED` | `created → approved` (approval alone never pays) |
| `PAYMENT.CAPTURE.DENIED` | `declined`, except when the attempt is already `captured`, in which case the terminal state is preserved |
| `PAYMENT.CAPTURE.REFUNDED` | recorded on the receipt; refunds are out of MVP scope |
| anything else | stored with `processedState: "ignored"` for audit |

A repeated `eventId` is a no-op (`accepted: true`, `applied: false`) so redelivery cannot double-apply a payment.

## Trust boundary

| value | who decides | where |
| --- | --- | --- |
| line items and quantities | AI proposes, merchant finalises | `lib/cscs.ts` output → `validateLines` in `lib/pricing.ts` |
| price of a line | merchant catalog only | `lib/catalog.ts`; the AI never sees a price |
| total | server | `computeAmountMinor` |
| scope hash | server | `sha256Hex(canonicalScopePayload(...))` in `lib/scope.ts` |
| acceptance of a specific version | server, from a buyer-supplied hash + echoed amount | `recordAcceptance` |
| amount sent to PayPal | server, from the stored scope | `startCheckout` → `PayPalClient.createOrder` |
| capture or not | PayPal sandbox status only | `captureOrder`; `captured` requires `COMPLETED` |
| webhook authenticity | PayPal verification endpoint | `verifyWebhook` |

What a client may **never** do: choose the total, mutate an accepted or paid version, capture an attempt whose hash no longer matches the current version, or make an unverified webhook change state. Browser-side callback data is never treated as proof of payment.
