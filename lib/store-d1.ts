import type { Acceptance, Brief, EventRecord, PaymentAttempt, ScopeLine, ScopeVersion } from './schemas.js';
import type { D1Like, ScopeStatusPatch, Store } from './persistence.js';

interface BriefRow {
  id: string;
  submitted_by: string;
  canonical_text: string;
  text_hash: string;
  created_at: string;
}

interface ScopeRow {
  id: string;
  parent_id: string | null;
  brief_id: string;
  version: number;
  catalog_version: string;
  lines: string;
  exclusions: string;
  revision_limit: number | null;
  amount_minor: number;
  currency: string;
  hash: string;
  status: string;
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_action: string | null;
  review_note: string | null;
}

interface AcceptanceRow {
  id: string;
  scope_id: string;
  hash: string;
  actor: string;
  accepted_at: string;
  confirmed_amount_minor: number;
  confirmed_currency: string;
}

interface AttemptRow {
  id: string;
  scope_id: string;
  scope_hash: string;
  expected_amount_minor: number;
  expected_currency: string;
  merchant_id: string;
  request_key: string;
  paypal_order_id: string | null;
  capture_id: string | null;
  provider_status: string | null;
  state: string;
  approval_url: string | null;
  created_at: string;
  updated_at: string;
  provider_amount_minor: number | null;
  provider_currency: string | null;
  last_error: string | null;
}

interface EventRow {
  event_id: string;
  event_type: string;
  resource_id: string;
  verification_state: string;
  received_at: string;
  processed_state: string;
  note: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toBrief(row: BriefRow): Brief {
  return {
    id: row.id,
    textHash: row.text_hash,
    canonicalText: row.canonical_text,
    submittedBy: row.submitted_by,
    createdAt: row.created_at
  };
}

function toScope(row: ScopeRow): ScopeVersion {
  return {
    id: row.id,
    parentId: row.parent_id,
    briefId: row.brief_id,
    version: row.version,
    catalogVersion: row.catalog_version,
    lines: parseJson<ScopeLine[]>(row.lines, []),
    exclusions: parseJson<string[]>(row.exclusions, []),
    revisionLimit: row.revision_limit,
    amountMinor: row.amount_minor,
    currency: row.currency as ScopeVersion['currency'],
    hash: row.hash,
    status: row.status as ScopeVersion['status'],
    createdBy: row.created_by,
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewAction: row.review_action as ScopeVersion['reviewAction'],
    reviewNote: row.review_note
  };
}

function toAcceptance(row: AcceptanceRow): Acceptance {
  return {
    id: row.id,
    scopeId: row.scope_id,
    hash: row.hash,
    actor: row.actor,
    acceptedAt: row.accepted_at,
    confirmedAmountMinor: row.confirmed_amount_minor,
    confirmedCurrency: row.confirmed_currency as Acceptance['confirmedCurrency']
  };
}

function toAttempt(row: AttemptRow): PaymentAttempt {
  return {
    id: row.id,
    scopeId: row.scope_id,
    scopeHash: row.scope_hash,
    expectedAmountMinor: row.expected_amount_minor,
    expectedCurrency: row.expected_currency as PaymentAttempt['expectedCurrency'],
    merchantId: row.merchant_id,
    requestKey: row.request_key,
    paypalOrderId: row.paypal_order_id,
    captureId: row.capture_id,
    providerStatus: row.provider_status,
    state: row.state as PaymentAttempt['state'],
    approvalUrl: row.approval_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    providerAmountMinor: row.provider_amount_minor,
    providerCurrency: row.provider_currency,
    lastError: row.last_error
  };
}

function toEvent(row: EventRow): EventRecord {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    resourceId: row.resource_id,
    verificationState: row.verification_state as EventRecord['verificationState'],
    receivedAt: row.received_at,
    processedState: row.processed_state as EventRecord['processedState'],
    note: row.note
  };
}

