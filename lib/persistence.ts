/**
 * Persistence boundary.
 *
 * The domain layer only talks to this interface. Adapters:
 *   - memory: per-process, used by tests
 *   - file:   local development, a single JSON document (never used in the Worker runtime)
 *   - d1:     durable storage for the hosted Sites/Cloudflare deployment
 *
 * Scope versions and payment state are the source of truth for money, so every
 * adapter must treat `saveScope` as insert-only and never let a caller rewrite a
 * scope that has been accepted or paid.
 */
import type {
  Acceptance,
  Brief,
  EventRecord,
  PaymentAttempt,
  ScopeStatus,
  ScopeVersion
} from './schemas.js';

export interface ScopeStatusPatch {
  status: ScopeStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewAction?: 'approve' | 'edit' | 'reject' | null;
  reviewNote?: string | null;
}

export interface Store {
  createBrief(brief: Brief): Promise<void>;
  getBrief(id: string): Promise<Brief | null>;
  findBriefByTextHash(textHash: string): Promise<Brief | null>;

  /** Insert-only. Throws if the scope id already exists. */
  insertScope(scope: ScopeVersion): Promise<void>;
  getScope(id: string): Promise<ScopeVersion | null>;
  listScopesForBrief(briefId: string): Promise<ScopeVersion[]>;
  latestScopeForBrief(briefId: string): Promise<ScopeVersion | null>;
  /** The only mutation an existing scope ever receives: its status lifecycle. */
  patchScopeStatus(id: string, patch: ScopeStatusPatch): Promise<ScopeVersion>;

  saveAcceptance(acceptance: Acceptance): Promise<void>;
  getAcceptance(scopeId: string): Promise<Acceptance | null>;

  insertPaymentAttempt(attempt: PaymentAttempt): Promise<void>;
  updatePaymentAttempt(attempt: PaymentAttempt): Promise<void>;
  getPaymentAttempt(id: string): Promise<PaymentAttempt | null>;
  findPaymentAttemptByRequestKey(requestKey: string): Promise<PaymentAttempt | null>;
  findPaymentAttemptByOrderId(paypalOrderId: string): Promise<PaymentAttempt | null>;
  listPaymentAttemptsForScope(scopeId: string): Promise<PaymentAttempt[]>;

  saveEvent(event: EventRecord): Promise<void>;
  getEvent(eventId: string): Promise<EventRecord | null>;
  listEvents(limit: number): Promise<EventRecord[]>;
}

/** Minimal structural type of the Cloudflare D1 binding we rely on. */
export interface D1LikeStatement {
  bind(...values: unknown[]): D1LikeStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(query: string): D1LikeStatement;
  exec(query: string): Promise<unknown>;
}
