import { defineSegment } from "videowright";
import receiptShot from "../../media/app/04-receipt.png";

/**
 * Beat 5 of 5 — the real sandbox capture.
 *
 * The image is a real capture of the running app's receipt screen, taken by
 * `scripts/capture-app.mjs`; it shows the stored result of the recorded run. Every
 * value set in type below is a real value from that run, so nothing on this screen
 * is illustrative.
 *
 * The still-unproven beat is on screen on purpose: a video that shows only what
 * worked would be a worse record of what was actually verified.
 *
 * This is the last segment, so `play()` resolves after the second advance.
 */

let host: HTMLElement | null = null;

/** `--duration-normal` and `--ease-out` from tokens.css, as values WAAPI accepts. */
const ENTRY_DURATION = 480;
const ENTRY_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Entries fade in while drifting up 16px. Nothing here mutates the DOM mid-beat. */
function enter(el: HTMLElement | null, delay: number): void {
	if (!el) return;
	el.animate(
		[
			{ opacity: 0, transform: "translateY(16px)" },
			{ opacity: 1, transform: "translateY(0)" },
		],
		{ duration: ENTRY_DURATION, delay, easing: ENTRY_EASE, fill: "forwards" },
	);
}

export default defineSegment({
	id: "scopepay-capture-and-receipt",
	// Beat 1 holds the receipt and its real ids; beat 2 adds what is still unproven.
	// Sized from this segment's own narration at ~14 characters per second plus a
	// holding beat. Replace with the synthesized audio's real timestamps.
	advances: [12, 43],
	voiceover:
		"The buyer approves on PayPal's own page, and the server reads the order back and captures it. Order zero S L zero five seven three eight S seven two six two three zero four T; sixteen hundred and forty US dollars; capture id six Y S two eight six nine six two F seven two three two one zero Y. PayPal reports: completed. The receipt keeps what PayPal reported. What is still unproven is on the record too: a webhook delivery was verified against PayPal's own verifier, but no signed event has yet applied a state change, and timeouts and declines are untested.",

	mount(el) {
		host = el;
		el.innerHTML = `
      <div style="
        height: 100%;
        box-sizing: border-box;
        padding: var(--safe-y) var(--safe-x);
        background: var(--color-bg);
        color: var(--color-fg);
        font-family: var(--font-body);
        display: flex;
        flex-direction: column;
      ">
        <div data-ref="label" style="
          font-family: var(--font-mono);
          font-size: 18px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-muted);
          opacity: 0;
        ">Recorded result · Sandbox</div>

        <div style="
          display: flex;
          gap: var(--space-lg);
          margin-top: var(--space-md);
          align-items: flex-start;
        ">
          <div style="flex: 1 1 0; min-width: 0;">
            <h1 data-ref="headline" style="
              font-family: var(--font-display);
              font-size: 88px;
              font-weight: 400;
              line-height: 1.05;
              margin: 0;
              opacity: 0;
            ">The capture is real</h1>

            <div data-ref="values" style="
              margin-top: 40px;
              display: grid;
              grid-template-columns: auto 1fr;
              align-items: baseline;
              gap: 12px 24px;
              font-family: var(--font-mono);
            ">
              <span style="font-size: 24px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-muted);">Order</span>
              <span style="font-size: 40px; white-space: nowrap;">0SL05738S7262304T</span>
              <span style="font-size: 24px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-muted);">Capture</span>
              <span style="font-size: 40px; white-space: nowrap; color: var(--color-accent);">6YS286962F723210Y</span>
              <span style="font-size: 24px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-muted);">Amount</span>
              <span style="font-size: 40px; white-space: nowrap;">1640.00 USD</span>
              <span style="font-size: 24px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-muted);">Status</span>
              <span style="font-size: 40px; white-space: nowrap;">COMPLETED</span>
            </div>
          </div>

          <div style="flex: 0 0 960px;">
            <div data-ref="shotFrame" style="
              border: 1px solid var(--color-border);
              padding: 12px;
              background: var(--color-surface);
              opacity: 0;
            ">
              <img
                src="${receiptShot}"
                alt="ScopePay receipt screen showing the stored sandbox result for order 0SL05738S7262304T"
                style="display: block; width: 100%; height: auto;"
              />
            </div>
            <div data-ref="shotCaption" style="
              margin-top: var(--space-sm);
              font-family: var(--font-mono);
              font-size: 18px;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              color: var(--color-muted);
              opacity: 0;
            ">Capture of the running app</div>
          </div>
        </div>

        <div data-ref="limits" style="margin-top: 40px; opacity: 0;">
          <div style="
            font-family: var(--font-mono);
            font-size: 18px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--color-muted);
          ">Still unproven</div>
          <p style="
            font-size: 36px;
            line-height: 1.4;
            margin: 16px 0 0;
          ">A webhook delivery was verified against PayPal's own verifier, but no signed event has yet applied a state change. Timeouts and declines are untested.</p>
        </div>
      </div>
    `;
	},

	async play(ctx) {
		const ref = (name: string): HTMLElement | null =>
			host?.querySelector(`[data-ref="${name}"]`) as HTMLElement | null;

		// Beat 1: the receipt and the four real values, staggered into place.
		enter(ref("label"), 0);
		enter(ref("shotFrame"), 80);
		enter(ref("headline"), 160);
		enter(ref("values"), 240);
		enter(ref("shotCaption"), 320);

		await ctx.waitForNext();

		// Beat 2: what is still unproven.
		enter(ref("limits"), 0);

		await ctx.waitForNext();
	},

	unmount() {
		host = null;
	},
});
