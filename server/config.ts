/**
 * Public base URL resolution.
 *
 * PayPal returns the buyer's browser to the return/cancel URLs once the order is
 * approved, so those URLs have to resolve to the origin that serves the ScopePay
 * client. This API process serves only `/health` and `/api/*`, so a return URL
 * pointed at it answers 404 for the buyer and the client's own `/checkout/return`
 * route — the one that reconciles and captures — never runs.
 *
 * The webhook URL is deliberately *not* derived from this value: a webhook is a
 * server-to-server POST that has to reach the API, while these URLs are followed
 * by the buyer's browser and have to reach the client. In a single-origin
 * deployment they coincide; in the local split they are different ports.
 */

/** The Vite dev client origin (`npm run dev:web`), from `vite.config.ts`. */
export const DEFAULT_APP_ORIGIN = 'http://localhost:5173';

export interface PublicBaseUrl {
  /** Absolute origin, without a trailing slash, used to build return/cancel URLs. */
  url: string;
  /** Non-null when the resolved value cannot work for a buyer returning from PayPal. */
  warning: string | null;
}

function isApiOrigin(value: string, port: number): boolean {
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(value);
}

function apiOriginWarning(port: number): string {
  return (
    `PUBLIC_BASE_URL points at this API process, which serves no /checkout/* route. ` +
    `PayPal would return the buyer to a 404 on http://localhost:${port}/checkout/return and the ` +
    `receipt would never be fetched. Set it to the origin that serves the client (${DEFAULT_APP_ORIGIN} locally).`
  );
}

/**
 * Resolves the base URL used for PayPal return/cancel URLs.
 *
 * An explicitly configured value always wins, because the deployed client origin
 * is only known to the deployment. With nothing configured the local dev client
 * origin is used, since the API's own origin can never serve those paths.
 */
export function resolvePublicBaseUrl(explicit: string | undefined, port: number): PublicBaseUrl {
  const configured = explicit?.trim().replace(/\/+$/, '') ?? '';
  if (configured.length > 0) {
    return { url: configured, warning: isApiOrigin(configured, port) ? apiOriginWarning(port) : null };
  }
  return {
    url: DEFAULT_APP_ORIGIN,
    warning:
      `PUBLIC_BASE_URL is not set, so PayPal return/cancel URLs use the local client origin ` +
      `${DEFAULT_APP_ORIGIN}. Set it explicitly for any non-local deployment, otherwise the buyer is ` +
      `returned to a URL that only resolves on this host.`
  };
}
