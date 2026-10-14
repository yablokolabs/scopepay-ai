# Plan: Toolchain smoke test

## Purpose
- Audience: whoever maintains this repo's video pipeline — not an external audience
- Takeaway: `videowright render` produces a real MP4 from this project's own segments and style
- Constraints / hard guidelines: two short segments, silent, no product or escrow claims

## Style
- Active style: `scopepay` — local style: ivory paper `#faf6ee`, midnight-plum ink `#2e2246`, one teal accent `#0f7b72`
- Notes: the same tokens as the architecture diagram, so the video and the README agree

## Audio intent
- Mode: silent
- Notes: the toolchain check is about frames, not sound. Narration is proven separately.

## Segment outline
1. hello-intro — title card with an animated entrance
2. hello-outro — closing card, fading in after the intro

## Script (if applicable)
see voiceover_script/script.md

---

## Log

### 2026-10-14 — first verified render
- Folder was created by the Videowright setup flow as `_pipeline_check` and renamed `toolchain_smoke` once it passed
- Segments moved from `videos/toolchain_smoke/segments/*.ts` to the shared library as
  `segments/hello-intro/index.ts` and `segments/hello-outro/index.ts`. Videowright discovers segments
  only from `<project-root>/segments/<folder>/index.ts`, so the per-video copies were never registered
  and the timeline named a segment that did not exist
- Style import corrected from the never-installed `styles/editorial-mono/tokens.css` to
  `styles/scopepay/tokens.css`
- Timeline trimmed from three segments to two: the third referenced
  `editorial-mono-sample-kinetic`, a sample that lives in `styles/scopepay/sample/` as a template and
  is not part of the segment library
- `videowright render toolchain_smoke --audio-track none` produced 210 frames (7.0s) of 1920x1080
  h264. Frames extracted at 0.05s, 1.0s, 3.0s and 6.5s all differ, and the average frame colour is
  `f9f5ef` against the ivory token `#faf6ee`
