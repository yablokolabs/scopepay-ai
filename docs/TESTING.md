# Testing ScopePay

**Demo:** https://scopepay.young-disk-9d1c.workers.dev

Everything runs on PayPal's **sandbox**. No real money moves. The AI model is
live (Apertus 1.5 70B on CSCS), so a brief takes about 10 to 15 seconds to
extract.

## What you need

- A browser.
- A **PayPal sandbox buyer** account to approve the payment. The project team
  supplies its email and password in the Devpost testing notes. They are sandbox
  test credentials and work only on `sandbox.paypal.com`.

## Steps

1. **Brief.** Open the demo. Pick a sample brief, or type your own (at least 20
   characters). **Change a few words** if you use a sample: identical text
   returns the scope that text already has, which may already be paid. Click
   **Extract scope with Apertus**.
2. **Merchant review.** The model proposes catalog items with evidence from the
   brief. It never proposes a price: the server prices every line from its
   catalog. You can remove lines. Click **Approve and send to client**. This seals
   an immutable version with a sha256 hash.
3. **Client approval.** Tick the confirmation boxes and click **Approve and
   create sandbox order**. The server checks the version hash, amount, currency
   and merchant before it calls PayPal.
4. **PayPal.** On PayPal's sandbox page, sign in with the sandbox buyer account
   and click **Complete Purchase**.
5. **Receipt.** PayPal returns you to ScopePay, which captures the payment. The
   receipt shows PayPal's real capture id and status `COMPLETED`.
   **Refresh status from PayPal** re-reads the order from PayPal.
6. **Change request (optional).** After payment, describe a change. The model
   classifies it, the server prices the difference, and the result is a new
   version. The paid version is never rewritten or charged again.

## Things to know

- The model routes are limited to 10 requests per minute per IP address. Past
  that you get "Too many model requests"; wait a minute.
- The demo receives PayPal webhooks and checks each signature with PayPal. They
  arrive about 30 seconds after payment and show in `/api/events`.
- Source and proof: https://github.com/yablokolabs/scopepay-ai, in particular
  `docs/proof/PROOF_M2_SANDBOX.md`.
