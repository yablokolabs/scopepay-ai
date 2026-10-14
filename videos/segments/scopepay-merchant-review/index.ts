import { defineSegment } from "videowright";
import reviewShot from "../../media/app/02-review.png";

/**
 * Beat 3 — the merchant's review seals the scope.
 *
 * The screen on the right is a real capture of the running app's merchant-review
 * page (taken by `scripts/capture-app.mjs`; `media/app/screens.json` records the
 * text it rendered). It is a screenshot, not a live call, and the caption says so.
 */

/** WAAPI needs numbers, so the token values are restated here rather than read from CSS. */
const DURATION_NORMAL = 480; // --duration-normal
const STAGGER = 80; // --stagger
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)"; // --ease-out

let host: HTMLElement | null = null;

function ref<T extends HTMLElement>(name: string): T {
	const found = host?.querySelector(`[data-ref="${name}"]`);
	if (!found) throw new Error(`scopepay-merchant-review: missing [data-ref="${name}"]`);
	return found as T;
}

/** Entries settle downward: fade in while drifting up 16px. Never out, never bouncing. */
function settleIn(el: HTMLElement, delay: number, distance = 16): void {
	el.animate(
		[
			{ opacity: 0, transform: `translateY(${distance}px)` },
			{ opacity: 1, transform: "translateY(0)" },
		],
		{ duration: DURATION_NORMAL, delay, fill: "forwards", easing: EASE_OUT },
	);
}

export default defineSegment({
	id: "scopepay-merchant-review",
	// Beat 1 at 8s: the seal line arrives. Beat 2 at 20s: the timeline moves on.
	advances: [8, 20],
	voiceover:
		"The merchant reviews it. Their edit is authoritative, and it produces a new version that can never be rewritten, sealed with a hash over the exact scope. That hash is what the buyer will approve — and that is what makes a stale scope unpayable.",

	mount(el) {
		host = el;
		el.innerHTML = `
      <div style="
        box-sizing: border-box;
        height: 100%;
        padding: var(--safe-y) var(--safe-x);
        background: var(--color-bg);
        color: var(--color-fg);
        font-family: var(--font-body);
        display: flex;
        flex-direction: column;
      ">
        <div style="display: flex; align-items: baseline; justify-content: space-between;">
          <span data-ref="label" style="
            font-family: var(--font-mono);
            font-size: 20px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--color-muted);
            opacity: 0;
          ">Recorded app · 02 Merchant review</span>
          <span style="
            font-family: var(--font-mono);
            font-size: 20px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--color-muted);
            opacity: 0;
          " data-ref="stamp">Screenshot, not a live call</span>
        </div>

        <div style="height: var(--rule-weight); background: var(--color-border); margin-top: var(--space-md);"></div>

        <div style="
          display: flex;
          gap: var(--space-lg);
          flex: 1;
          min-height: 0;
          padding-top: var(--space-lg);
        ">
          <div style="flex: 0 0 38%; display: flex; flex-direction: column; min-width: 0;">
            <h1 data-ref="headline" style="
              font-family: var(--font-display);
              font-size: 88px;
              font-weight: 400;
              line-height: 1.04;
              margin: 0;
              opacity: 0;
            ">The merchant's edit is authoritative</h1>
            <p data-ref="body" style="
              font-size: 36px;
              line-height: 1.45;
              margin: var(--space-md) 0 0;
              max-width: 24ch;
              opacity: 0;
            ">Review produces a new version. It is sealed with a hash over the exact scope, and it cannot be rewritten.</p>
          </div>

          <figure data-ref="captureGroup" style="
            flex: 1 1 56%;
            margin: 0;
            display: flex;
            flex-direction: column;
            min-width: 0;
            opacity: 0;
          ">
            <div style="
              flex: 1;
              min-height: 0;
              border: var(--rule-weight) solid var(--color-border);
              background: var(--color-surface);
              padding: var(--space-sm);
              display: flex;
            ">
              <img
                src="${reviewShot}"
                alt="The ScopePay merchant review screen for the recorded scope, showing its priced line items"
                style="width: 100%; height: 100%; object-fit: contain; object-position: top center; display: block;"
              />
            </div>
            <figcaption data-ref="caption" style="
              font-family: var(--font-mono);
              font-size: 20px;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              color: var(--color-muted);
              margin-top: var(--space-sm);
              opacity: 0;
            ">Capture of the running app</figcaption>
          </figure>
        </div>

        <div style="
          margin-top: var(--space-md);
          border-top: var(--rule-weight) solid var(--color-border);
          padding-top: var(--space-md);
          display: flex;
          align-items: baseline;
          gap: var(--space-md);
          opacity: 0;
        " data-ref="seal">
          <span style="
            font-family: var(--font-mono);
            font-size: 20px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--color-muted);
            white-space: nowrap;
          ">The seal</span>
          <p style="
            font-family: var(--font-mono);
            font-size: 32px;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            line-height: 1.35;
            margin: 0;
            max-width: 78ch;
          ">That hash is what the buyer approves — which is why <span style="color: var(--color-accent);">a stale scope cannot be paid</span></p>
        </div>
      </div>
    `;
	},

	async play(ctx) {
		settleIn(ref("label"), 0);
		settleIn(ref("stamp"), STAGGER, 0);
		settleIn(ref("headline"), STAGGER * 2);
		settleIn(ref("body"), STAGGER * 3);
		settleIn(ref("captureGroup"), STAGGER * 4);
		settleIn(ref("caption"), STAGGER * 5, 0);

		await ctx.waitForNext(); // Beat 1: text and capture are fully revealed

		settleIn(ref("seal"), 0);

		await ctx.waitForNext(); // Beat 2: the timeline moves to the gate
	},

	unmount() {
		host = null;
	},
});
