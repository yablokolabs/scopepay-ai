import type { AudioTrack } from "videowright";
import voiceover from "../../originals/voiceovers/v1/voiceover.js";

const track: AudioTrack = {
	audio_file: "./audio/tracks/v1/track.mp3",
	length_s: 138.19,
	timing: voiceover.timing,
	audio_plan_path: "../../audio_plan.md",
	plan_snapshot_path: "./plan_snapshot.md",
	created_at: "2026-10-14T19:33:54Z",
};

export default track;
