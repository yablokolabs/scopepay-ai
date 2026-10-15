# ScopePay durable state

Last checkpoint: October 14, 2026 (Asia/Kolkata). Branch `main`. File state is
authoritative; run `git log` for the current commit — this session's changes are
**not committed yet**.

## Done this session

- Sandbox credentials found by name only in the shared env file
  (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`), verified sandbox-only before use
  (sandbox host 200, live host `401 invalid_client`), copied into the git-ignored
  local `.env`, never printed and never committed.
- **The PayPal half was exercised against real PayPal for the first time.**
  Real sandbox order created (`0SL05738S7262304T`, `CREATED`, `1640.00 USD`),
  duplicate submission reused the same order, reconcile read the order back from
  PayPal, capture refused. Evidence: `docs/proof/PROOF_M2_SANDBOX.md`, driver
  `docs/proof/m2-sandbox-flow.mjs`.
- Two real defects found by running it, each with a reproducing test written
  first, plus `PAYPAL_MERCHANT_ID` wiring and docs. Tests went 95 → 103.
- **M2 completed end to end: a real capture id now exists.** The owner supplied a
  sandbox Personal account created with **country United States**; Moli signed in
  with it, the approval page rendered the real `$1,640.00` purchase, and
  **Complete Purchase** returned `PayerID=PHNZ7DQZSG4DA`. The server then
  reconciled (`providerStatus APPROVED`, read back from PayPal) and captured:
  **capture id `6YS286962F723210Y`, `COMPLETED`, `1640.00 USD`**, scope `paid`.
  Independently confirmed on the seller side: the sandbox business wallet shows
  `Test Store −$1,640.00  Oct 14 · Payment`. The "end-to-end sandbox receipt with
  an actual capture identifier" acceptance criterion is therefore **met**.
  Evidence: `docs/proof/PROOF_M2_SANDBOX.md` §8 and §8.1–§8.3.
- **Webhook signature verification proven against PayPal's own verifier.** The
  app's client id/secret register a webhook over the API, but PayPal validates the
  URL and refuses `https://localhost:…` with `400 VALIDATION_ERROR "url Not a
  valid webhook URL"`. With an ephemeral cloudflared tunnel in front of the API,
  the webhook was registered and PayPal's event simulator delivered a real signed
  event (`WH-7Y7254563A4550640-11V2185806837105M`), which our server stored as
  `verified`; a forged `paypal-transmission-sig` to the same public endpoint was
  answered `400` and stored as `invalid_signature`. Evidence:
  `docs/proof/PROOF_M2_SANDBOX.md` §9, driver `docs/proof/m2-webhook-proof.mjs`.
  The webhook was deleted again and the tunnel closed afterwards.
- A third live defect (the buyer's return URL 404) found by that same run, with
  tests written first. Tests went 103 → 109.
- **Architecture diagram produced and embedded.** `docs/architecture.html` (type
  Architecture, size preset `doc-inline`) built with `diagram-design` at pinned
  revision `11b08ea`, in the project's documented palette (ivory paper,
  midnight-plum ink, teal accent) rather than the skill's shipped defaults.
  Exported to `docs/architecture.svg` (packaged `export_svg.py`) and
  `docs/architecture.png` (1920x1120, via `videos/scripts/export-diagram.mjs`). The skill's own checkers pass:
  `self_check.py` OK, `verify-geometry.py` 0 findings. The README now embeds the
  PNG. Details and deviations: `docs/TOOLING_STATUS.md`.
- **Video tooling installed, and its render pipeline proven by running it.**
  `videowright@0.1.1` is installed in the `videos/` sub-folder its own install
  doc requires (and `docs/MEDIA_WORKFLOWS.md` prescribes), with its dev toolchain
  pinned from its core package, both skill symlinks created, and its instruction
  block added to `AGENTS.md` as a marked region — 11 insertions, 0 deletions, so
  all five ScopePay rules are intact. With the owner's authorization `ffmpeg` and
  Playwright's Chromium libraries were installed over `sudo apt` after
  `npx playwright install` failed host validation twice.  Both halves then ran for real: Chromium `156.0.8078.4` launched and wrote a
  23518-byte screenshot, and ffmpeg encoded real H.264 (`320x240`, `1.000000`s,
  verified with `ffprobe`).
- **The first real MP4 was then exported, after clearing three obstacles that
  each stopped the render.** (a) An upstream packaging bug: videowright 0.1.1
  publishes only `dist`, `skill` and `src/cli/entry`, yet two of those published
  entry files import the package root as `src/index.ts`, which is never shipped —
  so `render` died with `Failed to resolve import "../../index.js"` and the page
  never signalled render-ready. Fixed reproducibly by
  `videos/scripts/patch-videowright.mjs`, wired as a `postinstall` hook so a fresh
  `npm install` reproduces a working tree, and asserted to resolve before writing.
  (b) The scaffolded segments sat in `videos/<name>/segments/`, which Videowright
  never scans — segments are only discovered from
  `<project-root>/segments/<folder>/index.ts` — so the timeline named a segment
  that did not exist; they moved into the shared library. (c) That timeline also
  imported `styles/editorial-mono/tokens.css`, the style I had since renamed to
  `scopepay`.
- **`videowright render toolchain_smoke --audio-track none` produced a real MP4:**
  210 frames, 7.0s, 1920x1080 h264 (`ffprobe`), frames extracted at 0.05s, 1.0s,
  3.0s and 6.5s all distinct, average frame colour `f9f5ef` against the ivory
  token `#faf6ee`.  That video is a two-segment toolchain smoke test, not the demo. Open item:
  3 `npm audit`
  vulnerabilities (1 moderate, 2 critical) in `videos/`, not auto-fixed because
  `npm audit fix --force` would rewrite the pinned ranges.
- **The M2 demo video now exists as a silent draft.** Seven real 1920x1080 screens
  of the running app were captured by `videos/scripts/capture-app.mjs` (driven
  through the app's own routes against the live dev server, reading the recorded
  scope out of the app's store, so the receipt screen carries the real capture id).
  Each capture records the page text it showed and the script refuses to finish if
  two screens render identical content. Six segments were then built in the shared
  library (`segments/scopepay-*`) plus `videos/m2_sandbox_demo/timeline.ts`, and
  `videowright render m2_sandbox_demo --audio-track none` produced
  `videos/videos/m2_sandbox_demo/draft-silent.mp4`: **4500 frames, 150.0s,
  1920x1080 h264**. It is verified, not eyeballed — `videos/scripts/check-export.mjs`
  decodes sampled frames and measures them: nine sampled beats all carry ink
  (1.48%-5.84%), the 8px border ring is paper on every one (nothing clipped), the
  teal accent stays under 0.1% of a frame, and no two sampled frames are identical;
  a second pass confirmed the three captured screens are really in their beat frames
  (a ~1660x600px framed rectangle each) while the title and gate beats have none.
- **Captions were built, and they caught a pacing defect.**
  `videos/scripts/build-captions.mjs` imports each segment module for its real
  `advances` and `voiceover` (with `videos/scripts/asset-stub-hooks.mjs` stubbing
  the `.png`/`.css` specifiers Node cannot load) and derives one cue per caption-sized
  line group. Its first run reported that **four of five beats were too short for
  their own narration** — the cut was 98s against a 90-120s target, and cues had to
  be squeezed to 21.5 characters/second. Sized at ~14 characters per second plus a
  holding beat, the beats now fit and the cut is **150s**, with 27 cues at exactly
  14.0 characters/second worst case and two lines maximum. `captions.json` records
  that these are provisional: they derive from `advances`, not from audio. The frame
  checker also had to be corrected: it first failed on a beat that holds a still
  visual while narration runs, so identical frames are now only an error when they
  come from *different* scenes.
- **The architecture diagram is now in the cut** as its own beat
  (`segments/scopepay-architecture`, placed after the gate), from
  `docs/architecture.png` copied to `videos/media/architecture.png` — `object-fit:
  contain`, so the 1920x1120 diagram is shown whole rather than cropped.
- **The cut is now narrated.** Voiceover `v1` is Alice (premade British; the free
  API tier blocks library voices and Voice Design): 138.2s, every spoken word
  matched the narration. Segment timing and caption cues come from its word
  timestamps. `videos/videos/m2_sandbox_demo/demo.mp4`: 139.67s, AAC audio,
  `check-export.mjs` passing. The architecture beat's false "planned components"
  claim was removed, and the video's fonts are now bundled (they fell back to
  DejaVu and Times before).
- `npm run typecheck` clean, `npm test` **109 passing** across 6 suites,
  `npm run build` clean.

## Defects found and fixed (all had a reproducing test before the fix)

Earlier session:

1. Unknown scope answered 409 instead of 404.
2. Duplicate checkout could never reuse its existing sandbox order.
3. Capture trusted the URL's scope instead of the order's owning version, and
   could persist `captured` after `markPaid` failed.
4. Deterministic scope checks ran after the credentials gate.
5. Change-request quotes resolved against the brief instead of the change text.
6. Merging a change could exceed a catalog maximum and fail the whole request.
7. A change with no catalog line created a duplicate version claiming a zero delta.

This session, found only by calling the real provider:

8. **`Paypal-Request-Id` exceeded PayPal's limit.** The local key
   `<prefix>:<scope-id>:<hash>` is 116–122 characters. Measured: 108 accepted,
   109+ → `HTTP 500 INTERNAL_SERVICE_ERROR`. Fixed with a deterministic
   ≤38-character projection (`requestIdFor`) in `lib/paypal.ts`, applied to both
   create and capture.
9. **The capture payee check compared PayPal's merchant id against our own
   catalog label**, so every real capture would have failed
   `paypal_merchant_mismatch`. Fixed with the `PAYPAL_MERCHANT_ID` setting; unset
   now means "unverified", not "mismatch". The API test fixture now reports a
   payee id distinct from the catalog label, which is what the real provider does
   — the old fixture agreed with the expectation by construction and could not
   have caught this.
10. **Approving the order returned the buyer to a 404.** `PUBLIC_BASE_URL` was
    unset, so the PayPal return/cancel URLs defaulted to the API process's own
    origin — which serves only `/health` and `/api/*`. The client owns
    `/checkout/return` (reconcile → capture → receipt), so the buyer's return
    could never have worked, and the capture only succeeded because it was driven
    through the API instead. Measured: client origin `200`, API origin `404` on
    both paths. Fixed in the new `server/config.ts` (`resolvePublicBaseUrl()`):
    a configured value still wins, the unset default is now the local client
    origin, and startup prints the value in use and warns when it cannot work.
    Tests: `tests/api/config.test.ts` plus an order-body assertion in
    `tests/api/app.test.ts`; with the old default restored, 2 tests fail.

## Open blockers

- **Webhook verification is proven, but no signed event has *applied* state.** A
  simulated event carries PayPal-generated resource ids, so it matches no local
  attempt and is stored as `verified`/`ignored`. Reconciliation on demand is what
  refreshed the real capture, not a webhook.
- **Redelivery of a real event could not be exercised:** PayPal's
  `POST /v1/notifications/webhooks-events/:id/resend` returned **404** for a
  simulated event, so duplicate handling stays unit-test-only.
- **Timeout and decline paths** have not been exercised against the provider.
- **Sites/Vinext tooling is not installed on this host** — Vite + React with a
  Hono server, D1 written but only unit-checked. Deviation from
  `PROJECT_BUILD.md` remains unresolved.
- **Demo video is a draft, not a deliverable.** The narrated cut exists
  (`demo.mp4`); in its architecture beat the diagram's arrow and legend labels
  are about 8px at 1080p. ElevenLabs quota: 2892 characters left, resets
  2026-11-12. The public YouTube upload is external publication and remains
  unauthorized.
- Extraction evaluation over the 20 frozen briefs not measured.
- `LICENSE` currently MIT, chosen to satisfy the public-licensed-source
  requirement — the owner has not confirmed the license choice.
- Tooling: Hindsight `scopepay-ai` on port 8888 **was** reachable this session
  and was recalled from; `context-mode`, nori `senior-swe`, headroom and the
  nori/headroom/ponytail/adhd skill activations remain open. See
  `docs/TOOLING_STATUS.md`.

## Next action

Nothing is blocked on ScopePay code. The remaining work is the unmeasured items:

1. **Extraction evaluation** over the 20 frozen briefs (`docs/EVALUATION.md`),
   which is the last unmeasured milestone criterion (M1/M3).
2. **M4 demo video** — the narrated cut renders (`demo.mp4`, 139.7s) with captions
   timed from the narration. What remains: diagram legibility in the architecture
   beat, and exporting the final MP4 and captions to `docs/media/`.
3. Optional, and only with the owner's say-so: a signed event that *applies*
   state. Refunding the captured sandbox payment would emit a real
   `PAYMENT.CAPTURE.REFUNDED` whose resource ids do match the local attempt — but
   that moves the money back on the record that is currently the M2 receipt, so it
   is not done unasked.

Re-running the payment half is unnecessary: the capture id is recorded. If it is
ever repeated, order `0SL05738S7262304T` is now `COMPLETED` on a `paid` scope, so
a fresh run needs a new scope version and another buyer approval.

- [x] M0 access/contracts/scaffold
- [ ] M1 scope/pricing/review — implemented and live-tested; evaluation pending
- [x] M2 real sandbox checkout/reconciliation — **order, idempotency,
      reconciliation, buyer approval and capture all proven live; real capture id
      `6YS286962F723210Y`**
- [ ] M3 change flow/evaluation/adversarial tests — change flow done, evaluation pending
- [ ] M4 diagrams/video/submission materials — architecture diagram done and
      embedded; narrated demo rendered (`demo.mp4`); no public YouTube
      upload

Checkpoint format and rules: see `docs/SESSION_TOOLING.md`. No secrets, no buyer
passwords, no footer.
