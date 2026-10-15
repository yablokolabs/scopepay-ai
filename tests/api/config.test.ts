/**
 * Tests for the PayPal return/cancel base URL.
 *
 * Found by the real M2 run: the base URL defaulted to this API process's own
 * origin, which serves no `/checkout/*` route, so approving the order returned the
 * buyer's browser to a 404 and the client's `/checkout/return` capture never ran.
 * The order itself was fine — only the origin was wrong.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_ORIGIN, resolvePublicBaseUrl } from '../../server/config.js';

describe('public base URL', () => {
  it('falls back to the client origin, never to the API process, when nothing is configured', () => {
    const resolved = resolvePublicBaseUrl(undefined, 8790);
    expect(resolved.url).toBe(DEFAULT_APP_ORIGIN);
    expect(resolved.url).not.toBe('http://localhost:8790');
    // The fallback is a local convenience, so it must say so rather than look configured.
    expect(resolved.warning).toContain('PUBLIC_BASE_URL');
  });

  it('treats an empty or whitespace value as unset', () => {
    expect(resolvePublicBaseUrl('', 8790).url).toBe(DEFAULT_APP_ORIGIN);
    expect(resolvePublicBaseUrl('   ', 8790).url).toBe(DEFAULT_APP_ORIGIN);
  });

  it('uses an explicitly configured origin as given, without a warning', () => {
    const resolved = resolvePublicBaseUrl('https://scopepay.example.workers.dev', 8790);
    expect(resolved.url).toBe('https://scopepay.example.workers.dev');
    expect(resolved.warning).toBeNull();
  });

  it('strips a trailing slash so built URLs have one separator', () => {
    expect(resolvePublicBaseUrl('https://scopepay.example.workers.dev/', 8790).url).toBe(
      'https://scopepay.example.workers.dev'
    );
  });

  it('warns when the configured origin is the API process itself, which cannot serve the return route', () => {
    for (const value of ['http://localhost:8790', 'http://localhost:8790/', 'http://127.0.0.1:8790']) {
      const resolved = resolvePublicBaseUrl(value, 8790);
      expect(resolved.url).toBe(value.replace(/\/+$/, ''));
      expect(resolved.warning).toContain('/checkout/return');
    }
  });

  it('does not warn about a different port that happens to be local', () => {
    expect(resolvePublicBaseUrl('http://localhost:8787', 8790).warning).toBeNull();
  });
});
