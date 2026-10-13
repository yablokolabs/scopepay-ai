# ScopePay evaluation

## What is frozen and implemented

Two synthetic fixture sets are committed and served by `GET /api/fixtures`. All text is invented for evaluation; no real person, company, price or quote is represented. Each brief carries gold labels (`goldCatalogItems`, `goldClarifications`) and each change request carries an `expectedChangeClass`.

`fixtures/briefs.ts` — 20 briefs (`BRIEF_FIXTURES`), by category as authored:

| category | count | what it exercises |
| --- | --- | --- |
| `complete` | 5 | fully specified deliverables, page counts, forms, SEO, handover |
| `ambiguous` | 4 | missing page counts, undefined content ownership, unclear revision expectations |
| `budget_cap` | 3 | a stated ceiling the catalog total can exceed |
| `unknown_item` | 2 | requests outside the merchant catalog (for example booking or payment features) |
| `malicious` | 3 | embedded instructions aimed at the model: a hidden instruction, an invented discount, a request to change the total |
| `stale_version` | 3 | scenarios paired with a superseded scope version |

`fixtures/change-requests.ts` — 10 requests (`CHANGE_FIXTURES`) evaluated against an already accepted scope of one landing page, two content pages and a contact form:

| `kind` | count |
| --- | --- |
| `new_scope_delta` | 5 |
| `in_scope_adjustment` | 1 |
| `clarification` | 2 |
| `no_change` | 2 |

The prompt-injection briefs are treated as data at every layer: the extraction system prompt states that brief text is data and not instructions, the model is never asked for a price, and any instruction-shaped content only ever produces catalog lines or clarification questions.

## Measurements that are PENDING

These are **not** done and must not be reported as results:

- Per-field extraction precision/recall of `swiss-ai/Apertus-v1.5-70B` against the gold labels across the 20 briefs.
- Ambiguity-detection rate, source-span validity rate, and requests/latency/token usage per extraction. (Real per-call metadata — model, latency, prompt and completion tokens, attempts — is returned by the API in `extraction`, but no aggregate run has been recorded.)
- Merchant-catalog-rules-only baseline versus genuine model extraction.
- Any cost saving, time saving, or user-study result. Five consenting freelancers have not been interviewed or observed; the problem hypothesis is unvalidated.

The gold labels are authored expectations, not verified ground truth: they need a merchant's confirmation before any accuracy number is published.

## Test coverage that exists

`npm test` runs the Vitest suites under `tests/domain/`:

| file | covers |
| --- | --- |
| `paypal.test.ts` | sandbox-only host and environment refusal, missing credentials, integer-cent formatting and sub-cent rejection, token caching, auth failure, `Paypal-Request-Id` and approval-link parsing, capture refused unless the order is approved, real capture identifiers, non-completed provider status returned unchanged, provider amount and merchant mismatch, provider-issue reporting on failure, webhook verification SUCCESS/non-SUCCESS/missing headers/non-JSON |
| `scope.test.ts` | draft creation with a catalog-recomputed amount, identical-brief reuse, unknown item and out-of-range quantity rejection, merchant edit producing version 2 that ignores a price attached to lines, non-draft review refusal, rejection path, confirmed-amount mismatch, fabricated hash, stale hash, acceptance idempotency, accepted → order_created → paid walk, tampered checkout amount, double-charge refusal, merchant mismatch, change against a paid scope without superseding it, server-computed delta with quantity merging, no-change/clarification producing no payable version |
| `cscs.test.ts` | canonicalisation and hashing stability, missing-key reporting, no prices sent to the model, source-span validation, dropping invalid lines with warnings, fence-stripped JSON, retry-then-fail, HTTP failure without leaking the key, 404 mapping, timeout, change classification, unrecognised class downgraded, fixture counts, instruction-bearing brief classified as malicious data |
| `store.test.ts` | one behavioural suite run against the memory and file adapters: insert-only scopes, status-lifecycle-only patches, ordering, duplicate request-key rejection, event idempotency and limit, newest brief by hash, copies not references, acceptance round-trip, plus an assertion that the D1 migration contains every table the adapter reads and writes |

**HTTP-level tests exist now.** `tests/api/app.test.ts` covers the route layer (status codes, error mapping, sandbox-order idempotency, stale-scope capture refusal, webhook duplicate handling, and the credential-leak check on `/api/events`). Those tests use a fake PayPal transport: they prove the routing and the money-safety rules, and they do **not** prove real PayPal behaviour.

## Payment failure cases

| case | status |
| --- | --- |
| capture without buyer approval | covered by a mocked provider test |
| duplicate capture of the same order | covered by a mocked provider test (attempt already captured returns the existing receipt) |
| duplicate order submission for one hash | covered by a mocked provider test (existing live attempt reused) |
| amount tampering by the client | covered by a mocked provider test and by the domain gate |
| wrong currency or merchant | covered by a mocked provider test |
| capture declined by the provider | covered by a mocked provider test that asserts the state is never forced to captured |
| webhook with an invalid signature | covered by a mocked provider test; the event is stored unverified |
| duplicate webhook delivery | covered by a mocked provider test and by the store suite |
| stale scope: edit after order creation | covered by a mocked provider test and by the domain suite |
| out-of-order webhook after a terminal state | covered by a mocked provider test for denial-after-capture |
| timeout during order creation or capture | partially covered (the client maps an abort to `timeout`); end-to-end behaviour needs a live sandbox run |
| reconciliation after a lost response | **not yet exercised against the live sandbox** |

Every row above marked "mocked" is a locally fabricated provider response. Mocked tests prove the client's own branching; they do **not** prove how the real PayPal sandbox behaves. The real-sandbox happy path (create → buyer approve → server capture → receipt with the actual capture identifier) and the real-sandbox failure cases are still to be executed and recorded, and are acceptance criteria rather than completed work.
