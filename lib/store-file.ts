import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Acceptance, Brief, EventRecord, PaymentAttempt, ScopeVersion } from './schemas.js';
import type { ScopeStatusPatch, Store } from './persistence.js';

interface StoreDocument {
  briefs: Brief[];
  scopes: ScopeVersion[];
  acceptances: Acceptance[];
  attempts: PaymentAttempt[];
  events: EventRecord[];
}

function emptyDocument(): StoreDocument {
  return { briefs: [], scopes: [], acceptances: [], attempts: [], events: [] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function newestFirst(a: string, b: string): number {
  return a === b ? 0 : a < b ? 1 : -1;
}

function oldestFirst(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function applyStatusPatch(scope: ScopeVersion, patch: ScopeStatusPatch): ScopeVersion {
  const next: ScopeVersion = { ...scope, status: patch.status };
  if (patch.reviewedBy !== undefined) next.reviewedBy = patch.reviewedBy;
  if (patch.reviewedAt !== undefined) next.reviewedAt = patch.reviewedAt;
  if (patch.reviewAction !== undefined) next.reviewAction = patch.reviewAction;
  if (patch.reviewNote !== undefined) next.reviewNote = patch.reviewNote;
  return next;
}

/**
 * Local development adapter. The hosted deployment uses D1; this single JSON
 * document exists so a developer can run the app end to end on one machine.
 */
export function createFileStore(path?: string): Store {
  const filePath = path ?? process.env.SCOPEPAY_STORE_FILE ?? '.data/scopepay-store.json';
  let state: StoreDocument | null = null;
  let writeQueue: Promise<void> = Promise.resolve();

  async function load(): Promise<StoreDocument> {
    if (state) return state;
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreDocument>;
      state = {
        briefs: parsed.briefs ?? [],
        scopes: parsed.scopes ?? [],
        acceptances: parsed.acceptances ?? [],
        attempts: parsed.attempts ?? [],
        events: parsed.events ?? []
      };
    } catch {
      state = emptyDocument();
    }
    return state;
  }

  async function persist(next: StoreDocument): Promise<void> {
    const payload = JSON.stringify(next, null, 2);
    writeQueue = writeQueue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      await writeFile(tmpPath, payload, 'utf8');
      await rename(tmpPath, filePath);
    });
    await writeQueue;
  }

  return {
    async createBrief(brief) {
      const doc = await load();
      const index = doc.briefs.findIndex((existing) => existing.id === brief.id);
      if (index >= 0) doc.briefs[index] = clone(brief);
      else doc.briefs.push(clone(brief));
      await persist(doc);
    },

    async getBrief(id) {
      const doc = await load();
      const found = doc.briefs.find((brief) => brief.id === id);
      return found ? clone(found) : null;
    },

    async findBriefByTextHash(textHash) {
      const doc = await load();
      const matches = doc.briefs
        .filter((brief) => brief.textHash === textHash)
        .sort((a, b) => newestFirst(a.createdAt, b.createdAt) || newestFirst(a.id, b.id));
      const newest = matches[0];
      return newest ? clone(newest) : null;
    },

    async insertScope(scope) {
      const doc = await load();
      if (doc.scopes.some((existing) => existing.id === scope.id)) {
        throw new Error(`scope_exists:${scope.id}`);
      }
      doc.scopes.push(clone(scope));
      await persist(doc);
    },

    async getScope(id) {
      const doc = await load();
      const found = doc.scopes.find((scope) => scope.id === id);
      return found ? clone(found) : null;
    },

    async listScopesForBrief(briefId) {
      const doc = await load();
      return doc.scopes
        .filter((scope) => scope.briefId === briefId)
        .sort((a, b) => a.version - b.version || oldestFirst(a.id, b.id))
        .map(clone);
    },

    async latestScopeForBrief(briefId) {
      const doc = await load();
      const list = doc.scopes.filter((scope) => scope.briefId === briefId);
      if (list.length === 0) return null;
      const newest = list.reduce((acc, scope) => (scope.version > acc.version ? scope : acc));
      return clone(newest);
    },

    async patchScopeStatus(id, patch) {
      const doc = await load();
      const index = doc.scopes.findIndex((scope) => scope.id === id);
      const current = doc.scopes[index];
      if (index < 0 || !current) throw new Error(`scope_not_found:${id}`);
      const next = applyStatusPatch(current, patch);
      doc.scopes[index] = next;
      await persist(doc);
      return clone(next);
    },

    async saveAcceptance(acceptance) {
      const doc = await load();
      const index = doc.acceptances.findIndex((existing) => existing.scopeId === acceptance.scopeId);
      if (index >= 0) doc.acceptances[index] = clone(acceptance);
      else doc.acceptances.push(clone(acceptance));
      await persist(doc);
    },

    async getAcceptance(scopeId) {
      const doc = await load();
      const found = doc.acceptances.find((acceptance) => acceptance.scopeId === scopeId);
      return found ? clone(found) : null;
    },

    async insertPaymentAttempt(attempt) {
      const doc = await load();
      if (doc.attempts.some((existing) => existing.requestKey === attempt.requestKey)) {
        throw new Error(`attempt_exists:${attempt.requestKey}`);
      }
      if (doc.attempts.some((existing) => existing.id === attempt.id)) {
        throw new Error(`attempt_exists:${attempt.id}`);
      }
      doc.attempts.push(clone(attempt));
      await persist(doc);
    },

    async updatePaymentAttempt(attempt) {
      const doc = await load();
      const index = doc.attempts.findIndex((existing) => existing.id === attempt.id);
      if (index < 0) throw new Error(`attempt_not_found:${attempt.id}`);
      doc.attempts[index] = clone(attempt);
      await persist(doc);
    },

    async getPaymentAttempt(id) {
      const doc = await load();
      const found = doc.attempts.find((attempt) => attempt.id === id);
      return found ? clone(found) : null;
    },

    async findPaymentAttemptByRequestKey(requestKey) {
      const doc = await load();
      const found = doc.attempts.find((attempt) => attempt.requestKey === requestKey);
      return found ? clone(found) : null;
    },

    async findPaymentAttemptByOrderId(paypalOrderId) {
      const doc = await load();
      const matches = doc.attempts
        .filter((attempt) => attempt.paypalOrderId === paypalOrderId)
        .sort((a, b) => oldestFirst(a.createdAt, b.createdAt) || oldestFirst(a.id, b.id));
      const found = matches[0];
      return found ? clone(found) : null;
    },

    async listPaymentAttemptsForScope(scopeId) {
      const doc = await load();
      return doc.attempts
        .filter((attempt) => attempt.scopeId === scopeId)
        .sort((a, b) => oldestFirst(a.createdAt, b.createdAt) || oldestFirst(a.id, b.id))
        .map(clone);
    },

    async saveEvent(event) {
      const doc = await load();
      if (doc.events.some((existing) => existing.eventId === event.eventId)) return;
      doc.events.push(clone(event));
      await persist(doc);
    },

    async getEvent(eventId) {
      const doc = await load();
      const found = doc.events.find((event) => event.eventId === eventId);
      return found ? clone(found) : null;
    },

    async listEvents(limit) {
      const doc = await load();
      return [...doc.events]
        .sort((a, b) => newestFirst(a.receivedAt, b.receivedAt) || newestFirst(a.eventId, b.eventId))
        .slice(0, Math.max(0, limit))
        .map(clone);
    }
  };
}
