import { defineSegment } from "videowright";
import logo from "../../media/scopepay-logo.png";

/**
 * Beat 1 of 5 — title card.
 *
 * Register and palette come from `styles/scopepay`: ivory paper, midnight-plum
 * ink, one teal accent. The logo carries both the name and the tagline, and its
 * teal "Pay" is the frame's one accent. `media/scopepay-logo.png` is the repo-root
 * `scopepay-ai-logo.png`, cropped and keyed to transparent so it sits on the paper
 * without a box.
 *
 * Timing: the active audio track overrides `advances` with the narration's own
 * timestamps.
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

        <img data-ref="headline" src="${logo}" alt="ScopePay. Agree on the work. Approve the payment." style="
          display: block;
          width: 1260px;
          height: auto;
          margin-left: -20px;
          opacity: 0;
        " />

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

		await ctx.waitForNext();
	},

	unmount() {
		host = null;
	},
});
