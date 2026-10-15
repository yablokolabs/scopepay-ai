# M2 live PayPal sandbox evidence

Date: October 14, 2026 (Asia/Kolkata). Host: build VM. Branch: `main`.

This is the first time the payment half was exercised against PayPal. Everything
below was produced by the commands shown, against the **real**
`https://api-m.sandbox.paypal.com` host, with the sandbox REST app credentials
held only by the server process. No credential, access token or buyer password
appears in this file; order ids, scope ids, hashes and amounts are not secrets.

## What was run

```bash
SCOPEPAY_STORE=file PORT=8790 npm run start   # one shell
node docs/proof/m2-sandbox-flow.mjs           # another
```

`docs/proof/m2-sandbox-flow.mjs` drives the public HTTP API only. It reads no
credential and prints no credential. It is **resumable**: the same brief text is
deduplicated by hash, so a second run continues the version the first run
produced, skips acceptance and order creation when an order already exists for
that hash, and goes straight to reconciliation and capture. Re-running it after
the buyer approves is how the capture id in §8 was obtained, in a single run
against the same scope version the earlier run had created.

## 1. Credentials are sandbox-only (verified before use)

| Host | `POST /v1/oauth2/token` |
| --- | --- |
| `https://api-m.sandbox.paypal.com` | **200** with an access token |
| `https://api-m.paypal.com` (live) | **401** `invalid_client` |

The live host rejects these credentials, which is what makes it safe to use them
here. `lib/paypal.ts` also refuses any `env` other than `sandbox`.

## 2. Server readiness

```
GET /health  -> 200 {"ok":true,"store":"ready","paypalConfigured":true,"modelConfigured":true,"sandbox":true}
GET /api/config -> 200 merchant sandbox-merchant-1, currency USD, catalog catalog-2026-10-13,
                        taxIncluded false, shippingIncluded true, paypalConfigured true
```

Startup log:

```
CSCS Apertus extraction: configured
PayPal sandbox: configured
PayPal payee merchant id: configured
```

## 3. End-to-end run — real order created by PayPal

Synthetic brief (bakery site, five pages, copy tidy-up, mobile) through real
Apertus extraction, merchant review, then buyer acceptance:

```
POST /api/briefs              -> 201  v1 draft  1640.00 USD  model swiss-ai/Apertus-v1.5-70B 9499ms
POST /api/scopes/:id/review   -> 200  v2 awaiting_buyer  1640.00 USD
                                      hash 7199c4f7565ba92dbacbb259db2e01dda8fd725c602cc0bf469e62a372d5b0b5
POST /api/scopes/:id/accept   -> 200  accepted (hash + amount + currency echoed by the buyer)
POST /api/scopes/:id/orders   -> 201  order 0SL05738S7262304T  providerStatus CREATED
POST /api/scopes/:id/orders   -> 201  reusedExistingOrder true, same order id  (no second purchase)
POST /api/scopes/:id/reconcile-> 200  source "PayPal sandbox GET /v2/checkout/orders"  providerStatus CREATED
POST /api/scopes/:id/capture  -> 502  paypal_not_approved (PayPal reports "CREATED")
GET  /api/scopes/:id          -> 200  scopeStatus order_created, captureId null
```

The amount on the order is the server-computed catalog total, not a
client-supplied value: `164000` minor units → `1640.00 USD`.

## 4. What PayPal itself reports for that order

Read back directly from PayPal with the same server-side credentials:

```
GET /v2/checkout/orders/0SL05738S7262304T -> 200
  status              CREATED
  intent              CAPTURE
  amount              1640.00 USD          (matches the scope amount exactly)
  custom_id           scope-ac89ae7f-a243-459e-a28f-ea92b1de157c
  reference_id        7199c4f7565ba92d… (full 64-character scope version hash)
  payee merchant_id   H6EBGK2NMDSXC
  brief text present  no
```

The order carries the opaque scope reference and the version hash, never the
brief text.

## 5. PayPal refuses to capture an unapproved order

```
POST /v2/checkout/orders/0SL05738S7262304T/capture -> 422
  name UNPROCESSABLE_ENTITY
  issue ORDER_NOT_APPROVED
```

Two independent gates are therefore demonstrated: ScopePay's own pre-capture
guard (`paypal_not_approved`, our client read the order back and saw `CREATED`)
and PayPal's own refusal. No money moved, and no local receipt claims otherwise —
at this stage the scope stays `order_created` with `captureId: null`. (This is
where that first run stopped. §8 records the same order being approved by a buyer
and captured.)

## 6. Two defects found by running it, with tests written first

