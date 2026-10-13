# ScopePay implementation specification

## Problem, differentiation and judging
Initial user: solo designers delivering a fixed-price small website package. Buyer: their client. Problem hypothesis: conversational briefs omit exclusions, revision limits and deliverables, making payment expectations unclear. Interview consenting freelancers before claiming validation.

Workflow: AI structures a brief against a merchant-defined service catalog → freelancer reviews missing information and price → client accepts immutable scope → PayPal sandbox checkout → reconciled receipt → later changes create a new version and proposed delta, never silently change a paid order. Scope hashing detects changes; it is not legal certification.

Technical Implementation: real PayPal order lifecycle, verified webhooks/reconciliation, validated Apertus extraction and stale-version prevention. Design: one understandable scope-to-payment experience. Impact: observe errors and time in consented trials. Innovation: version-bound checkout with explicit exclusions and change comparisons. Presentation: genuine end-to-end sandbox demo. Weights are not specified in the attachment. Best Use of PayPal + AI and Agentic Commerce are plausible categories, never promised awards. Optional sponsors are unnecessary unless genuinely useful.

## MVP boundary and architecture
One sandbox merchant, one fixed-price design catalog, one currency (USD), synthetic briefs, one client order at a time. No marketplace, payouts, subscriptions, FX, escrow, automatic dispute handling, autonomous refunds or live sales. Milestones are scope descriptions only, not payment escrow stages.

Sites Vinext/React TypeScript starter; server routes; Zod runtime schemas; D1 for durable scope/payment state; unit and browser tests. Confirm actual current framework/PayPal documentation before implementing. No filesystem SQLite, raw TCP database or persistent background process in Sites Worker runtime. Alternative hosting is allowed if documented/tested and authorized.

```text
app/{brief,scope,checkout,receipt,changes}
app/api/{scope,accept,orders,capture,webhooks,reconcile}
lib/{schemas,scope,pricing,paypal,cscs,persistence}
fixtures/{briefs,evaluation}
tests/{domain,api,e2e}
docs/{PROGRESS,API_CONTRACT,EVALUATION,DEPLOYMENT,MEDIA_WORKFLOWS}.md
videos/                    # separate Videowright project
```

## AI contract and truthful pricing
CSCS base https://api.inference.cscs.ch/v1; model swiss-ai/Apertus-v1.5-70B, confirm /models then small /chat/completions test. No silent downgrade. Read required credentials from ~/.hermes/.env using a parser, names-only discovery, no source/copy/dump. Hosted runtime receives secrets via Sites settings; cannot read local home files. Sandbox PayPal keys require separate setup. Exact env names remain unconfirmed; document names only in .env.example.

Catalog contains explicit service IDs, unit prices in integer cents, deliverable templates and allowed quantities. AI extracts desired items, evidence spans, ambiguities, exclusions and proposed change class. Server checks IDs/quantities against catalog and computes price. Unknown requests need clarification; never guess work complexity, tax or market prices. Implement no tax/shipping in initial service demo and make that assumption visible. Merchant reviews all proposals. Model output is application-validated JSON; schema-enforced generation/tool support is not assumed.

Data: Brief(id,textHash,canonicalText); ScopeVersion(id,parentId,deliverables,exclusions,revisionLimit,catalogVersion,amountMinor,currency,sourceSpans,hash,status); Acceptance(scopeId,hash,actor,time); PaymentAttempt(scopeId,hash,expectedAmount,expectedCurrency,merchantId,requestKey,paypalOrderId,captureId,state); Event(eventId,verificationState,resourceId,receivedAt); Review(action,actor,revision,note,time). Quotes derive from exact text spans; invalid references fail review. Immutable versions; accepted/paid versions never mutate.

## Payment lifecycle
Before creating an order require merchant-finalized scope and buyer acceptance of its hash. Server creates the sandbox order from authoritative amount/currency, not browser or AI values. Associate an opaque scope reference; do not send private brief text to PayPal. Explicit buyer approval uses official supported checkout flow. Server capture requires matching scope/order ownership and current approved state. Browser onApprove is not proof of captured payment.

