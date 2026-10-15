/**
 * Per-caller limit on the routes that call the model.
 *
 * A public demo URL would otherwise let anyone spend the CSCS inference quota.
 * The app only needs "may this caller make one more model call?"; where the
 * count lives depends on the runtime: in memory for the Node server, and in
 * Cloudflare's Rate Limiting binding on Workers.
 */

/** Resolves true when the caller identified by `key` may make one more model call. */
export type ModelRateLimit = (key: string) => Promise<boolean>;

/** Fixed-window counter held in process memory. */
export function createMemoryRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): ModelRateLimit {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return async (key) => {
    const at = now();
    const current = windows.get(key);
    if (!current || at - current.start >= options.windowMs) {
      windows.set(key, { start: at, count: 1 });
      return options.limit >= 1;
    }
    current.count += 1;
    return current.count <= options.limit;
  };
}

/** The `limit()` method of a Workers Rate Limiting binding. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export function fromWorkersBinding(binding: RateLimitBinding): ModelRateLimit {
  return async (key) => (await binding.limit({ key })).success;
}