### 6.1 `Paypal-Request-Id` was longer than PayPal accepts (HTTP 500)

`server/services/checkout.ts` builds the local idempotency key
`<prefix>:<scope-id>:<version-hash>`, which is 116–122 characters. That value was
sent verbatim as `Paypal-Request-Id`.

Measured against the live sandbox, same body, only the header value changed:

| `Paypal-Request-Id` length | Result |
| --- | --- |
| 108 | **201/200 CREATED** |
| 109, 110, 111, 112, 116 | **500 `INTERNAL_SERVICE_ERROR`** |

PayPal answers an over-long idempotency key with an internal server error rather
than a validation error, so the failure looked like a provider outage. Colon
characters are not the cause (a 100-character value containing colons is
accepted).

Fix: `lib/paypal.ts` exports `PAYPAL_REQUEST_ID_MAX_LENGTH` (38, PayPal's
documented UUID-standard limit — deliberately the documented bound rather than
the observed 108) and `requestIdFor()`, which projects the local key onto a
deterministic value of at most 38 characters. Determinism is the load-bearing
property: a retried create or capture must replay the same key, or PayPal would
start a second purchase. Both the create and the capture call now go through it.

After the fix the same flow created a real order on the first attempt.

### 6.2 The capture payee check compared PayPal's id against our own label

`captureOrder` required the PayPal-reported `purchase_units[].payee.merchant_id`
to equal `CATALOG.merchantId`, i.e. the human-readable label
`sandbox-merchant-1`. PayPal actually reports an opaque account id —
`H6EBGK2NMDSXC` for this sandbox app. Every real capture would therefore have
failed with `paypal_merchant_mismatch`, so the end-to-end receipt could never
have been produced.

The mocked tests could not catch this: the fake transport returned
`payee.merchant_id = CATALOG.merchantId`, so the fixture agreed with the
expectation by construction. The API fixture now reports a **distinct** id, which
is what the real provider does.

