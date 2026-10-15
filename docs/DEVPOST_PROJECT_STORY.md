## Inspiration
Freelancer briefs often leave deliverables, exclusions and revisions unclear before anyone pays. ScopePay ties a payment to one reviewed version of the scope, so both sides agree on the work before money moves. Customer validation is still pending.

## What it does
A client brief goes in as untrusted text. An AI model proposes which catalog items are in scope, with evidence spans and open questions, but never a price. The server prices the scope from a fixed catalog in integer cents. The merchant reviews it, and the result is an immutable version sealed with a sha256 hash. The buyer accepts that exact hash and amount, and pays for it through PayPal sandbox checkout. A later change never rewrites a paid version: the server prices the difference and creates a new version. There is no escrow, and the AI cannot move money.

## How ScopePay meets the technology requirement
**PayPal developer platform (sandbox only):**
- **OAuth 2.0 token API** (`POST /v1/oauth2/token`): gets the server's access token with sandbox app credentials.
- **Orders API v2**: `POST /v2/checkout/orders` creates the order for the exact accepted amount, with a deterministic `Paypal-Request-Id` for idempotency. `GET /v2/checkout/orders/:id` reconciles state, and `POST /v2/checkout/orders/:id/capture` captures it. The buyer approves on PayPal's own approval page. A capture counts only when PayPal reports `COMPLETED`.
- **Webhooks API**: `POST /api/webhooks/paypal` receives events. Every event is checked through `POST /v1/notifications/verify-webhook-signature` before it is used. During testing the webhook was registered with `POST /v1/notifications/webhooks` and exercised with `POST /v1/notifications/simulate-event`.
- **Sandbox accounts**: a sandbox merchant and a sandbox buyer. A real sandbox capture completed: `6YS286962F723210Y`, `1640.00 USD`.

**AI model:**
- **Apertus 1.5 70B** (`swiss-ai/Apertus-v1.5-70B`), served by **CSCS inference** through its OpenAI-compatible `/chat/completions` API. It has two jobs: turn a brief into catalog-backed scope lines with evidence spans and ambiguities, and classify a change request (no change, clarification, in-scope adjustment, or new scope). Zod schemas validate every answer. The model never sets a price and never approves a payment.

## How we built it
TypeScript throughout: a Vite + React client, a Hono server, and Zod at every untrusted boundary. A deterministic server gate checks status, merchant, hash, amount and currency before any PayPal call. The architecture and payment-flow diagrams were built with diagram-design. The demo video was built with Videowright, with ElevenLabs narration.

## Challenges we ran into
The live sandbox run found three defects that mocked tests had missed. Each was fixed with a test written first:
- The idempotency key was longer than PayPal accepts. PayPal answered HTTP 500 at 109 characters and above, so the key is now a deterministic projection of 38 characters or fewer.
- The payee check compared PayPal's merchant id with our own catalog label, so every real capture would have failed.
- The return URL pointed at the API process, so a buyer who approved the payment landed on a 404.

## Accomplishments that we're proud of
- A real PayPal sandbox capture, recorded with its capture id in `docs/proof/PROOF_M2_SANDBOX.md`.
- Live Apertus extraction, recorded in `docs/proof/`.
- 109 automated tests.
- A model that has no authority over money: every amount comes from the server's catalog.

## What we learned
A mocked test agrees with your own assumptions; only the real provider shows where those assumptions are wrong. We record failures next to successes.

## What's next for ScopePay
- Measure extraction quality over the 20 frozen briefs.
- Prove that a real signed webhook applies state; timeouts and declines are still untested.
- Publish the demo video.

Production readiness remains future work.
