import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFileStore } from '../../lib/store-file.js';
import { createMemoryStore } from '../../lib/store-memory.js';
import type { Store } from '../../lib/persistence.js';
import type { Brief, EventRecord, PaymentAttempt, ScopeVersion } from '../../lib/schemas.js';

const tempFiles: string[] = [];

function tempStorePath(): string {
  const path = join(tmpdir(), `scopepay-store-${randomUUID()}.json`);
  tempFiles.push(path);
  return path;
}

afterAll(async () => {
  await Promise.all(tempFiles.map((path) => rm(path, { force: true })));
});

function makeBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    id: `brief-${randomUUID()}`,
    textHash: 'a'.repeat(64),
    canonicalText: 'A five page marketing site for a bakery.',
    submittedBy: 'client@example.test',
    createdAt: '2026-10-13T10:00:00.000Z',
    ...overrides
  };
}

function makeScope(overrides: Partial<ScopeVersion> = {}): ScopeVersion {
  return {
    id: `scope-${randomUUID()}`,
    parentId: null,
    briefId: 'brief-1',
    version: 1,
    catalogVersion: 'catalog-2026-10-13',
    lines: [
      {
        catalogItemId: 'landing-page',
        quantity: 1,
        sourceSpan: { start: 0, end: 11, quote: 'A five page' },
        rationale: 'Brief asks for a marketing page.'
      }
    ],
    exclusions: ['Copywriting from scratch is not included.'],
    revisionLimit: 2,
    amountMinor: 45000,
    currency: 'USD',
    hash: 'b'.repeat(64),
    status: 'awaiting_buyer',
    createdBy: 'merchant@example.test',
    createdAt: '2026-10-13T10:05:00.000Z',
    reviewedBy: null,
    reviewedAt: null,
    reviewAction: null,
    reviewNote: null,
    ...overrides
  };
}

function makeAttempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  return {
    id: `attempt-${randomUUID()}`,
    scopeId: 'scope-1',
    scopeHash: 'b'.repeat(64),
    expectedAmountMinor: 45000,
    expectedCurrency: 'USD',
    merchantId: 'sandbox-merchant-1',
    requestKey: `key-${randomUUID()}`,
    paypalOrderId: null,
    captureId: null,
    providerStatus: null,
    state: 'created',
    approvalUrl: null,
    createdAt: '2026-10-13T10:10:00.000Z',
    updatedAt: '2026-10-13T10:10:00.000Z',
    providerAmountMinor: null,
    providerCurrency: null,
    lastError: null,
    ...overrides
  };
}

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    eventId: `WH-${randomUUID()}`,
    eventType: 'CHECKOUT.ORDER.APPROVED',
    resourceId: 'ORDER-1',
    verificationState: 'verified',
    receivedAt: '2026-10-13T10:15:00.000Z',
    processedState: 'applied',
    note: '',
    ...overrides
  };
}