Fix: the expectation is the new `PAYPAL_MERCHANT_ID` setting (PayPal's payee id),
threaded through `AppEnv` and `CheckoutDeps`. An unset value is reported as an
**unverified** merchant match rather than treated as a match or a mismatch, so a
missing setting cannot silently pass the check or block a legitimate capture.

## 7. Automated buyer approval was attempted, and blocked (resolved in §8)

The approval is a page-level action, so it was driven headlessly with
**lightpanda 1.1.0-nightly** (CDP server on `127.0.0.1:9222`, `--load-resources
iframe --load-resources stylesheet`) against the real sandbox sign-in page.

| Attempt | Result |
| --- | --- |
| Render `GET /signin` | **works** — the form is in the DOM (`#email`, `#password`, `#btnLogin`, `_csrf`) |
| Fill the form | **works** — values land in the DOM; the password field reports length 8 |
| Click `#btnLogin` | no navigation; PayPal renders *"Sorry, we couldn't confirm it's you"* |
| Raw `POST /signin` with `_csrf` and a real-browser user agent | **HTTP 403**, `datadome` cookie set, captcha markup in the body |

The 403 with a DataDome cookie is PayPal's **bot-detection interstitial**, not a
credential rejection: lightpanda is not a Chromium build and cannot produce the
device fingerprint that check wants. The earlier *"Some of your info isn't
correct"* came from the engine's own mangled form submit, not from PayPal
rejecting the password.

A second engine was then tried, and it settles what the real blocker is.
**Moli 1.1.17** (`~/.local/bin/moli serve --layout --resource`) presents itself
as `Chrome/145.0.0.0` and **does** get through: it rendered the form, filled it,
submitted it, and landed on `https://www.sandbox.paypal.com/mep/dashboard` — a
logged-in sandbox session. No captcha, no device check, no credential error.

Opening the order as that logged-in account then failed, for a reason that has
nothing to do with headless automation:

```text
url   .../checkoutweb/genericError?code=Q0FOTk9UX1BBWV9TRUxG&token=0SL05738S7262304T
text  "You are logging in to the account of the seller for this purchase.
       Please change your login information and try again."
```

`Q0FOTk9UX1BBWV9TRUxG` decodes to **`CANNOT_PAY_SELF`**. The configured account is
an `@business.example.com` **Business/seller** account — the merchant that owns
the sandbox app and is the order's payee (`H6EBGK2NMDSXC`) — and PayPal refuses a
merchant paying itself. Sandbox accounts come in `@business.example.com` and
`@personal.example.com` pairs, and the **buyer** role belongs to the Personal
account.

So the remaining blocker is a missing credential, not tooling: a **Personal**
sandbox account is required, and approval should then be drivable with Moli. No
account credential is recorded here or anywhere else in this repository.

### 7.1 A Personal account from the wrong country is still refused

A Personal buyer account was then supplied, and Moli signed in with it
successfully (landing on `/myaccount/summary` with a `$5,000.00` balance and card
funding sources). Opening the same order produced a different, definitively
currency/country-shaped refusal:

```text
url   .../checkoutweb/genericError?code=VU5TVVBQT1JURURfUEFZRUVfQ1VSUkVOQ1k%3D&token=0SL05738S7262304T
text  "This seller doesn't accept payments in your currency."
```

`VU5TVVBQT1JURURfUEFZRUVfQ1VSUkVOQ1k=` decodes to **`UNSUPPORTED_PAYEE_CURRENCY`**.

Isolating which side is at fault, with order creation against the real API:

| Order currency | Result |
| --- | --- |
| `USD` | **201** — the merchant accepts USD |
| `INR` | **422** `CURRENCY_NOT_SUPPORTED` — the merchant cannot process INR |

So the money side is USD-consistent and ScopePay's USD-only catalog is correct.
The buyer account is the mismatch: it is an **India-based** account — time zone
`(GMT+05:30) Kolkata`, account purpose *Export of Goods / Realisation of export
bills*, and the wallet states *"Manual transfers of funds aren't available right
now. We'll automatically start transferring your funds to your preferred bank
account"*, which is PayPal's receive-only India model. Its primary currency is
USD (USD is absent from the account's "Add a currency" list, and the balance
renders as `$5,000.00`), which is why the failure reads as a currency error.

Configuring this correctly is a PayPal sandbox setting, not a ScopePay change:
the buying account needs a country whose accounts can send this payment (a
United States Personal account is the reliable choice). `docs/DEPLOYMENT.md`
step 2 now records that requirement.

A further Personal account was then supplied, and it is the same India
configuration: Moli signs in (landing on `/myaccount/summary`), but the wallet
lists the **same funding sources** (`YES BANK Checking`, `Visa Credit`), the
profile page reports the same `(GMT+05:30) Kolkata` time zone and *Export of
Goods* account purpose, and opening the order reproduces
`UNSUPPORTED_PAYEE_CURRENCY` exactly. A sandbox account's country is fixed when
the account is created, so this one cannot be corrected in place — a **new**
Personal account created with country United States is required.

### 7.2 The currency is not the variable

Changing the currency cannot work around this. Creating orders across the
merchant's supported range, with the same credentials:

| Order currency | Result |
| --- | --- |
| `USD` | **201** |
| `EUR` | **201** |
| `GBP` | **201** |
| `AUD` | **201** |
| `SGD` | **201** |
| `INR` | **422** `CURRENCY_NOT_SUPPORTED` |

`INR` cannot even be ordered, so an INR-denominated ScopePay build would fail one
step earlier at order creation. And the same signed-in buyer is refused for the
`EUR` order too, with the identical `UNSUPPORTED_PAYEE_CURRENCY` code — a currency
the merchant demonstrably accepts. The refusal therefore belongs to the buying
account, not to the currency, and switching ScopePay away from USD would change
nothing.

A third Personal account was then supplied, this time created with **country
United States**, and the purchase completed. Its evidence is §8.

## 8. Buyer approval and capture — the acceptance criterion is met

A **United States Personal** sandbox account was created by the owner and
supplied; Moli signed in with it and the order was approved on PayPal's own page.
The account's email is deliberately not recorded here or anywhere else in this
repository.

That this was a genuinely different account, not the India-based one again, is
visible in the provider's own pages: the wallet lists different funding sources
(`CREDIT UNION 1 Checking ••••9145`, `Visa Credit ••••0818`, against
`YES BANK Checking ••••21`, `Visa Credit ••••92` for the India account), and the
order no longer produced `UNSUPPORTED_PAYEE_CURRENCY`.

### 8.1 The approval page renders for a real purchase

Opening `https://www.sandbox.paypal.com/checkoutnow?token=0SL05738S7262304T` as
that signed-in buyer:

```text
title     PayPal Checkout
amount    $1,640.00
funding   CREDIT UNION 1 Checking ••••9145   (backup: Visa ••••0818)
controls  $1,640.00 | Add debit or credit card | Complete Purchase
flags     captcha false | signin false | payYourself false
```

No `CANNOT_PAY_SELF`, no `UNSUPPORTED_PAYEE_CURRENCY`, no device-check
interstitial — the amount is the server-computed catalog total, unchanged from
§3.

### 8.2 Approval, and the capture that followed

Clicking **Complete Purchase** returned the browser to the order's `return_url`
with PayPal's own approval proof:

```text
http://localhost:8790/checkout/return?scope=scope-ac89ae7f-a243-459e-a28f-ea92b1de157c
  &token=0SL05738S7262304T&PayerID=PHNZ7DQZSG4DA
```

That return is where the provider puts the buyer after approval, and it also
exposed the third defect found by this run (§10). The capture itself is
server-side and does not depend on the browser:

```
POST /api/scopes/:id/reconcile -> 200  source "PayPal sandbox GET /v2/checkout/orders"
                                       providerStatus APPROVED  changed true
POST /api/scopes/:id/capture   -> 200  captured true
                                       message "Sandbox capture 6YS286962F723210Y completed for 1640.00 USD."
                                       scopeStatus paid
GET  /api/scopes/:id           -> 200  scopeStatus paid  amount 164000 USD
```

Final stored attempt, read back through the API:

```text
paypalOrderId        0SL05738S7262304T
captureId            6YS286962F723210Y
providerStatus       COMPLETED
state                captured
providerAmountMinor  164000     providerCurrency USD   (matches the scope exactly)
scopeHash            7199c4f7565ba92dbacbb259db2e01dda8fd725c602cc0bf469e62a372d5b0b5
lastError            null
```

Driver output:

```text
REAL CAPTURE ID: 6YS286962F723210Y — provider status COMPLETED
```

### 8.3 Confirmed on the seller side, in PayPal's own wallet

The sandbox **business** (seller) account, signed in separately, shows the
payment it received:

```text
Recent activity   Test Store   −$1,640.00   Oct 14 · Payment
```

So the money moved between the two sandbox accounts and the receipt is not a
local claim: it is the same transaction at both ends, and the amount, currency and
capture id agree with what ScopePay stored.

## 9. Real webhook signature verification

A webhook id alone cannot prove anything, because a signature only exists per
*delivery*. This section records what each half actually requires.

### 9.1 The credentials can register a webhook, but not on a local URL

Measured against the real sandbox host with the app's own client id and secret:

| Call | Result |
| --- | --- |
| `POST /v1/oauth2/token` | **200**, token issued |
| `GET /v1/notifications/webhooks` | **200**, none registered |
| `POST /v1/notifications/webhooks` with a `localhost` URL | **400 `VALIDATION_ERROR`** — detail `url Not a valid webhook URL` |

PayPal validates the URL as a publicly reachable HTTPS endpoint, so this machine
cannot be registered directly and PayPal cannot deliver to it. That is the real
blocker, not the id.

### 9.2 A real delivery, verified by PayPal

An HTTPS tunnel (cloudflared quick tunnel, no account) exposed the local API for
the duration of this test, the webhook was registered on it, and PayPal's own
event simulator delivered an event:

```text
POST /v1/notifications/webhooks -> 201
  url     https://<tunnel>.trycloudflare.com/api/webhooks/paypal
  events  PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED,
          PAYMENT.CAPTURE.REFUNDED, CHECKOUT.ORDER.APPROVED
POST /v1/notifications/simulate-event -> 202
  event id WH-7Y7254563A4550640-11V2185806837105M
```

Our server stored the delivery with the signature verified **by PayPal itself**:
`lib/paypal.ts` posts the five `paypal-transmission-*` headers, the cert URL and
the raw body to `POST /v1/notifications/verify-webhook-signature` with the
configured webhook id, and only a `SUCCESS` verdict is accepted.

```text
GET /api/events -> 200
eventId            WH-7Y7254563A4550640-11V2185806837105M
eventType          PAYMENT.CAPTURE.COMPLETED
verificationState  verified
processedState     ignored
note               No matching local payment attempt; recorded for audit only.
```

`ignored` is the correct outcome rather than a failure: a simulated event carries
PayPal-generated resource ids, so it matches no local payment attempt. It is
recorded for audit and changes no money state.

**Open question on this verdict.** PayPal's dashboard documentation says
simulator events are mock events that "cannot be verified". This run used the
API simulator (`/v1/notifications/simulate-event`) against a registered webhook
id, and the verifier answered `SUCCESS`. The two statements conflict, and the run
has not been repeated, so treat the `SUCCESS` side as unconfirmed. The forged
`FAILURE` in §9.3 does not depend on it. A real event for a local order is
the proof that settles it (see §11).

### 9.3 The negative control, against the same public endpoint

A request carrying a signature PayPal never issued — the same five headers with a
forged `paypal-transmission-sig` — posted to the same public URL:

```text
POST https://<tunnel>.trycloudflare.com/api/webhooks/paypal (forged) -> 400
  {"accepted":false,"reason":"Signature not verified: PayPal returned
   verification_status \"FAILURE\".","applied":false}
```

and the event log shows both verdicts side by side:

```text
WH-FORGED-...                          invalid_signature  ignored
WH-7Y7254563A4550640-11V2185806837105M verified           ignored
```

Both verdicts come from PayPal's verifier, so the accept side is not a local
judgement. Reproduce with `docs/proof/m2-webhook-proof.mjs`:
`list` · `create <url>` · `simulate [event-type]` · `forge <url>` · `delete <id>`.

The webhook id and the tunnel hostname are deliberately not recorded here: the id
belongs in the git-ignored `.env` (`PAYPAL_WEBHOOK_ID`) and the tunnel was
ephemeral. The webhook was deleted again after the test, so no dead URL is left
registered on the sandbox app.

## 10. A third defect found by the live run: the buyer was returned to a 404

Approving the order sent the browser to the `return_url` PayPal had been given,
and that URL answered **`404 Not Found`** — `server/services/checkout.ts` built it
from `PUBLIC_BASE_URL`, which was unset and therefore defaulted to this API
process's own origin (`http://localhost:8790`).

The API serves only `/health` and `/api/*`. The route that belongs to that path
lives in the client (`app/src/App.tsx`, `/checkout/return` → reconcile, capture,
receipt), so the buyer's return could never have worked as configured, and the
only reason the capture succeeded is that it was driven through the API instead.

Measured on both origins, same path:

| URL | Result |
| --- | --- |
| `http://localhost:5173/checkout/return?scope=…` (client) | **200**, ScopePay HTML |
| `http://localhost:5173/checkout/cancel?scope=…` (client) | **200**, ScopePay HTML |
| `http://localhost:8790/checkout/return?scope=…` (API) | **404**, `404 Not Found` |
| `http://localhost:8790/checkout/cancel?scope=…` (API) | **404**, `404 Not Found` |

Fix: `server/config.ts` resolves the base URL through `resolvePublicBaseUrl()`.
An explicitly configured value still wins, so a deployment keeps naming its own
client origin; with nothing configured the local client origin is used
(`DEFAULT_APP_ORIGIN`, `http://localhost:5173`), because the API's own origin can
never serve those paths. Startup now prints the value in use and warns when it
cannot work — both when the value is the API process itself and when it is unset:

```text
PayPal return/cancel base: http://localhost:5173
WARNING: PUBLIC_BASE_URL is not set, so PayPal return/cancel URLs use the local client
origin http://localhost:5173. Set it explicitly for any non-local deployment, otherwise
 the buyer is returned to a URL that only resolves on this host.
```

Tests (`tests/api/config.test.ts`, plus an assertion in `tests/api/app.test.ts`
that the order body carries the client-origin return and cancel URLs) were written
first and fail against the old default: with the API origin restored as the
fallback, 2 of them fail, reporting
`expected 'http://localhost:8790' to be 'http://localhost:5173'`.

## 11. Still unproven

- **A webhook that *applies* state.** Signature verification is proven (§9), but
  no genuinely signed event has driven a `captured`/`declined` transition, because
  a simulated event's resource ids match no local attempt. Reconciliation is what
  refreshed the real capture in §8, not a webhook.
- **Redelivery of a real event.** Attempted, and it could not run: PayPal's
  `POST /v1/notifications/webhooks-events/:id/resend` returned **404** for a
  simulated event. Duplicate-event handling therefore remains covered by unit
  tests only, not by a real redelivery.
- **Timeout and decline paths.** Not exercised against the provider.
- Failure behaviour above is real provider behaviour; nothing here is simulated.

## Reproduce

```bash
npm install
cp .env.example .env    # sandbox app credentials + PAYPAL_MERCHANT_ID
npm run check           # typecheck + 109 tests
npm run start           # http://localhost:8790
node docs/proof/m2-sandbox-flow.mjs
```

For §9, additionally expose the API on an HTTPS URL you control for the duration
of the test and register the webhook on it (`docs/proof/m2-webhook-proof.mjs`);
the webhook id goes into the git-ignored `.env` as `PAYPAL_WEBHOOK_ID`, and the
webhook should be deleted again when the tunnel closes.

Steps 1–7 need only the sandbox app credentials. Step 8 additionally needs the
buyer to have approved the order, which requires a sandbox **Personal** account
whose country can send the payment — `docs/DEPLOYMENT.md` step 2 covers creating
one and the two ways an account can look usable and still be refused. Set
`PUBLIC_BASE_URL` to the origin that serves the client (`http://localhost:5173`
for `npm run dev`) so PayPal returns the buyer to the receipt rather than a 404;
see §10.