Use documented PayPal idempotency support and local unique attempt keys; verify supported header semantics/retention. Persist provider ID before subsequent state transitions where possible. On timeouts reconcile with provider instead of creating a second purchase. Validate returned merchant, amount/currency, order/capture relationship and actual status. Pending remains pending; declined remains declined. Surface errors without secrets.

Verified HTTPS webhook updates support reconciliation; never trust unauthenticated callbacks. Verify signature using official documented method, match subscribed app/webhook ID and related order/capture, and deduplicate event IDs. Handle late/out-of-order delivery without regressing terminal status. Store verified event before acknowledging durable processing. Scheduled/background processes are not required for MVP: explicit status refresh performs reconciliation; hosted scheduled work only if supported/configured. Avoid claiming webhook arrival is guaranteed instantaneously.

Concurrency: stale scope returns conflict before order creation. Price change requires new scope acceptance. Already-created unpaid stale orders cannot silently substitute a newer amount; expire/abandon application attempt and create a new approved version flow under documented PayPal behavior. Paid scope changes become a new proposal; no automatic extra charge. Refunds are out of MVP; never show a working refund button without verified implementation.

## UX and consent
Brief input → AI clarification → freelancer review → client scope summary → explicit approve and sandbox checkout → reconciled receipt → optional change request. Include pricing line items, exclusions, exact version, SANDBOX warning, currency, and explicit approval near action controls. Fully keyboard accessible and clear failure/loading/empty states. Do not pretend test payments are real sales. No fake customers, payout claims or sponsor badges. No footer on app pages/reports/video. PayPal-required checkout branding must remain compliant.

## Tests and evaluation
Freeze 20 synthetic briefs and 10 change requests: complete specs, ambiguity, budget cap, unknown item, malicious instruction, changing price, duplicate requests and stale version. Gold label catalog items/spans/clarification before tuning. Compare merchant catalog rules alone versus genuine Apertus extraction; measure per-field extraction precision/recall, unresolved ambiguity detection, span validity, requests/latency/token usage. Report counts/failures; no toy benchmark generalization or invented cost savings.

Payment tests: real sandbox create → buyer approve → server capture → receipt. Server amount tampering, unauthorized order IDs, wrong currency/merchant, duplicate capture, timeout reconciliation, webhook invalid signature/duplicates/order reversal and concurrent scope edits. Local mocked failure tests are labeled mocks and do not prove real PayPal errors. Never send real funds to test.

Acceptance: end-to-end sandbox receipt with actual capture identifier; no stale scope payment; idempotent duplicate submission; verified webhook/reconciliation traces; invalid model choices rejected; quotes resolve; no secrets; all no-footer routes inspected; fresh reproducible run. Do not claim acceptance targets as already achieved.

## Milestones and proof
Estimate 45–65 focused engineering hours. M0 4–6h: sandbox/provider access, contracts, Sites scaffold. M1 10–14h: extraction, catalog pricing, immutable review. M2 12–16h: sandbox checkout and reconciliation. M3 8–12h: change flow, UX, adversarial tests/evaluation. M4 11–17h: fresh run, diagram, video, license and submission materials. Internal core October 29, evidence November 5, final kit November 9. Deadline from attachment November 12 at 20:00 UTC / November 13 at 01:30 IST.

Record frozen commit, dependency locks, sanitized request outcomes, dataset hashes, raw evaluation results, screenshots and actual demo. No sandbox secrets, buyer account password or webhook credentials in public repo/video. Judges may use their own sandbox account with complete setup instructions; hosted judge flow must avoid publishing login passwords in source. Document how sandbox users access the demo securely.

Pilot: five consenting freelancers review deidentified sample briefs, measure omissions and review effort, never use prototype for real payment. Production rollout requires payments/security/privacy/legal review and supported business account/features; sandbox success is not production readiness. No legal interpretation of agreements.