const INSERT_SCOPE = `INSERT INTO scope_versions (
  id, parent_id, brief_id, version, catalog_version, lines, exclusions, revision_limit,
  amount_minor, currency, hash, status, created_by, created_at,
  reviewed_by, reviewed_at, review_action, review_note
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_ATTEMPT = `INSERT INTO payment_attempts (
  id, scope_id, scope_hash, expected_amount_minor, expected_currency, merchant_id, request_key,
  paypal_order_id, capture_id, provider_status, state, approval_url, created_at, updated_at,
  provider_amount_minor, provider_currency, last_error
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPDATE_ATTEMPT = `UPDATE payment_attempts SET
  scope_id = ?, scope_hash = ?, expected_amount_minor = ?, expected_currency = ?, merchant_id = ?,
  request_key = ?, paypal_order_id = ?, capture_id = ?, provider_status = ?, state = ?,
  approval_url = ?, created_at = ?, updated_at = ?, provider_amount_minor = ?, provider_currency = ?,
  last_error = ?
WHERE id = ?`;

function attemptParams(attempt: PaymentAttempt): unknown[] {
  return [
    attempt.scopeId,
    attempt.scopeHash,
    attempt.expectedAmountMinor,
    attempt.expectedCurrency,
    attempt.merchantId,
    attempt.requestKey,
    attempt.paypalOrderId,
    attempt.captureId,
    attempt.providerStatus,
    attempt.state,
    attempt.approvalUrl,
    attempt.createdAt,
    attempt.updatedAt,
    attempt.providerAmountMinor,
    attempt.providerCurrency,
    attempt.lastError
  ];
}

/** Durable adapter for the hosted deployment. Requires migrations/0001_init.sql applied. */
export function createD1Store(db: D1Like): Store {
  return {
    async createBrief(brief) {
      await db
        .prepare(
          `INSERT INTO briefs (id, submitted_by, canonical_text, text_hash, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET submitted_by = excluded.submitted_by,
             canonical_text = excluded.canonical_text, text_hash = excluded.text_hash,
             created_at = excluded.created_at`
        )
        .bind(brief.id, brief.submittedBy, brief.canonicalText, brief.textHash, brief.createdAt)
        .run();
    },

    async getBrief(id) {
      const row = await db.prepare('SELECT * FROM briefs WHERE id = ?').bind(id).first<BriefRow>();
      return row ? toBrief(row) : null;
    },

    async findBriefByTextHash(textHash) {
      const row = await db
        .prepare('SELECT * FROM briefs WHERE text_hash = ? ORDER BY created_at DESC, id DESC LIMIT 1')
        .bind(textHash)
        .first<BriefRow>();
      return row ? toBrief(row) : null;
    },

    async insertScope(scope) {
      const existing = await db
        .prepare('SELECT id FROM scope_versions WHERE id = ?')
        .bind(scope.id)
        .first<{ id: string }>();
      if (existing) throw new Error(`scope_exists:${scope.id}`);
      await db
        .prepare(INSERT_SCOPE)
        .bind(
          scope.id,
          scope.parentId,
          scope.briefId,
          scope.version,
          scope.catalogVersion,
          JSON.stringify(scope.lines),
          JSON.stringify(scope.exclusions),
          scope.revisionLimit,
          scope.amountMinor,
          scope.currency,
          scope.hash,
          scope.status,
          scope.createdBy,
          scope.createdAt,
          scope.reviewedBy,
          scope.reviewedAt,
          scope.reviewAction,
          scope.reviewNote
        )
        .run();
    },

    async getScope(id) {
      const row = await db
        .prepare('SELECT * FROM scope_versions WHERE id = ?')
        .bind(id)
        .first<ScopeRow>();
      return row ? toScope(row) : null;
    },

    async listScopesForBrief(briefId) {
      const { results } = await db
        .prepare('SELECT * FROM scope_versions WHERE brief_id = ? ORDER BY version ASC, id ASC')
        .bind(briefId)
        .all<ScopeRow>();
      return (results ?? []).map(toScope);
    },

    async latestScopeForBrief(briefId) {
      const row = await db
        .prepare('SELECT * FROM scope_versions WHERE brief_id = ? ORDER BY version DESC LIMIT 1')
        .bind(briefId)
        .first<ScopeRow>();
      return row ? toScope(row) : null;
    },

    async patchScopeStatus(id, patch: ScopeStatusPatch) {
      const row = await db
        .prepare('SELECT * FROM scope_versions WHERE id = ?')
        .bind(id)
        .first<ScopeRow>();
      if (!row) throw new Error(`scope_not_found:${id}`);
      const current = toScope(row);
      const next: ScopeVersion = {
        ...current,
        status: patch.status,
        reviewedBy: patch.reviewedBy !== undefined ? patch.reviewedBy : current.reviewedBy,
        reviewedAt: patch.reviewedAt !== undefined ? patch.reviewedAt : current.reviewedAt,
        reviewAction: patch.reviewAction !== undefined ? patch.reviewAction : current.reviewAction,
        reviewNote: patch.reviewNote !== undefined ? patch.reviewNote : current.reviewNote
      };
      await db
        .prepare(
          `UPDATE scope_versions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_action = ?, review_note = ?
           WHERE id = ?`
        )
        .bind(next.status, next.reviewedBy, next.reviewedAt, next.reviewAction, next.reviewNote, id)
        .run();
      return next;
    },

    async saveAcceptance(acceptance) {
      await db
        .prepare(
          `INSERT INTO acceptances (id, scope_id, hash, actor, accepted_at, confirmed_amount_minor, confirmed_currency)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(scope_id) DO UPDATE SET hash = excluded.hash, actor = excluded.actor,
             accepted_at = excluded.accepted_at, confirmed_amount_minor = excluded.confirmed_amount_minor,
             confirmed_currency = excluded.confirmed_currency`
        )
        .bind(
          acceptance.id,
          acceptance.scopeId,
          acceptance.hash,
          acceptance.actor,
          acceptance.acceptedAt,
          acceptance.confirmedAmountMinor,
          acceptance.confirmedCurrency
        )
        .run();
    },

    async getAcceptance(scopeId) {
      const row = await db
        .prepare('SELECT * FROM acceptances WHERE scope_id = ?')
        .bind(scopeId)
        .first<AcceptanceRow>();
      return row ? toAcceptance(row) : null;
    },

    async insertPaymentAttempt(attempt) {
      const existing = await db
        .prepare('SELECT request_key FROM payment_attempts WHERE request_key = ? OR id = ?')
        .bind(attempt.requestKey, attempt.id)
        .first<{ request_key: string }>();
      if (existing) throw new Error(`attempt_exists:${attempt.requestKey}`);
      await db.prepare(INSERT_ATTEMPT).bind(attempt.id, ...attemptParams(attempt)).run();
    },

    async updatePaymentAttempt(attempt) {
      const existing = await db
        .prepare('SELECT id FROM payment_attempts WHERE id = ?')
        .bind(attempt.id)
        .first<{ id: string }>();
      if (!existing) throw new Error(`attempt_not_found:${attempt.id}`);
      await db.prepare(UPDATE_ATTEMPT).bind(...attemptParams(attempt), attempt.id).run();
    },

    async getPaymentAttempt(id) {
      const row = await db
        .prepare('SELECT * FROM payment_attempts WHERE id = ?')
        .bind(id)
        .first<AttemptRow>();
      return row ? toAttempt(row) : null;
    },

    async findPaymentAttemptByRequestKey(requestKey) {
      const row = await db
        .prepare('SELECT * FROM payment_attempts WHERE request_key = ?')
        .bind(requestKey)
        .first<AttemptRow>();
      return row ? toAttempt(row) : null;
    },

    async findPaymentAttemptByOrderId(paypalOrderId) {
      const row = await db
        .prepare('SELECT * FROM payment_attempts WHERE paypal_order_id = ? ORDER BY created_at ASC, id ASC LIMIT 1')
        .bind(paypalOrderId)
        .first<AttemptRow>();
      return row ? toAttempt(row) : null;
    },

    async listPaymentAttemptsForScope(scopeId) {
      const { results } = await db
        .prepare('SELECT * FROM payment_attempts WHERE scope_id = ? ORDER BY created_at ASC, id ASC')
        .bind(scopeId)
        .all<AttemptRow>();
      return (results ?? []).map(toAttempt);
    },

    async saveEvent(event) {
      await db
        .prepare(
          `INSERT INTO events (event_id, event_type, resource_id, verification_state, received_at, processed_state, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id) DO NOTHING`
        )
        .bind(
          event.eventId,
          event.eventType,
          event.resourceId,
          event.verificationState,
          event.receivedAt,
          event.processedState,
          event.note
        )
        .run();
    },

    async getEvent(eventId) {
      const row = await db
        .prepare('SELECT * FROM events WHERE event_id = ?')
        .bind(eventId)
        .first<EventRow>();
      return row ? toEvent(row) : null;
    },

    async listEvents(limit) {
      const { results } = await db
        .prepare('SELECT * FROM events ORDER BY received_at DESC, event_id DESC LIMIT ?')
        .bind(Math.max(0, limit))
        .all<EventRow>();
      return (results ?? []).map(toEvent);
    }
  };
}