function runStoreSuite(name: string, makeStore: () => Store) {
  describe(name, () => {
    let store: Store = makeStore();

    beforeEach(() => {
      store = makeStore();
    });

    it('inserts a scope once and rejects a duplicate id', async () => {
      const scope = makeScope();
      await store.insertScope(scope);
      await expect(store.insertScope(scope)).rejects.toThrow(`scope_exists:${scope.id}`);
      expect(await store.getScope(scope.id)).toEqual(scope);
    });

    it('patches only the status lifecycle fields', async () => {
      const scope = makeScope();
      await store.insertScope(scope);

      const patched = await store.patchScopeStatus(scope.id, {
        status: 'accepted',
        reviewedBy: 'merchant@example.test',
        reviewedAt: '2026-10-13T11:00:00.000Z',
        reviewAction: 'edit',
        reviewNote: 'Trimmed to one landing page.'
      });

      expect(patched.status).toBe('accepted');
      expect(patched.reviewedBy).toBe('merchant@example.test');
      expect(patched.reviewNote).toBe('Trimmed to one landing page.');
      expect(patched.amountMinor).toBe(scope.amountMinor);
      expect(patched.lines).toEqual(scope.lines);

      const stored = await store.getScope(scope.id);
      expect(stored?.status).toBe('accepted');
    });

    it('rejects a status patch for an unknown scope', async () => {
      await expect(store.patchScopeStatus('missing-scope', { status: 'accepted' })).rejects.toThrow(
        'scope_not_found:missing-scope'
      );
    });

    it('orders scope versions and reports the latest', async () => {
      const briefId = `brief-${randomUUID()}`;
      await store.insertScope(makeScope({ id: 'v2', briefId, version: 2 }));
      await store.insertScope(makeScope({ id: 'v1', briefId, version: 1 }));

      const list = await store.listScopesForBrief(briefId);
      expect(list.map((scope) => scope.version)).toEqual([1, 2]);
      expect((await store.latestScopeForBrief(briefId))?.id).toBe('v2');
      expect(await store.latestScopeForBrief('no-such-brief')).toBeNull();
    });

    it('rejects a duplicate payment request key', async () => {
      const requestKey = 'request-key-fixed';
      await store.insertPaymentAttempt(makeAttempt({ requestKey }));
      await expect(store.insertPaymentAttempt(makeAttempt({ requestKey }))).rejects.toThrow(
        `attempt_exists:${requestKey}`
      );
      expect(await store.findPaymentAttemptByRequestKey(requestKey)).not.toBeNull();
    });

    it('updates an existing attempt and refuses an unknown one', async () => {
      const attempt = makeAttempt({ scopeId: 'scope-9' });
      await store.insertPaymentAttempt(attempt);
      await store.updatePaymentAttempt({ ...attempt, state: 'captured', captureId: 'CAP-1' });

      const stored = await store.getPaymentAttempt(attempt.id);
      expect(stored?.state).toBe('captured');
      expect(stored?.captureId).toBe('CAP-1');
      expect((await store.listPaymentAttemptsForScope('scope-9')).length).toBe(1);

      await expect(store.updatePaymentAttempt(makeAttempt())).rejects.toThrow('attempt_not_found:');
    });

    it('treats a repeated webhook event id as a no-op', async () => {
      const event = makeEvent();
      await store.saveEvent(event);
      await store.saveEvent({ ...event, processedState: 'duplicate' });

      const stored = await store.getEvent(event.eventId);
      expect(stored?.processedState).toBe('applied');
      expect((await store.listEvents(10)).length).toBe(1);
    });

    it('limits and orders the event log newest first', async () => {
      await store.saveEvent(makeEvent({ eventId: 'WH-1', receivedAt: '2026-10-13T10:00:00.000Z' }));
      await store.saveEvent(makeEvent({ eventId: 'WH-2', receivedAt: '2026-10-13T10:05:00.000Z' }));
      await store.saveEvent(makeEvent({ eventId: 'WH-3', receivedAt: '2026-10-13T10:02:00.000Z' }));

      const events = await store.listEvents(2);
      expect(events.map((event) => event.eventId)).toEqual(['WH-2', 'WH-3']);
      expect(await store.listEvents(0)).toEqual([]);
    });

    it('finds the newest brief for a text hash', async () => {
      const older = makeBrief({ id: 'brief-old', createdAt: '2026-10-13T09:00:00.000Z' });
      const newer = makeBrief({ id: 'brief-new', createdAt: '2026-10-13T12:00:00.000Z' });
      await store.createBrief(older);
      await store.createBrief(newer);

      const found = await store.findBriefByTextHash(older.textHash);
      expect(found?.id).toBe('brief-new');
      expect(await store.findBriefByTextHash('c'.repeat(64))).toBeNull();
    });

    it('returns copies rather than live references', async () => {
      const scope = makeScope();
      await store.insertScope(scope);

      const first = await store.getScope(scope.id);
      if (!first) throw new Error('scope missing');
      first.amountMinor = 1;
      first.lines = [];
      first.exclusions.push('mutated');

      const second = await store.getScope(scope.id);
      expect(second?.amountMinor).toBe(scope.amountMinor);
      expect(second?.lines).toEqual(scope.lines);
      expect(second?.exclusions).toEqual(scope.exclusions);
    });

    it('stores an acceptance per scope', async () => {
      await store.saveAcceptance({
        id: 'accept-1',
        scopeId: 'scope-1',
        hash: 'b'.repeat(64),
        actor: 'client@example.test',
        acceptedAt: '2026-10-13T11:30:00.000Z',
        confirmedAmountMinor: 45000,
        confirmedCurrency: 'USD'
      });

      const stored = await store.getAcceptance('scope-1');
      expect(stored?.confirmedAmountMinor).toBe(45000);
      expect(await store.getAcceptance('scope-other')).toBeNull();
    });
  });
}

runStoreSuite('memory store', createMemoryStore);
runStoreSuite('file store', () => createFileStore(tempStorePath()));

describe('d1 migration', () => {
  it('creates every table the adapter reads and writes', async () => {
    const sql = await readFile(join(process.cwd(), 'migrations', '0001_init.sql'), 'utf8');
    for (const table of [
      'briefs',
      'scope_versions',
      'acceptances',
      'payment_attempts',
      'events'
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain('request_key TEXT NOT NULL UNIQUE');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
  });
});
