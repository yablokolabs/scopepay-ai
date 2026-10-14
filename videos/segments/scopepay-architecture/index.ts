/**
 * Beat 5 — the whole trust boundary, shown on the project's own architecture diagram.
 *
 * The image is the real `docs/architecture.png`, copied into `media/` because the
 * video project's Vite root is `videos/`. It is 1920x1120 — taller than this 16:9
 * canvas — so it is constrained by height and never cropped: a trust-boundary
 * diagram with its edge clipped would be worse than a smaller one.
 *
 * The gate beat explains what the four checks are; this beat shows where they sit.
 *
 * Timing mirrors the tokens (WAAPI cannot read CSS custom properties, so the values
 * are repeated): --duration-normal 480ms, --ease-out cubic-bezier(0.16, 1, 0.3, 1),
 * --stagger 80ms.
 */
import { defineSegment } from "videowright";
import diagram from "../../media/architecture.png";

let host: HTMLElement | null = null;

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const ENTRY_MS = 480;
const STAGGER_MS = 80;

/** Every animated element is addressed by data-ref so play() never guesses. */
function ref(name: string): HTMLElement {
	const el = host?.querySelector(`[data-ref="${name}"]`);
	if (!el) throw new Error(`scopepay-architecture: missing [data-ref="${name}"]`);
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

export default defineSegment({
	id: "scopepay-architecture",
	// Sized from this segment's own narration at ~14 characters per second plus a
	// holding beat. Replace with the synthesized audio's real timestamps.
	advances: [22],
	voiceover:
		"Here is the whole trust boundary. The browser holds only publishable configuration. The server owns the catalog, the pricing and the gate, and it holds the credentials. PayPal alone decides whether money moved. The model proposes; it never pays.",

	mount(el) {
		host = el;
		el.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
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
        ">Architecture · every box is built</p>

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
        ">Where the trust boundary sits</h1>

        <div style="
          display: flex;
          align-items: flex-start;
          gap: var(--space-lg);
          margin: var(--space-md) 0 0;
          flex: 1 1 auto;
        ">
          <div style="flex: 0 0 940px; display: flex; flex-direction: column;">
            <figure data-ref="figure" style="
              margin: 0;
              height: 500px;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: var(--space-sm);
              background: var(--color-surface);
              border: var(--rule-weight) solid var(--color-border);
              border-radius: var(--radius-sm);
              opacity: 0;
            ">
              <img src="${diagram}" alt="ScopePay architecture: browser, server and deterministic gate, PayPal sandbox, CSCS Apertus model and durable scope and payment state, with trust boundaries marked" style="
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                display: block;
              " />
            </figure>
            <figcaption data-ref="caption" style="
              margin: var(--space-sm) 0 0;
              font-family: var(--font-mono);
              font-size: 18px;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              color: var(--color-muted);
              opacity: 0;
            ">docs/architecture.png</figcaption>
          </div>

          <div style="flex: 1 1 auto; padding-top: var(--space-sm);">
            <p data-ref="body" style="
              margin: 0;
              max-width: 660px;
              font-size: 36px;
              line-height: 1.4;
              opacity: 0;
            ">The browser holds only publishable configuration. The server owns the
            catalog, pricing and the gate, and holds the credentials. PayPal alone
            decides whether money moved.</p>

            <p data-ref="note" style="
              margin: var(--space-lg) 0 0;
              max-width: 660px;
              font-size: 32px;
              line-height: 1.4;
              color: var(--color-muted);
              opacity: 0;
            ">The model proposes. It <span style="color: var(--color-accent)">never pays</span>.</p>
          </div>
        </div>
      </div>
    `;
	},

	async play(ctx) {
		enter(ref("label"), 0);
		enter(ref("headline"), 120);
		enter(ref("figure"), 240);
		enter(ref("caption"), 240 + STAGGER_MS);
		enter(ref("body"), 240 + 2 * STAGGER_MS);
		enter(ref("note"), 240 + 3 * STAGGER_MS);

		await ctx.waitForNext(); // The one beat: the whole diagram is on screen and readable
	},

	unmount() {
		host = null;
	},
});
