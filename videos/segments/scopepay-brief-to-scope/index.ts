import { defineSegment } from "videowright";
import briefShot from "../../media/app/01-brief.png";

let host: HTMLElement | null = null;

/**
 * Read a value off the style's own tokens instead of copying a number, so the beat
 * follows `styles/scopepay` if its timing ever changes.
 */
function theme(name: string, fallback: string): string {
	if (host === null) return fallback;
	const value = getComputedStyle(host).getPropertyValue(name).trim();
	return value.length > 0 ? value : fallback;
}

/** Entries settle into place: fade in while drifting up 16px, then hold. */
function enter(el: HTMLElement | null, duration: number, delay: number, easing: string): void {
	el?.animate(
		[
			{ opacity: 0, transform: "translateY(16px)" },
			{ opacity: 1, transform: "translateY(0)" },
		],
		{ duration, delay, fill: "forwards", easing },
	);
}

export default defineSegment({
	id: "scopepay-brief-to-scope",
	// Beat 1 resolves at 8s with the brief on screen; beat 2 hands over to the next
	// segment at 24s. These are the only place beat timing lives, so synthesised
	// narration changes these numbers and nothing else.
	// Sized from this segment's own narration at ~14 characters per second plus a
	// holding beat. Replace with the synthesized audio's real timestamps.
	advances: [8, 26],
	voiceover:
		"It starts with the brief: five pages, copy that needs a tidy-up, and it has to work on phones. An Apertus model reads that and proposes which catalog items are in scope. It never proposes a price. The server re-prices from its own fixed catalog, and anything the model cannot justify becomes an ambiguity a human has to settle.",

	mount(el) {
		host = el;
		el.innerHTML = `
      <div style="
        display: flex;
        align-items: center;
        gap: var(--space-lg);
        height: 100%;
        box-sizing: border-box;
        padding: var(--safe-y) var(--safe-x);
        background: var(--color-bg);
        color: var(--color-fg);
        font-family: var(--font-body);
      ">
        <div style="
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: var(--space-md);
        ">
          <p data-ref="label" style="
            margin: 0;
            font-family: var(--font-mono);
            font-size: 18px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--color-muted);
            opacity: 0;
          ">Recorded app · 01 brief</p>

          <h1 data-ref="headline" style="
            margin: 0;
            font-family: var(--font-display);
            font-size: 88px;
            font-weight: 400;
            line-height: 1.05;
            opacity: 0;
          ">The brief is the input</h1>

          <p data-ref="body-one" style="
            margin: 0;
            font-size: 36px;
            line-height: 1.45;
            opacity: 0;
          ">A bakery site: five pages, copy that needs a tidy-up, and it has to work on phones.</p>

          <p data-ref="body-two" style="
            margin: 0;
            font-size: 36px;
            line-height: 1.45;
            opacity: 0;
          ">Apertus proposes which catalog items are in scope. It never proposes a price — the server re-prices from its own fixed catalog.</p>

          <p data-ref="statement" style="
            margin: 0;
            font-family: var(--font-mono);
            font-size: 32px;
            line-height: 1.5;
            letter-spacing: 0.03em;
            text-transform: uppercase;
            color: var(--color-muted);
            opacity: 0;
          ">Model proposes scope ids · <span style="color: var(--color-accent);">server sets prices</span> · anything unjustified becomes an ambiguity a human settles</p>
        </div>

        <figure style="
          flex: 0 0 50%;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
        ">
          <img
            data-ref="shot"
            src="${briefShot}"
            alt="The ScopePay brief screen, with the bakery brief typed in, as captured from the running app."
            style="
              width: 100%;
              height: auto;
              display: block;
              object-fit: contain;
              border: 1px solid var(--color-border);
              opacity: 0;
            "
          />
          <figcaption data-ref="caption" style="
            font-family: var(--font-mono);
            font-size: 16px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--color-muted);
            opacity: 0;
          ">Capture of the running app</figcaption>
        </figure>
      </div>
    `;
	},

	async play(ctx) {
		const ref = (name: string) => host?.querySelector<HTMLElement>(`[data-ref="${name}"]`) ?? null;
		const duration = Number.parseFloat(theme("--duration-normal", "480")); // 480ms
		const stagger = Number.parseFloat(theme("--stagger", "80")); // 80ms
		const easing = theme("--ease-out", "cubic-bezier(0.16, 1, 0.3, 1)");

		enter(ref("label"), duration, 0, easing);
		enter(ref("headline"), duration, stagger, easing);
		enter(ref("shot"), duration, stagger * 1.5, easing);
		enter(ref("body-one"), duration, stagger * 2, easing);
		enter(ref("body-two"), duration, stagger * 4, easing);
		enter(ref("caption"), duration, stagger * 6, easing);

		await ctx.waitForNext(); // Beat 1: the brief and the model's limit are on screen

		enter(ref("statement"), duration, 0, easing);

		await ctx.waitForNext(); // Beat 2: the statement has been read; the timeline moves on
	},

	unmount() {
		host = null;
	},
});
