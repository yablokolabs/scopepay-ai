import { defineConfig } from 'videowright';

/**
 * ScopePay video project.
 *
 * Lives in `videos/` because Videowright owns its folder (its installer requires
 * that), and this repo is the ScopePay application.
 *
 * `scopepay` is a local style copied from the bundled `editorial-mono` and
 * retuned to the project identity documented in docs/MEDIA_WORKFLOWS.md:
 * ivory paper, midnight-plum ink, one teal accent — the same tokens as the
 * architecture diagram, so the video and the README agree.
 *
 * 30fps rather than the 60 default: this is a screen-recording-style explainer
 * with no fast motion, and it halves deterministic render time.
 */
export default defineConfig({
  projectStructure: 'v1',
  defaultStyle: 'scopepay',
  defaults: {
    resolution: [1920, 1080],
    fps: 30,
    aspectRatio: '16:9'
  }
});
