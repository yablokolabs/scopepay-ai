import { defineSegment } from "videowright";

/**
 * Beat 4 — the deterministic server gate.
 *
 * There is no screenshot for this beat: the four checks happen on the server and
 * were not captured, so the frame is an explanation and the on-screen label says
 * exactly that. Nothing here should read as a recording of a live call.
 *
 * Timing mirrors the tokens (WAAPI cannot read CSS custom properties, so the
 * values are repeated): --duration-normal 480ms, --ease-out
 * cubic-bezier(0.16, 1, 0.3, 1), --stagger 80ms.
 */

let host: HTMLElement | null = null;

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const ENTRY_MS = 480;
const STAGGER_MS = 80;

/** Every animated element is addressed by data-ref so play() never guesses. */
function ref(name: string): HTMLElement {
	const el = host?.querySelector(`[data-ref="${name}"]`);
	if (!el) throw new Error(`scopepay-gate: missing [data-ref="${name}"]`);
	return el as HTMLElement;
}

/** One entry motion for the whole beat: fade in while settling up 16px. */
function enter(el: HTMLElement, delay: number): void {
	el.animate(
		[
			{ opacity: 0, transform: "translateY(16px)" },
			{ opacity: 1, transform: "translateY(0)" },
		],
		{ duration: ENTRY_MS, delay, easing: EASE_OUT, fill: "forwards" },
	);
}

const CHECKS = ["Version hash", "Amount", "Currency", "Merchant"];

export default defineSegment({
	id: "scopepay-gate",
	// Beat 1 at 7s: the four checks are on screen. Beat 2 at 18s: the consequence.
	// Sized from this segment's own narration at ~14 characters per second plus a
	// holding beat. Replace with the synthesized audio's real timestamps.
	advances: [7, 23],
	voiceover:
		"Before anything reaches PayPal, a deterministic gate re-checks four things on the server: the version hash, the amount, the currency, and the merchant. The model has no authority to move money here. If the hash is stale, or an amount was tampered with, the request stops at this gate.",

	mount(el) {
		host = el;
		el.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        height: 100%;
        padding: var(--safe-y) var(--safe-x);
        background: var(--color-bg);
        color: var(--color-fg);
        font-family: var(--font-body);
      ">
        <p data-ref="label" style="
          margin: 0;
          font-family: var(--font-mono);
          font-size: 18px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-muted);
          opacity: 0;
        ">Explained · not a recorded call</p>

        <div style="
          height: var(--rule-weight);
          background: var(--color-border);
          margin: var(--space-sm) 0 0;
        "></div>

        <h1 data-ref="headline" style="
          margin: var(--space-md) 0 0;
          font-family: var(--font-display);
          font-size: 88px;
          font-weight: 400;
          line-height: 1.05;
          opacity: 0;
        ">The gate the model cannot open</h1>

        <div data-ref="cards" style="
          display: flex;
          gap: var(--space-lg);
          margin: var(--space-lg) 0 0;
        ">
          ${CHECKS.map(
						(name, index) => `
            <div data-ref="card" style="
              flex: 1 1 0;
              padding: var(--space-md) var(--space-md) 40px;
              background: var(--color-surface);
              border: var(--rule-weight) solid var(--color-border);
              border-radius: var(--radius-sm);
              opacity: 0;
            ">
              <p style="
                margin: 0;
                font-family: var(--font-mono);
                font-size: 22px;
                letter-spacing: 0.08em;
                color: var(--color-muted);
              ">0${index + 1}</p>
              <p style="
                margin: var(--space-sm) 0 0;
                font-size: 40px;
                font-weight: 500;
                line-height: 1.15;
              ">${name}</p>
            </div>
          `,
					).join("")}
        </div>

        <p data-ref="body" style="
          margin: var(--space-lg) 0 0;
          max-width: 1200px;
          font-size: 36px;
          line-height: 1.4;
          opacity: 0;
        ">Four deterministic checks on the server, before anything reaches PayPal.</p>

        <p data-ref="consequence" style="
          margin: var(--space-md) 0 0;
          max-width: 1400px;
          font-size: 36px;
          line-height: 1.4;
          opacity: 0;
        ">The model has no authority to move money here — a stale hash or a
        tampered amount <span style="color: var(--color-accent)">stops here</span>.</p>
      </div>
    `;
	},

	async play(ctx) {
		const cards = Array.from(host?.querySelectorAll('[data-ref="card"]') ?? []) as HTMLElement[];

		enter(ref("label"), 0);
		enter(ref("headline"), 120);
		cards.forEach((card, index) => enter(card, 240 + index * STAGGER_MS));
		enter(ref("body"), 240 + cards.length * STAGGER_MS);

		await ctx.waitForNext(); // Beat 1: the four checks are on screen

		// The consequence is held in a reserved slot, so revealing it moves nothing.
		enter(ref("consequence"), 0);

		await ctx.waitForNext(); // Beat 2: the consequence has landed
	},

	unmount() {
		host = null;
	},
});
