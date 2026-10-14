import "../../styles/scopepay/tokens.css";
import type { Timeline } from "videowright";

const timeline: Timeline = {
	meta: {
		title: "ScopePay pipeline check",
	},
	segments: [
		{ id: "hello-intro" },
		{ id: "hello-outro", transition: "fade" },
	],
};

export default timeline;
