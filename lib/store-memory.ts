import type { Acceptance, Brief, EventRecord, PaymentAttempt, ScopeVersion } from './schemas.js';
import type { ScopeStatusPatch, Store } from './persistence.js';

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

export function createMemoryStore(): Store {
  const briefs = new Map<string, Brief>();
  const scopes = new Map<string, ScopeVersion>();
  const acceptances = new Map<string, Acceptance>();
  const attempts = new Map<string, PaymentAttempt>();
  const events = new Map<string, EventRecord>();

  return {
    async createBrief(brief) {
      briefs.set(brief.id, clone(brief));
    },

    async getBrief(id) {
      const found = briefs.get(id);
      return found ? clone(found) : null;
    },

    async findBriefByTextHash(textHash) {
      const matches = [...briefs.values()]
        .filter((brief) => brief.textHash === textHash)
        .sort((a, b) => newestFirst(a.createdAt, b.createdAt) || newestFirst(a.id, b.id));
      const newest = matches[0];
      return newest ? clone(newest) : null;
    },

    async insertScope(scope) {
      if (scopes.has(scope.id)) throw new Error(`scope_exists:${scope.id}`);
      scopes.set(scope.id, clone(scope));
    },

    async getScope(id) {
      const found = scopes.get(id);
      return found ? clone(found) : null;
    },

    async listScopesForBrief(briefId) {
      return [...scopes.values()]
        .filter((scope) => scope.briefId === briefId)
        .sort((a, b) => a.version - b.version || oldestFirst(a.id, b.id))
        .map(clone);
    },

    async latestScopeForBrief(briefId) {
      const list = [...scopes.values()].filter((scope) => scope.briefId === briefId);
      if (list.length === 0) return null;
      const newest = list.reduce((acc, scope) => (scope.version > acc.version ? scope : acc));
      return clone(newest);
    },

    async patchScopeStatus(id, patch) {
      const found = scopes.get(id);
      if (!found) throw new Error(`scope_not_found:${id}`);
      const next = applyStatusPatch(found, patch);
      scopes.set(id, next);
      return clone(next);
    },

    async saveAcceptance(acceptance) {
      acceptances.set(acceptance.scopeId, clone(acceptance));
    },

    async getAcceptance(scopeId) {
      const found = acceptances.get(scopeId);
      return found ? clone(found) : null;
    },

    async insertPaymentAttempt(attempt) {
      for (const existing of attempts.values()) {
        if (existing.requestKey === attempt.requestKey) {
          throw new Error(`attempt_exists:${attempt.requestKey}`);
        }
      }
      if (attempts.has(attempt.id)) throw new Error(`attempt_exists:${attempt.id}`);
      attempts.set(attempt.id, clone(attempt));
    },

    async updatePaymentAttempt(attempt) {
      if (!attempts.has(attempt.id)) throw new Error(`attempt_not_found:${attempt.id}`);
      attempts.set(attempt.id, clone(attempt));
    },

    async getPaymentAttempt(id) {
      const found = attempts.get(id);
      return found ? clone(found) : null;
    },

    async findPaymentAttemptByRequestKey(requestKey) {
      const found = [...attempts.values()].find((attempt) => attempt.requestKey === requestKey);
      return found ? clone(found) : null;
    },

    async findPaymentAttemptByOrderId(paypalOrderId) {
      const found = [...attempts.values()]
        .filter((attempt) => attempt.paypalOrderId === paypalOrderId)
        .sort((a, b) => oldestFirst(a.createdAt, b.createdAt) || oldestFirst(a.id, b.id))[0];
      return found ? clone(found) : null;
    },

    async listPaymentAttemptsForScope(scopeId) {
      return [...attempts.values()]
        .filter((attempt) => attempt.scopeId === scopeId)
        .sort((a, b) => oldestFirst(a.createdAt, b.createdAt) || oldestFirst(a.id, b.id))
        .map(clone);
    },

    async saveEvent(event) {
      if (events.has(event.eventId)) return;
      events.set(event.eventId, clone(event));
    },

    async getEvent(eventId) {
      const found = events.get(eventId);
      return found ? clone(found) : null;
    },

    async listEvents(limit) {
      return [...events.values()]
        .sort((a, b) => newestFirst(a.receivedAt, b.receivedAt) || newestFirst(a.eventId, b.eventId))
        .slice(0, Math.max(0, limit))
        .map(clone);
    }
  };
}
