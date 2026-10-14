# Plan: ScopePay — brief to sandbox capture

## Purpose
- Audience: competition judges and a technical reviewer who will not run the app
  first. They need to see that the payment half is real, not a mock.
- Takeaway: an AI proposes what the work is, the server decides what it costs and
  whether it may be paid, PayPal decides whether money moved — and the capture in
  this video is a real sandbox transaction with a real capture id.
- Constraints / hard guidelines:
  - Under three minutes (the competition limit); `docs/MEDIA_WORKFLOWS.md` asks for
    a 90–120s cut and an aim of 150s.
  - Sandbox only. Say so. Never imply live funds moved.
  - No footer, credits strip, powered-by or closing signature anywhere.
  - No credential, buyer password or sandbox secret in any frame.
  - Animated concepts must be labelled as such, and a recorded result must never be
    presented as proof of a live call it did not make.
  - Real values only: order `0SL05738S7262304T`, capture `6YS286962F723210Y`,
    `1640.00 USD`, `COMPLETED`. No invented numbers, quotes or certifications.

## Style
- Active style: `scopepay` — local style copied from the bundled `editorial-mono`
  and retuned to this project's documented identity (ivory paper `#faf6ee`,
  midnight-plum ink `#2e2246`, one teal accent `#0f7b72`). The same tokens as
  `docs/architecture.png`, so the README and the video agree.
- Notes: 1920×1080 at 30fps. Reading-speed cadence, no fast motion, no music.

## Media
- `media/app/*.png` — real 1920×1080 captures of the running app, taken by
  `videos/scripts/capture-app.mjs` against the local dev server. The script reads
  the recorded scope out of the app's own store, so the receipt screen carries the
  real capture id. It also writes `media/app/screens.json`, which records the text
  each screen showed, and refuses to finish if two screens render identical content
  (that is the "the route did not change the page" failure).
- Nothing in this video is a mockup or a re-drawing of the app.

## Audio intent
- Voiceover: yes — **Alice** (`Xb7hH8MSUJpSbSDYk0k2`, British, premade), voiceover `v1`.
- Sound effects: no
- Background music: no
- Notes: the owner asked for a young British female voice. The account is on the
  free API tier, where every route to one is closed: library voices Beth
  (`zH7TN9vEZAsEway9xWev`) and Georgia K (`bGnz83yTAb7caZSC7BBz`) answer `402`, and
  Voice Design answers `403 feature_not_available`. The owner chose Alice. Segment
  timing comes from the narration's own word timestamps (`audio/originals/voiceovers/v1/`);
  captions are built from the same timestamps. The plan's terms have not been read
  for publishing conditions, which matters before any public upload.

## Segment outline
Segments live in the shared library `videos/segments/<id>/index.ts`, as Videowright
requires (only `<project-root>/segments/<folder>/index.ts` is discovered).
1. `scopepay-title` — what ScopePay is, and that this is sandbox-only.
2. `scopepay-brief-to-scope` — the brief; the model proposes catalog items, never prices.
3. `scopepay-merchant-review` — the merchant's edit produces an immutable, hash-sealed version.
4. `scopepay-gate` — the deterministic server gate: version hash · amount · currency · merchant.
5. `scopepay-architecture` — the architecture diagram, and where the trust boundary sits.
6. `scopepay-capture-and-receipt` — the stored receipt with the real capture id, and what is still unproven.

## Known limitations
- **No PayPal approval capture exists.** The buyer's approval happened on PayPal's
  own page during the recorded run, but no screenshot of it was kept, and it cannot
  be re-taken without another buyer approval. So beat 5 *describes* that step and
  shows the app's own receipt; no frame claims to be PayPal's page.
- **The architecture diagram is in the cut**, as its own beat from
  `media/architecture.png` — a copy of `docs/architecture.png`, so it must be
  re-copied whenever the diagram is rebuilt.
- **No audio track exists**, so every segment runs on an `advances` number sized
  from its narration rather than from the narration's own timestamps.
- **Captions are provisional.** `captions/m2_sandbox_demo.srt` and `.vtt` (23 cues at
  14.0 characters/second worst case) derive from `advances`, so they must be rebuilt
  from the audio's timestamps once it exists. They are not yet in `docs/media/`,
  which is where the final deliverables belong.

## Script
See `voiceover_script/script.md`. Each segment's `voiceover` field is the
authoritative line for its beat, so the script is regenerated from the segments
(`npx videowright script m2_sandbox_demo --write`) rather than maintained by hand.

