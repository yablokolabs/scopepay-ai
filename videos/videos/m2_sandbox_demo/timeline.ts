import "../../styles/scopepay/tokens.css";
import type { Timeline } from "videowright";
import defaultAudioTrack from "./audio/tracks/v1/track.js";

/**
 * ScopePay — brief to sandbox capture.
 *
 * Six beats, matching `PLAN.md`. Each segment owns its own timing via `advances`,
 * which is what makes the render deterministic and keeps the beat times decoupled
 * from any one recording. The active audio track overrides them with timing taken
 * from the narration's own word timestamps (see the track's voiceover.ts).
 *
 * Screens come from `media/app/` and are real captures of the running app, taken
 * by `scripts/capture-app.mjs`, whose `screens.json` records what text each one
 * showed. The gate beat has no capture and says so on screen.
 */
const timeline: Timeline = {
	meta: {
		title: "ScopePay — brief to sandbox capture",
	},
	segments: [
		{ id: "scopepay-title" },
		{ id: "scopepay-brief-to-scope", transition: "fade" },
		{ id: "scopepay-merchant-review", transition: "fade" },
		{ id: "scopepay-gate", transition: "fade" },
		{ id: "scopepay-architecture", transition: "fade" },
		{ id: "scopepay-capture-and-receipt", transition: "fade" },
	],
	default_audio_track: defaultAudioTrack,
};

export default timeline;
