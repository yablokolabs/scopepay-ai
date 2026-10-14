# ScopePay durable state

Last checkpoint: October 13, 2026 (Asia/Kolkata). Branch `main`, public repo
`yablokolabs/scopepay-ai`. File state is authoritative; run `git log` for the
current commit.

## Done this session

- M0 scaffold: public repository created and pushed (three commits so far).
- M0 provider access verified live: CSCS `/models` 200, `swiss-ai/Apertus-v1.5-70B`
  present, `/chat/completions` 200. Credential discovered by name only
  (`CSCS_INFERENCE_API_KEY`) from the shared env file; value never printed,
  copied into a git-ignored local `.env`, never committed.
- M0/M1 domain core: catalog-driven integer-cent pricing, immutable hash-addressed
  scope versions, buyer acceptance bound to hash + amount + currency, stale-scope
  rejection, idempotent duplicate submission, change requests that always create a
  new version and never rewrite a paid one.
- M1 PayPal sandbox client and webhook verification, implemented and
  mock-tested. **Not exercised against PayPal: no sandbox credentials exist.**
- Client UI: brief intake, merchant review, buyer approval with confirmation
  controls, sandbox receipt with reconciliation, change request, integration
  status page. No footer on any page; `SANDBOX` labels on every payment surface.
- Verification: `npm run typecheck` clean, `npm test` 95 tests passing across
  domain, API-route and store suites, `npm run build` clean. Live smoke test with
  real Apertus recorded in `docs/proof/SMOKE_TEST_M0.md`.
- M4 architecture diagram: `docs/architecture.html` built with diagram-design at
  `11b08ea`, exported to `docs/architecture.svg` and `docs/architecture.png`
  (1920x1120, `videos/scripts/export-diagram.mjs`), embedded in the README.
  `self_check.py` OK, `verify-geometry.py` 0 findings, `check-diagram.mjs` OK.
- M4 demo video: narrated demo `videos/videos/m2_sandbox_demo/demo.mp4`
  (139.7s). Voice is Alice (premade British; the free API tier blocks library
  voices and Voice Design). Segment timing and captions come from the narration's
  word timestamps. The public YouTube upload remains unauthorized.

## Defects found and fixed (all had a reproducing test before the fix)

1. Unknown scope answered 409 instead of 404.
2. Duplicate checkout could never reuse its existing sandbox order (acceptance ran
   first and rejected the second click).
3. Capture trusted the URL's scope instead of the order's owning version, and could
   persist `captured` after `markPaid` failed.
4. Deterministic scope checks ran after the credentials gate, so a stale request was
   answered as "not configured".
5. Change-request quotes resolved against the brief instead of the change text.
6. Merging a change could exceed a catalog maximum and fail the whole request.
7. A change with no catalog line created a duplicate version claiming a zero delta.

## Open blockers

- **PayPal sandbox credentials** (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
  `PAYPAL_WEBHOOK_ID`). Without them the sandbox order → approval → capture →
  receipt path cannot be proven. Needs the owner to set them on the server, never
  in chat, source, screenshots or the video.
- **Sites/Vinext tooling is not installed on this host.** The build uses Vite +
  React with a Hono server, and D1 support is written but only unit-checked. This
  deviation from `PROJECT_BUILD.md` is unresolved.
- Extraction evaluation over the 20 frozen briefs not measured.
- `LICENSE` currently MIT, chosen to satisfy the public-licensed-source
  requirement — the owner has not confirmed the license choice.
- Tooling status: Hindsight bank `scopepay-ai` on port 8888 not reachable from
  this session, so no memory writes happened; `docs/TOOLING_STATUS.md` and the
  nori/headroom/ponytail/adhd skill activations remain open.

## Next action

Set PayPal sandbox credentials server-side, then run the real order → approval →
capture → receipt path and record it in `docs/proof/`.

- [x] M0 access/contracts/scaffold
- [ ] M1 scope/pricing/review — implemented and live-tested; evaluation pending
- [ ] M2 real sandbox checkout/reconciliation — blocked on credentials
- [ ] M3 change flow/evaluation/adversarial tests — change flow done, evaluation pending
- [ ] M4 diagrams/video/submission materials — diagram done and embedded;
      narrated demo draft rendered; no public upload

Checkpoint format and rules: see `docs/SESSION_TOOLING.md`. No secrets, no buyer
passwords, no footer.
