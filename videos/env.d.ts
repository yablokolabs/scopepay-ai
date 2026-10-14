/**
 * Ambient declarations for asset imports used by timelines and segments.
 *
 * A Videowright timeline imports its style sheet for its side effects
 * (`import "../../styles/<slug>/tokens.css"`). Vite handles that at runtime, but
 * TypeScript has no idea what a `.css` specifier is, so `tsc --noEmit` failed with
 * TS2882 for every timeline in this project. The install tsconfig that ships with
 * videowright includes no declaration for it.
 */
declare module "*.css";

/**
 * Segment media: screenshots of the running app, imported as modules so Vite
 * resolves them to a URL the render server can serve (`/@fs/…`) instead of a path
 * that would resolve against the render entry's own directory.
 */
declare module "*.png" {
	const url: string;
	export default url;
}
