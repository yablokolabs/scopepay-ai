/**
 * Store selection.
 *
 * Local development defaults to the file store. The hosted Sites/Cloudflare
 * deployment passes its D1 binding, which is the only durable option inside the
 * Worker runtime.
 */
import type { D1Like, Store } from './persistence.js';
import { createD1Store } from './store-d1.js';
import { createFileStore } from './store-file.js';
import { createMemoryStore } from './store-memory.js';

export type StoreKind = 'memory' | 'file' | 'd1';

export function createStore(options: { kind?: StoreKind; d1?: D1Like; filePath?: string } = {}): Store {
  const kind = options.kind ?? (process.env.SCOPEPAY_STORE as StoreKind | undefined) ?? 'file';
  if (kind === 'd1') {
    if (!options.d1) {
      throw new Error('SCOPEPAY_STORE=d1 requires a D1 binding.');
    }
    return createD1Store(options.d1);
  }
  if (kind === 'memory') {
    return createMemoryStore();
  }
  return createFileStore(options.filePath);
}
