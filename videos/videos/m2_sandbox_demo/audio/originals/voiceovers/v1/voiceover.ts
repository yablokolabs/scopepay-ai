import type { Voiceover } from "videowright";

/**
 * Alice (British, premade). Library voices and Voice Design need a paid plan on the
 * API; this account is on the free tier. Timing is computed from timing.json: each
 * segment ends 0.2s before the next segment's first word, each internal beat 0.2s
 * before its anchor phrase, and the last segment holds 1.5s after the final word.
 */
const voiceover: Voiceover = {
	audio_file: "./audio.mp3",
	provider: "elevenlabs",
	provider_timing_file: "./timing.json",
	eleven_labs_voice_id: "Xb7hH8MSUJpSbSDYk0k2",
	timing: {
		perSegment: {
			'scopepay-title': [14.95],
			'scopepay-brief-to-scope': [15.22, 25.44],
			'scopepay-merchant-review': [10.6, 17.5],
			'scopepay-gate': [10.33, 20.19],
			'scopepay-architecture': [18.41],
			'scopepay-capture-and-receipt': [27.18, 43.17],
		},
	},
	notes: "Alice, eleven_multilingual_v2, stability 0.5, similarity 0.75. Beat anchors: 'The server re-prices', 'That hash is what', 'The model has no authority', 'What is still unproven'.",
};

export default voiceover;
