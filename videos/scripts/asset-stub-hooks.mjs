/**
 * Loader hooks that let Node import a segment module.
 *
 * A segment imports its own media (`import shot from "../../media/app/…png"`) and a
 * timeline imports its style sheet. Vite resolves those to URLs; Node cannot load
 * them at all, so any tool that wants to read a segment's `advances` and
 * `voiceover` — `scripts/build-captions.mjs` does — fails with
 * `ERR_UNKNOWN_FILE_EXTENSION` before it reaches the data it wanted.
 *
 * Resolving those specifiers to an empty module keeps the segment's own code
 * intact: nothing is parsed out of source text, so the values a tool reads are the
 * values the render uses. Registrant: `register()` in `node:module`, called from the
 * script that needs it.
 */
const STUBBED = /\.(png|jpe?g|webp|avif|gif|svg|css|mp3|wav|m4a)$/i;

export async function resolve(specifier, context, nextResolve) {
	if (STUBBED.test(specifier)) {
		return { url: 'data:text/javascript,export default ""', shortCircuit: true };
	}
	return nextResolve(specifier, context);
}
