# Tooling status

Observed during the October 13–15, 2026 sessions on the build host. This records
what was actually reachable and used. Nothing here is inherited from a config
label.

| Requirement | Observed state | What was actually done |
| --- | --- | --- |
| Hindsight MCP/API on port 8888, bank `scopepay-ai` | **Available and used.** October 14: `GET /health` → 200; `GET /v1/default/banks` listed bank `scopepay-ai`; endpoints taken from the service's own `GET /openapi.json` rather than assumed. | Recalled the prior checkpoint from `scopepay-ai` (13 facts) and reconciled it against git and `docs/PROGRESS.md` — it matched: HEAD `6c25666`, 95/95 tests, blocker = no sandbox credentials. A new checkpoint was retained after this session's milestone. No secrets, buyer data or raw headers stored. |
| `context-mode` | **Active on October 15**: its tools were exposed and used for API calls and large outputs. Earlier: **binary present** at `/home/azureuser/.local/node-v22.23.2/bin/context-mode`; no context-mode tools were exposed in this session's tool list. | Not used, and not claimed as active. Large reads were bounded direct file reads and targeted searches. |
| Nori `senior-swe` | **Active on October 15**: the Nori workflow block and skills are installed in `~/.claude`, and the branch, TDD and PR steps were followed. Earlier: **not installed.** The visible skill catalogs (`~/.agents/skills`, `~/.claude/skills`) contain `nori-info` and the Build With AI skills, but no `senior-swe` skillset. | Not activated. No similarly named package from a guessed repository was installed. |
| Headroom | **Not verified.** No local MCP integration or proxy found on the host. | Not used and not claimed. |
| ADHD ideation (`uditakhourii/adhd`) and `i-have-adhd` response style | **Not installed** in the visible catalogs. | The user-requested response style (short numbered steps, action first, concrete estimates, location → cause → fix) was followed directly; no separate skill was claimed to run. |
| lightpanda | **Installed this session** by the user's request: `1.1.0-nightly.10552+dd2cd5d7f` at `~/.local/bin/lightpanda`, CDP server used on `127.0.0.1:9222`. Not a project dependency and not wired into the repo. | Used to attempt the PayPal sandbox buyer approval. It renders and fills PayPal's sign-in form, but PayPal's DataDome device check answers `403` with a captcha, so the login cannot complete from a non-Chromium engine. Recorded in `docs/proof/PROOF_M2_SANDBOX.md` section 7; stopped afterwards. |
| Moli | **Installed this session** by the user's request: `1.1.17` at `~/.local/bin/moli` (standalone Rust browser kernel, no system libraries needed). CDP server used on `127.0.0.1:9222`. Not a project dependency and not wired into the repo. | Used to attempt the PayPal sandbox buyer approval. It presents as `Chrome/145.0.0.0` and **does** get past PayPal's bot checks: it filled and submitted the sign-in form and reached the logged-in dashboard. The approval then failed with PayPal's `CANNOT_PAY_SELF` because the configured account is the sandbox **seller**. Recorded in `docs/proof/PROOF_M2_SANDBOX.md` section 7. |
| Real Chromium (Playwright) | **Installed this session with the owner's authorization, and verified by running it.** `npx playwright install` failed host validation twice; `sudo npx playwright install-deps chromium` resolved both rounds. The earlier note that its libraries were absent and "not needed" applied to the PayPal step alone — that step still ran on Moli, which needs none of them. | Launched Chromium `156.0.8078.4`, rendered a page at 640x360 with `deviceScaleFactor` 2, and wrote a real screenshot of 23518 bytes. Detail: [Video toolchain](#video-toolchain). |
| Videowright | **Installed this session** into a `videos/` sub-folder at the owner's request: `videowright@0.1.1` plus its dev toolchain, following its own `INSTALL.md` (which requires a folder of its own) and `docs/MEDIA_WORKFLOWS.md` ("Isolate it in `videos/`"). Both skill symlinks exist at the install root and `SKILL.md` resolves through them. | Installed, patched for an upstream packaging bug it ships with, and used to export two real MP4s: the `toolchain_smoke` test (210 frames) and the **M2 demo cut's silent draft** (4500 frames, 150.0s). Narration is still missing. Detail and open items: [Video toolchain](#video-toolchain). |
| ElevenLabs | **One** `ELEVENLABS_API_KEY` in the shared env file: `free` tier, 2892 characters remaining after voiceover `v1` (7108/10000 used, cannot extend, resets 2026-11-12). An earlier read of the same file reported two entries and is superseded by this one. The key value is written into no document. | Quota, voice list and models read from the account API. **The free plan cannot use library voices through the API**: the owner's chosen Beth is category `professional` and synthesis answers `HTTP 402 paid_plan_required` ("Free users cannot use library voices via the API"). The 21 `premade` voices do work — Alice, Lily and George each returned a real MP3 (5.38s, 5.04s, 4.78s; ~150 characters total, quota still reporting 5054). Auditions are in `/tmp/audition-*.mp3`. Nothing has been published. Voice Design is also closed on the free API tier (`403 feature_not_available`). Voice decision: Alice, synthesised once as `videos/videos/m2_sandbox_demo/audio/originals/voiceovers/v1/` (138.2s, 1913 narration characters). |
| diagram-design | **Used from a repository checkout**, not installed as a skill: `cathrynlavery/diagram-design` cloned to `/tmp/diagram-design` at revision **`11b08eade8049c441ed3df1895e3b527c26c0fbe`** (release 2.6.98, main on 2026-10-13). Its `SKILL.md`, `references/type-architecture.md` and `references/style-guide.md` were read before drawing, as the skill's own gate requires. | Produced `docs/architecture.html` (type: Architecture, size preset `doc-inline`), then `docs/architecture.svg` via the packaged `scripts/export_svg.py`, then `docs/architecture.png`. Validated with the skill's own checkers: `self_check.py` → `OK`, `verify-geometry.py` → `0 findings` (this covers the six mandatory connector rules). `lint-skin.py` reports 104 findings **by design**: it lints the skill's own bundled assets against its shipped palette, so a branded palette necessarily fails it; it has no `--style-guide` flag. Palette contrast was checked directly instead (WCAG on ivory: ink 13.59:1, muted 6.85:1, soft 4.98:1, teal 4.76:1, link 4.90:1 — all AA). |

## Diagram profile and export deviations

- **Palette applied, not defaulted.** The skill's first-run gate asks for a style
  source before shipping default-skinned output. `docs/MEDIA_WORKFLOWS.md` already
  specifies the palette (ivory paper, midnight-plum ink, teal accent), so that
  documented decision was used instead of asking again: `paper #faf6ee`,
  `paper-2 #f1ebdf`, `ink #2e2246`, `muted #5a5170`, `soft #6f6685`,
  `accent #0f7b72`, `link #4c6ba8`. The tokens are inlined at the top of
  `docs/architecture.html` with a comment naming their source.
- **This is an inline palette, not a saved profile.** No `.diagram-design` marker
  or `references/style-guide.md` edit was made, so a future diagram must reuse
  these same tokens rather than re-deriving them. Recorded here as the open
  shortcut.
- **The first PNG export was broken.** It came from the Moli CDP browser, not
  Playwright, and Moli drew no `<text>`: the published PNG had boxes and arrows but
  no labels. The pixel checks run then (paper corners, colour count, ink present)
  could not see missing text.
- **PNG export now follows `references/export.md` in Node.**
  `videos/scripts/export-diagram.mjs` renders `docs/architecture.html`, awaits
  `document.fonts.ready`, refuses to write if Geist did not load, pins the `<svg>`
  to the viewport origin at viewBox size, and screenshots it at 2x. It writes both
  `docs/architecture.png` and `videos/media/architecture.png`. Python Playwright is
  not installed, and the skill says not to auto-install it; the Node package is
  already present for the video toolchain.
- **`videos/scripts/check-diagram.mjs` covers what the skill checkers miss.**
  `verify-geometry.py` only reports a label mask under a later node. The new check
  fails on a connector end that is not on a node edge, on overlapping text runs,
  and on a PNG that differs from a fresh render of the SVG. It caught three defects
  in the first draft: the brief arrow ended in empty space, and the trust-boundary
  label sat under the PROPOSE and IDS ONLY labels.
- Checks run on the final files: `self_check.py` OK, `verify-geometry.py` 0
  findings, `check-diagram.mjs` OK. viewBox 960x560 → PNG 1920x1120. The diagram
  carries no footer or credits strip; licensing and provenance live here instead.

## Video toolchain

Videowright composes video in HTML/CSS/JS, so its two render prerequisites are a
browser it can drive and an encoder. Both are now installed and were checked by
actually running them rather than by trusting validation output.

**Install.** `videos/package.json` is `"type": "module"` with `dev` and `render`
scripts; `videos/tsconfig.json` was copied from
`node_modules/videowright/skill/assets/install/tsconfig.json`. Dev dependencies
were pinned from videowright's own core `devDependencies` as its install doc
requires — `vitest` `^3.1.3` and `@playwright/test` `^1.59.1` requested, which
npm resolved to `vitest ^3.2.7` and `@playwright/test ^1.64.0` — plus latest
`typescript` (`^7.0.2`) and `@biomejs/biome` (`^2.5.15`).

**System dependencies.** With `sudo` (passwordless) and the owner's
authorization: `ffmpeg`, then Playwright's Chromium libraries. `npx playwright
install` failed host validation twice — first with 8 missing libraries
(`libgtk-3-0t64`, `libpango-1.0-0`, `libpangocairo-1.0-0`, `libcairo2`,
`libcairo-gobject2`, `libatk1.0-0t64`, `libasound2t64`), then with a second,
longer set (GStreamer libraries such as `libgstvideo-1.0.so.0`, plus
`libwebpdemux.so.2`, `libavif.so.16`, `libharfbuzz-icu.so.0`,
`libwayland-server.so.0`, `libmanette-0.2.so.0`, `libenchant-2.so.2`,
`libsecret-1.so.0`, `libhyphen.so.0`). Installing Playwright's own dependency set
— `sudo npx playwright install-deps chromium` — resolved both. Worth recording so
nobody repeats it: a case-sensitive search for `libxdamage` misleadingly reported
a missing library, because the file is `libXdamage.so.1` with a capital X and it
was present the whole time.

**Both halves verified by running them.**

| Check | Command | Result |
| --- | --- | --- |
| Browser launches | a throwaway Playwright script (`chromium.launch()`, `page.screenshot()`) | Chromium `156.0.8078.4` launched, page `640x360` at `deviceScaleFactor` 2, screenshot 23518 bytes |
| Encoder works | `ffmpeg -f lavfi -i color=c=0f7b72:s=320x240:d=1 -c:v libx264 -pix_fmt yuv420p` | `ffprobe`: codec `h264`, `320x240`, duration `1.000000`s, 2325 bytes |

The throwaway script was deleted; nothing was added to the repo for the check.

**An upstream packaging bug had to be worked around first.** videowright 0.1.1's
`files` field publishes only `dist`, `skill` and `src/cli/entry`, but two of those
published entry files import the package root by source path
(`render_entry.ts` → `../../index.js`, `views/video_view.ts` →
`../../../index.js`, i.e. `src/index.ts`, which is not shipped). `render`
therefore died before the page was ready, with Vite reporting
`Failed to resolve import "../../index.js"`. Because a later query also showed the
same symptom for a different reason, the second failure was worth separating: an
incorrect relative depth resolves to `src/dist/index.js` and reports an identical
message, so the patch verifies each replacement target exists before writing it.
`videos/scripts/patch-videowright.mjs` repoints both specifiers at the shipped
`dist/index.js` and runs as a `postinstall` hook, because `node_modules` is not
committed and a fresh `npm install` would otherwise silently revert to a broken
tree. It is idempotent and prints a skip notice once upstream ships the file its
own entry imports. Both patched specifiers were confirmed in the installed tree.

**Two layout mistakes in the scaffold were the rest of it.** The setup flow left
its segments at `videos/<name>/segments/*.ts`, but Videowright discovers segments
only from `<project-root>/segments/<folder>/index.ts` and matches them by folder
name, so the timeline referenced a segment that was never registered; the two
segments moved to `segments/hello-intro/index.ts` and `segments/hello-outro/index.ts`.
Its timeline also imported `styles/editorial-mono/tokens.css`, the style that was
copied and retuned as `scopepay`, so the import now names `scopepay`.

**Export verified by inspecting the MP4.** `videowright render toolchain_smoke
--audio-track none` (`--audio-track none` is required while a video has no audio
track):

| Check | Result |
| --- | --- |
| Container | `ffprobe`: `h264`, `1920x1080`, `30/1` fps, `210` frames, duration `7.000000`s |
| Frames are not blank or frozen | PNGs extracted at 0.05s, 1.0s, 3.0s, 6.5s: four distinct `md5` sums, sizes 30706–61731 bytes |
| Project palette is applied | average frame colour `f9f5ef` at every sample, against the ivory token `#faf6ee` |

The video this produced is `videos/toolchain_smoke` — a two-segment smoke test
kept deliberately so the pipeline can be re-verified in one command. It is not the
M4 demo video.

**The M4 demo cut (silent draft).** Real screens of the running app were captured
first, because the demo is required to show the actual app rather than a mockup:
`videos/scripts/capture-app.mjs` drives the local dev server (`:5173`, API on
`:8790`) through the app's own hash routes and writes 1920x1080 PNGs into
`videos/media/app/`. It reads the recorded scope out of the app's own store, so the
receipt screen shows the real capture id, and alongside the PNGs it writes
`screens.json` with the text each screen displayed — the script fails if two
screens render identical content, which is what a route that does not change the
page looks like. Five segments (`videos/segments/scopepay-*`) and
`videos/videos/m2_sandbox_demo/timeline.ts` order the beats. Beat 4 has no capture
at all and says so on screen (`EXPLAINED · NOT A RECORDED CALL`), because no
screenshot of PayPal's own approval page was kept and it cannot be re-taken without
another buyer approval; no frame claims to be that page.

`videowright render m2_sandbox_demo --audio-track none` produced
`videos/videos/m2_sandbox_demo/draft-silent.mp4`: 4500 frames, 150.0s, 1920x1080
h264. Verified by measuring frames rather than watching them
(`videos/scripts/check-export.mjs`):

| Check | Result |
| --- | --- |
| Container | `1920x1080` at `30/1` fps, `4500` frames, `150.000`s |
| Beats actually drew | nine sampled frames, ink 1.48%–5.84% each (a blank beat measures ~0%) |
| Nothing clipped | the outer 8px ring is paper on every sampled frame, 0 off-paper pixels |
| Accent stays an accent | teal 0.000%–0.098% per frame, well under the 2% flag |
| No frozen scenes | no two samples from *different* beats are identical. A repeat inside one beat is reported as a hold instead: the hold is intended when a still visual (the diagram) carries narration, and the check originally failed on exactly that |
| Captures are really on screen | a ~1660x600px framed rectangle in the brief, review and receipt beats; none in the title or gate beats |

**Captions, and the defect they caught.** `videos/scripts/build-captions.mjs`
derives one cue per caption-sized line group from the segments themselves: it imports
`segments/<id>/index.ts` for its real `advances` and `voiceover`, registering
`videos/scripts/asset-stub-hooks.mjs` first because a segment imports its own `.png`
and Node cannot load one (`ERR_UNKNOWN_FILE_EXTENSION`). Its first run reported that
four of the five beats were too short for the narration they carry, and that cues had
to be squeezed to 21.5 characters/second to fit a 98s cut. Sizing each beat at ~14
characters/second plus a holding beat took the cut to **150s** and the captions to
**27 cues at 14.0 characters/second worst case, two lines maximum**
(`captions.json` records that they are provisional, since they derive from
`advances` rather than from audio).

That silent draft is superseded by the narrated cut below. `docs/MEDIA_WORKFLOWS.md`
owns the final length and delivery path.

**The chosen voice is not usable on this plan, and that was found by calling the
API rather than reading a list.** The account's `Alice - Clear, Engaging Educator`
is labelled *female · british · middle_aged*, so the owner chose **Beth - British
female, playful and witty** (`zH7TN9vEZAsEway9xWev`, *female · young · british ·
casual · conversational*). A one-line audition then came back
`HTTP 402 paid_plan_required`: *"Free users cannot use library voices via the
API."* The account's own voice list explains it — the 23 voices split 21
`premade` + 2 `professional`, and **both** professional voices (Beth and
`Georgia K – Warm Engaging Customer Care`) are the only young British female
voices in the account. Every `premade` voice is synthesizable on the free plan;
the three British ones are Alice (`Xb7hH8MSUJpSbSDYk0k2`, *british/middle_aged*),
Lily (`pFZP5JQG7iQjIQuC4Bku`, *british/middle_aged*) and George
(`JBFqnCBsd6RMkjVDRZzb`, *british/middle_aged*). All three were auditioned and
returned real MP3s. So narration either uses a free premade voice or the account
is upgraded — an external payment, which needs the owner's authorization and has
not been made.

**The narrated cut.** The owner then asked for a young British female voice. Voice
Design, the only other route to one, is also closed on the free API tier
(`403 feature_not_available`), so the owner chose Alice. Voiceover `v1`
(`videos/videos/m2_sandbox_demo/audio/originals/voiceovers/v1/`) was synthesised
once with `/with-timestamps`: 138.2s, 1913 narration characters, and every spoken
word matched the segment narration. Segment timing comes from those word
timestamps (each segment ends 0.2s before the next segment's first word), and
`build-captions.mjs --voiceover v1` times each cue from its first to last spoken
word, so the captions are no longer provisional. `videowright render
m2_sandbox_demo` muxes audio track `v1`: `demo.mp4`, 139.67s video and 139.65s
audio, `check-export.mjs` passing on 12 sampled frames. Renders are not committed
(`videos/.gitignore`).

**Open items.**

- `npm audit` in `videos/` reports 3 vulnerabilities (1 moderate, 2 critical).
  Not auto-fixed, because `npm audit fix --force` would rewrite the pinned
  version ranges; it needs a deliberate decision.
- The installer's instruction-file block was written into the repo-root
  `AGENTS.md` as a marked region (`<!-- videowright:start -->` …
  `<!-- videowright:end -->`). `git diff --numstat` shows 11 insertions and 0
  deletions, so all five original ScopePay rules are intact. It was **not** written
  to `CLAUDE.md`: Claude Code is installed on this host but was not selected.
- The narrated demo is `videos/videos/m2_sandbox_demo/demo.mp4`; the public YouTube upload remains
  an unauthorized external publication.
- In the architecture beat the diagram's arrow and legend labels render at about
  8px on a 1080p frame. A wider figure would make them readable; not done.
- The dev server (`videowright dev`) has not been exercised; only `render` has.

## Notes

- Client reference for the missing skills, to be resolved deliberately rather
  than approximated: `tilework-tech/nori-skillsets` (select `senior-swe`),
  `headroomlabs-ai/headroom`, `dietrichgebert/ponytail`, `uditakhourii/adhd`,
  `ayghri/i-have-adhd`, `scosman/videowright`, `cathrynlavery/diagram-design`.
  Of these, `videowright` is now installed (see
  [Video toolchain](#video-toolchain)) and `diagram-design` was used from a
  repository checkout; the rest are still open.
- Activating a skillset rewrites agent configuration and must not overwrite
  `AGENTS.md` or `docs/SESSION_TOOLING.md`. Nothing overwrote either file:
  videowright's installer added a marked region to `AGENTS.md` and changed no
  existing line.
- Hindsight and Headroom serve different purposes here. Hindsight is durable
  memory; Headroom is context compression. Neither was conflated with the other.