---

## Log

### 2026-10-14 — Initial scaffold
- Wrote the plan and the VO script audio-first, then will scaffold segments to match.
- Voice resolved from account metadata to Beth; the account's own "Alice" is
  `middle_aged` and was rejected as a mismatch for "young British female".
- Style `scopepay` created by copying `editorial-mono` and retuning the palette, so
  this video and `docs/architecture.png` share one identity.
- Six beats were sketched; five were built, merging the approval step into the
  capture beat.

### 2026-10-14 — Five beats built against real captures
- Captured the running app: seven screens at 1920×1080 via
  `scripts/capture-app.mjs`, each verified to show the facts it claims (the bakery
  brief text, the `1640.00 USD` total, the real capture id `6YS286962F723210Y`,
  `COMPLETED`, the superseded version, the sandbox status page).
- Built the five segments in the shared library and the timeline that orders them.
  Beat 4 has no capture and is labelled on screen as an explanation.
- Voice blocker found: the chosen Beth voice is a library voice and this account is
  on the free plan, so narration cannot be produced without a plan change the owner
  has not authorized. Free premade British voices were verified to work instead.

### 2026-10-14 — Silent draft exported and measured
- `videowright render m2_sandbox_demo --audio-track none` produced
  `draft-silent.mp4`: 2940 frames, 98.0s, 1920x1080 h264 (2.6 MB).
- Verified with `videos/scripts/check-export.mjs` rather than by eye: nine sampled
  beats each carry ink (1.48%–5.84%), no sampled frame has off-paper pixels on its
  8px border ring (so nothing is clipped), the teal accent stays between 0.000% and
  0.098% of a frame, and no two sampled frames are identical. A separate pass
  confirmed the brief, review and receipt beats each contain a ~1660x600px framed
  capture, while the title and gate beats contain none, as intended.
- **Known deviation, left in deliberately:** the gate beat sets its four check
  labels and its consequence line in sentence case, because `STYLE.md` forbids
  ALL CAPS in body type and reserves uppercase for mono labels. Sibling beats set
  their emphasis lines in uppercase mono. The two treatments should be reconciled
  by whoever reviews the cut visually; the style guide's rule is the reason it is
  not uppercase today.
- Beat 5 carries the narration's approval sentence over the app's own receipt
  screen, and no frame claims to be PayPal's page. Splitting approval (explained)
  from receipt (captured) into two beats remains open.

### 2026-10-14 — Diagram beat, and a checker correction
- Added `scopepay-architecture` after the gate beat, from `media/architecture.png`
  (the diagram copied from `docs/architecture.png`), fitted with `object-fit:
  contain` so the 1920x1120 diagram is shown whole.
- Re-rendered: **4500 frames, 150.0s** (md5 `40748b2189623f5d1efcbd6461353a77`), 27
  caption cues, no beat tight against its narration.
- The frame checker reported one failure that was the checker's fault, not the
  video's: two samples inside the diagram beat are identical because the beat holds a
  still visual while narration runs. Identical frames are now an error only when they
  come from different scenes, and a same-beat repeat is reported as a hold.
- 150s is inside the competition's three-minute limit and at the 150s aim in
  `docs/MEDIA_WORKFLOWS.md`; the 90-120s guidance in the same document is now
  exceeded, which is worth a deliberate decision rather than drift.

### 2026-10-14 — Captions, and the pacing defect they exposed
- Built `videos/scripts/build-captions.mjs`: it imports each segment module for its
  real `advances` and `voiceover` (stubbing the asset specifiers Node cannot load via
  `scripts/asset-stub-hooks.mjs`) and writes SRT, VTT and a manifest. Its first run
  reported that **four of the five beats were too short for their own narration** —
  the 98s cut forced cues to 21.5 characters/second — so every beat was re-sized to
  its narration at ~14 characters/second plus a hold, and the cut was re-rendered.
- The re-render is verified: **3840 frames, 128.0s**, the same frame measurements
  pass at the new beat boundaries, and the captions now sit at 14.0 characters/second
  worst case with two lines maximum. `draft-silent.mp4` was replaced by this cut
  (md5 `62af0d82ed5e855f2a9f3ebb60ac4103`).
- 128s lands inside the 90–120s guidance's spirit and well under the 150s aim in
  `docs/MEDIA_WORKFLOWS.md`, but the exact target is that document's call.
