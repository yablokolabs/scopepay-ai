import { defineSegment } from "videowright";

/**
 * Beat 1 of 5 — title card.
 *
 * Register and palette come from `styles/scopepay`: ivory paper, midnight-plum
 * ink, one teal accent. The teal element is the drawn rule under the headline and
 * there is exactly one of them in the frame, which is the style's rule for an
 * accent.
 *
 * Timing: one beat, held for 10s. The hold is deliberately long — the narration
 * (recorded separately into `audio/originals/voiceovers/`) decides the real beat
 * length, and `advances` is the single place that has to change when it does.
 */
let host: HTMLElement | null = null;

function ref(name: string): HTMLElement {
	const found = host?.querySelector(`[data-ref="${name}"]`);
	if (!(found instanceof HTMLElement)) {
		throw new Error(`scopepay-title: missing [data-ref="${name}"]`);
	}
	return found;
}

/** Entries settle downward: fade in while drifting up 16px. No bounce, ever. */
const ENTER = { duration: 480, fill: "forwards", easing: "cubic-bezier(0.16, 1, 0.3, 1)" } as const;
const FROM = { opacity: 0, transform: "translateY(16px)" };
const TO = { opacity: 1, transform: "translateY(0)" };

export default defineSegment({
	id: "scopepay-title",
	// Sized from this segment's own narration at ~14 characters per second plus a
	// holding beat. Replace with the synthesized audio's real timestamps.
	advances: [16],
	voiceover:
		"This is ScopePay. It turns a messy client brief into a reviewed, priced scope, and links that exact version to a payment on PayPal's sandbox. Sandbox — so nothing you see here moves real money.",

	mount(el) {
		host = el;
		el.innerHTML = `
      <div style="
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        width: 100%;
        height: 100%;
        padding: var(--safe-y) var(--safe-x);
        background: var(--color-bg);
        color: var(--color-fg);
      ">
        <p data-ref="label" style="
          margin: 0 0 40px 0;
          font-family: var(--font-mono);
          font-size: 18px;
          font-weight: 400;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-muted);
          opacity: 0;
        ">SCOPEPAY · SANDBOX BUILD</p>

        <h1 data-ref="headline" style="
          margin: 0;
          max-width: 1500px;
          font-family: var(--font-display);
          font-size: 200px;
          font-weight: 400;
          line-height: 0.98;
          letter-spacing: -0.01em;
          opacity: 0;
        ">Agree on the work.<br /><span style="font-style: italic;">Approve the payment.</span></h1>

        <span data-ref="rule" aria-hidden="true" style="
          display: block;
          width: 420px;
          height: 6px;
          margin-top: 32px;
          background: var(--color-accent);
          transform: scaleX(0);
          transform-origin: left center;
        "></span>

        <p data-ref="subtitle" style="
          margin: 44px 0 0 0;
          max-width: 1040px;
          font-family: var(--font-body);
          font-size: 32px;
          font-weight: 400;
          line-height: 1.45;
          opacity: 0;
        ">A client brief becomes a reviewed, priced scope. That exact version is what gets paid.</p>

        <p data-ref="note" style="
          margin: 28px 0 0 0;
          font-family: var(--font-mono);
          font-size: 20px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-muted);
          opacity: 0;
        ">Sandbox only — no real money moves</p>
      </div>
    `;
	},

	async play(ctx) {
		// Label leads, headline follows it at 480ms, then each further element 80ms on.
		ref("label").animate([FROM, TO], ENTER);
		ref("headline").animate([FROM, TO], { ...ENTER, delay: 480 });
		ref("subtitle").animate([FROM, TO], { ...ENTER, delay: 560 });
		ref("note").animate([FROM, TO], { ...ENTER, delay: 720 });
		// The accent draws left-to-right rather than fading — the style's one motion idea.
		ref("rule").animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
			...ENTER,
			delay: 640
		});

		await ctx.waitForNext();
	},

	unmount() {
		host = null;
	},
});
