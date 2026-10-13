/**
 * Domain tests for the scope version service.
 *
 * These tests use an in-memory fake Store and a fixed clock so every
 * expectation is deterministic. No network access.
 */
import { describe, expect, it } from 'vitest';

import { CATALOG } from '../../lib/catalog.js';
import type { ScopeStatusPatch, Store } from '../../lib/persistence.js';
import { createScopeService, ScopeError } from '../../lib/scope.js';
import type {
  Acceptance,
  Brief,
  EventRecord,
  PaymentAttempt,
  ScopeLine,
  ScopeProposal,
  ScopeVersion
} from '../../lib/schemas.js';

const BRIEF_TEXT =
  'I need a five page website for my bakery. It should work on phones. I will send you the words and the photos. ' +
  'Please make it look modern. I also want people to be able to email me from the site.';

const BUYER = 'client@example.test';
const MERCHANT = 'merchant@example.test';

/** In-memory Store used only by this test file. Copies on read and write. */
class FakeStore implements Store {
  readonly briefs = new Map<string, Brief>();
  readonly scopes = new Map<string, ScopeVersion>();
  readonly acceptances = new Map<string, Acceptance>();
  readonly attempts = new Map<string, PaymentAttempt>();
  readonly events = new Map<string, EventRecord>();

  async createBrief(brief: Brief): Promise<void> {
    this.briefs.set(brief.id, structuredClone(brief));
  }
  async getBrief(id: string): Promise<Brief | null> {
    const found = this.briefs.get(id);
    return found ? structuredClone(found) : null;
  }
  async findBriefByTextHash(textHash: string): Promise<Brief | null> {
    const found = [...this.briefs.values()].find((brief) => brief.textHash === textHash);
    return found ? structuredClone(found) : null;
  }

  async insertScope(scope: ScopeVersion): Promise<void> {
    if (this.scopes.has(scope.id)) throw new Error(`scope ${scope.id} already exists`);
    this.scopes.set(scope.id, structuredClone(scope));
  }
  async getScope(id: string): Promise<ScopeVersion | null> {
    const found = this.scopes.get(id);
    return found ? structuredClone(found) : null;
  }
  async listScopesForBrief(briefId: string): Promise<ScopeVersion[]> {
    return [...this.scopes.values()]
      .filter((scope) => scope.briefId === briefId)
      .map((scope) => structuredClone(scope));
  }
  async latestScopeForBrief(briefId: string): Promise<ScopeVersion | null> {
    const scopes = await this.listScopesForBrief(briefId);
    return scopes.sort((a, b) => b.version - a.version)[0] ?? null;
  }
  async patchScopeStatus(id: string, patch: ScopeStatusPatch): Promise<ScopeVersion> {
    const scope = this.scopes.get(id);
    if (!scope) throw new Error(`scope ${id} not found`);
    const next: ScopeVersion = {
      ...scope,
      status: patch.status,
      reviewedBy: patch.reviewedBy === undefined ? scope.reviewedBy : patch.reviewedBy,
      reviewedAt: patch.reviewedAt === undefined ? scope.reviewedAt : patch.reviewedAt,
      reviewAction: patch.reviewAction === undefined ? scope.reviewAction : patch.reviewAction,
      reviewNote: patch.reviewNote === undefined ? scope.reviewNote : patch.reviewNote
    };
    this.scopes.set(id, structuredClone(next));
    return structuredClone(next);
  }

  async saveAcceptance(acceptance: Acceptance): Promise<void> {
    this.acceptances.set(acceptance.scopeId, structuredClone(acceptance));
  }
  async getAcceptance(scopeId: string): Promise<Acceptance | null> {
    const found = this.acceptances.get(scopeId);
    return found ? structuredClone(found) : null;
  }

  async insertPaymentAttempt(attempt: PaymentAttempt): Promise<void> {
    this.attempts.set(attempt.id, structuredClone(attempt));
  }
  async updatePaymentAttempt(attempt: PaymentAttempt): Promise<void> {
    this.attempts.set(attempt.id, structuredClone(attempt));
  }
  async getPaymentAttempt(id: string): Promise<PaymentAttempt | null> {
    const found = this.attempts.get(id);
    return found ? structuredClone(found) : null;
  }
  async findPaymentAttemptByRequestKey(requestKey: string): Promise<PaymentAttempt | null> {
    const found = [...this.attempts.values()].find((attempt) => attempt.requestKey === requestKey);
    return found ? structuredClone(found) : null;
  }
  async findPaymentAttemptByOrderId(paypalOrderId: string): Promise<PaymentAttempt | null> {
    const found = [...this.attempts.values()].find((attempt) => attempt.paypalOrderId === paypalOrderId);
    return found ? structuredClone(found) : null;
  }
  async listPaymentAttemptsForScope(scopeId: string): Promise<PaymentAttempt[]> {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.scopeId === scopeId)
      .map((attempt) => structuredClone(attempt));
  }

  async saveEvent(event: EventRecord): Promise<void> {
    this.events.set(event.eventId, structuredClone(event));
  }
  async getEvent(eventId: string): Promise<EventRecord | null> {
    const found = this.events.get(eventId);
    return found ? structuredClone(found) : null;
  }
  async listEvents(limit: number): Promise<EventRecord[]> {
    return [...this.events.values()].slice(0, limit).map((event) => structuredClone(event));
  }
}

function line(catalogItemId: string, quantity = 1): ScopeLine {
  return { catalogItemId, quantity, sourceSpan: null, rationale: '' };
}

/** A line that also carries an invented price, to prove the server ignores it. */
function lineWithPrice(catalogItemId: string, quantity: number, price: number): ScopeLine {
  return { ...line(catalogItemId, quantity), unitPriceMinor: price } as unknown as ScopeLine;
}

function proposal(lines: ScopeLine[], overrides: Partial<ScopeProposal> = {}): ScopeProposal {
  return { lines, exclusions: [], revisionLimit: 2, ambiguities: [], ...overrides };
}

function setup() {
  const store = new FakeStore();
  let counter = 0;
  const service = createScopeService({
    store,
    now: () => new Date('2026-10-13T10:00:00.000Z'),
    newId: (prefix) => `${prefix}-${++counter}`
  });
  return { store, service };
}

async function capture(fn: () => Promise<unknown>): Promise<ScopeError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ScopeError) return error;
    throw error;
  }
  throw new Error('Expected the call to reject with a ScopeError, but it resolved.');
}

async function createAwaitingBuyer(service: ReturnType<typeof setup>['service'], lines: ScopeLine[]) {
  const draft = await service.createDraft({ text: BRIEF_TEXT, submittedBy: MERCHANT, proposal: proposal(lines) });
  const reviewed = await service.applyMerchantReview({
    scopeId: draft.scope.id,
    review: { action: 'approve', actor: MERCHANT, note: '' }
  });
  return { draft: draft.scope, reviewed };
}

describe('createDraft', () => {
  it('creates version 1 from a valid proposal and recomputes the amount from the catalog', async () => {
    const { store, service } = setup();
    const result = await service.createDraft({
      text: BRIEF_TEXT,
      submittedBy: MERCHANT,
      proposal: proposal([line('landing-page', 1), line('copy-editing', 1)])
    });

    expect(result.reusedExisting).toBe(false);
    expect(result.scope.version).toBe(1);
    expect(result.scope.parentId).toBeNull();
    expect(result.scope.status).toBe('draft');
    expect(result.scope.catalogVersion).toBe(CATALOG.version);
    expect(result.scope.currency).toBe('USD');
    expect(result.scope.amountMinor).toBe(45000 + 12000);
    expect(result.scope.hash).toHaveLength(64);
    expect(result.scope.exclusions.join(' ')).toContain('Copywriting from scratch is not included');
    expect(store.briefs.size).toBe(1);
  });

  it('reuses the existing live version for an identical brief instead of double-charging it', async () => {
    const { store, service } = setup();
    const input = { text: BRIEF_TEXT, submittedBy: MERCHANT, proposal: proposal([line('landing-page', 1)]) };
    const first = await service.createDraft(input);
    const second = await service.createDraft(input);

    expect(second.reusedExisting).toBe(true);
    expect(second.scope.id).toBe(first.scope.id);
    expect(store.briefs.size).toBe(1);
    expect(store.scopes.size).toBe(1);
  });

  it('rejects a model line for an item the merchant does not sell and reports the reason', async () => {
    const { store, service } = setup();
    const error = await capture(() =>
      service.createDraft({
        text: BRIEF_TEXT,
        submittedBy: MERCHANT,
        proposal: proposal([line('logo-animation-3d', 1)])
      })
    );

    expect(error.code).toBe('invalid_lines');
    expect(error.details.join(' ')).toContain('Unknown catalog item "logo-animation-3d"');
    expect(store.scopes.size).toBe(0);
  });

  it('rejects a quantity outside the merchant catalog range', async () => {
    const { service } = setup();
    const error = await capture(() =>
      service.createDraft({
        text: BRIEF_TEXT,
        submittedBy: MERCHANT,
        proposal: proposal([line('content-page', 99)])
      })
    );

    expect(error.code).toBe('invalid_lines');
    expect(error.details.join(' ')).toContain('outside the catalog range');
  });
});

describe('applyMerchantReview', () => {
  it('creates version 2 from a merchant edit and ignores any price attached to the lines', async () => {
    const { store, service } = setup();
    const draft = await service.createDraft({
      text: BRIEF_TEXT,
      submittedBy: MERCHANT,
      proposal: proposal([line('landing-page', 1)])
    });

    const reviewed = await service.applyMerchantReview({
      scopeId: draft.scope.id,
      review: {
        action: 'edit',
        actor: MERCHANT,
        note: 'Removed the copywriting pass and added two content pages.',
        lines: [lineWithPrice('landing-page', 1, 1), lineWithPrice('content-page', 2, 1)]
      }
    });

    expect(reviewed.version).toBe(2);
    expect(reviewed.parentId).toBe(draft.scope.id);
    expect(reviewed.status).toBe('awaiting_buyer');
    expect(reviewed.amountMinor).toBe(45000 + 2 * 18000);
    expect(reviewed.hash).not.toBe(draft.scope.hash);
    expect(reviewed.lines.every((candidate) => !('unitPriceMinor' in candidate))).toBe(true);

    const parent = await store.getScope(draft.scope.id);
    expect(parent?.status).toBe('superseded');
  });

  it('refuses to review a version that is no longer a draft', async () => {
    const { service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);
    const error = await capture(() =>
      service.applyMerchantReview({ scopeId: reviewed.id, review: { action: 'approve', actor: MERCHANT, note: '' } })
    );

    expect(error.code).toBe('scope_not_draft');
  });

  it('rejects an edit review that carries no lines', async () => {
    const { service } = setup();
    const draft = await service.createDraft({
      text: BRIEF_TEXT,
      submittedBy: MERCHANT,
      proposal: proposal([line('landing-page', 1)])
    });
    const error = await capture(() =>
      service.applyMerchantReview({
        scopeId: draft.scope.id,
        review: { action: 'edit', actor: MERCHANT, note: '', lines: [] }
      })
    );

    expect(error.code).toBe('invalid_review');
  });

  it('marks a rejected proposal as rejected without creating a payable version', async () => {
    const { store, service } = setup();
    const draft = await service.createDraft({
      text: BRIEF_TEXT,
      submittedBy: MERCHANT,
      proposal: proposal([line('landing-page', 1)])
    });
    const rejected = await service.applyMerchantReview({
      scopeId: draft.scope.id,
      review: { action: 'reject', actor: MERCHANT, note: 'Outside the catalog.' }
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.version).toBe(1);
    expect(store.scopes.size).toBe(1);
  });
});

describe('recordAcceptance', () => {
  it('rejects a confirmed amount that does not match the authoritative total', async () => {
    const { service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);
    const error = await capture(() =>
      service.recordAcceptance({
        scopeId: reviewed.id,
        acceptance: {
          hash: reviewed.hash,
          actor: BUYER,
          confirmedAmountMinor: reviewed.amountMinor - 100,
          confirmedCurrency: 'USD'
        }
      })
    );

    expect(error.code).toBe('amount_mismatch');
    expect(error.details.join(' ')).toContain(`scopeAmountMinor=${reviewed.amountMinor}`);
  });

  it('rejects a fabricated hash', async () => {
    const { service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);
    const error = await capture(() =>
      service.recordAcceptance({
        scopeId: reviewed.id,
        acceptance: {
          hash: 'a'.repeat(64),
          actor: BUYER,
          confirmedAmountMinor: reviewed.amountMinor,
          confirmedCurrency: 'USD'
        }
      })
    );

    expect(error.code).toBe('hash_mismatch');
  });

  it('reports a stale hash when the buyer accepts a superseded version', async () => {
    const { service } = setup();
    const { draft, reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);
    const error = await capture(() =>
      service.recordAcceptance({
        scopeId: reviewed.id,
        acceptance: {
          hash: draft.hash,
          actor: BUYER,
          confirmedAmountMinor: draft.amountMinor,
          confirmedCurrency: 'USD'
        }
      })
    );

    expect(error.code).toBe('stale_scope');
  });

  it('is idempotent when the same buyer accepts the same hash twice', async () => {
    const { store, service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);
    const acceptance = {
      hash: reviewed.hash,
      actor: BUYER,
      confirmedAmountMinor: reviewed.amountMinor,
      confirmedCurrency: 'USD' as const
    };

    const first = await service.recordAcceptance({ scopeId: reviewed.id, acceptance });
    const second = await service.recordAcceptance({ scopeId: reviewed.id, acceptance });

    expect(first.acceptance.id).toBe(second.acceptance.id);
    expect(store.acceptances.size).toBe(1);
    expect(second.scope.status).toBe('accepted');
  });
});

describe('payment gating', () => {
  it('allows checkout only after buyer acceptance, then walks the version to paid', async () => {
    const { store, service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1), line('copy-editing', 1)]);

    const notAccepted = await capture(() =>
      service.assertPayable({
        scopeId: reviewed.id,
        hash: reviewed.hash,
        expectedAmountMinor: reviewed.amountMinor,
        expectedCurrency: 'USD',
        merchantId: CATALOG.merchantId
      })
    );
    expect(notAccepted.code).toBe('not_accepted');

    await service.recordAcceptance({
      scopeId: reviewed.id,
      acceptance: {
        hash: reviewed.hash,
        actor: BUYER,
        confirmedAmountMinor: reviewed.amountMinor,
        confirmedCurrency: 'USD'
      }
    });

    const payable = await service.assertPayable({
      scopeId: reviewed.id,
      hash: reviewed.hash,
      expectedAmountMinor: reviewed.amountMinor,
      expectedCurrency: 'USD',
      merchantId: CATALOG.merchantId
    });
    expect(payable.scope.status).toBe('accepted');
    expect(payable.acceptance.hash).toBe(reviewed.hash);

    const ordered = await service.markOrderCreated({ scopeId: reviewed.id });
    expect(ordered.status).toBe('order_created');

    const paid = await service.markPaid({ scopeId: reviewed.id, scopeHash: reviewed.hash });
    expect(paid.status).toBe('paid');

    const view = await service.getScopeView({ scopeId: reviewed.id });
    expect(view.scope.amountMinor).toBe(57000);
    expect(view.breakdown).toHaveLength(2);
    expect(view.acceptance?.hash).toBe(reviewed.hash);
    expect(view.history.map((version) => version.version)).toEqual([1, 2]);
    expect(store.scopes.get(reviewed.id)?.status).toBe('paid');
  });

  it('rejects a tampered checkout amount before any order can be created', async () => {
    const { service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);
    await service.recordAcceptance({
      scopeId: reviewed.id,
      acceptance: {
        hash: reviewed.hash,
        actor: BUYER,
        confirmedAmountMinor: reviewed.amountMinor,
        confirmedCurrency: 'USD'
      }
    });

    const error = await capture(() =>
      service.assertPayable({
        scopeId: reviewed.id,
        hash: reviewed.hash,
        expectedAmountMinor: 100,
        expectedCurrency: 'USD',
        merchantId: CATALOG.merchantId
      })
    );

    expect(error.code).toBe('amount_mismatch');
  });

  it('refuses to charge a paid version again', async () => {
    const { service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);
    await service.recordAcceptance({
      scopeId: reviewed.id,
      acceptance: {
        hash: reviewed.hash,
        actor: BUYER,
        confirmedAmountMinor: reviewed.amountMinor,
        confirmedCurrency: 'USD'
      }
    });
    await service.markOrderCreated({ scopeId: reviewed.id });
    await service.markPaid({ scopeId: reviewed.id, scopeHash: reviewed.hash });

    const error = await capture(() =>
      service.assertPayable({
        scopeId: reviewed.id,
        hash: reviewed.hash,
        expectedAmountMinor: reviewed.amountMinor,
        expectedCurrency: 'USD',
        merchantId: CATALOG.merchantId
      })
    );

    expect(error.code).toBe('already_paid');
  });

  it('rejects a checkout that claims a different merchant', async () => {
    const { service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);
    await service.recordAcceptance({
      scopeId: reviewed.id,
      acceptance: {
        hash: reviewed.hash,
        actor: BUYER,
        confirmedAmountMinor: reviewed.amountMinor,
        confirmedCurrency: 'USD'
      }
    });

    const error = await capture(() =>
      service.assertPayable({
        scopeId: reviewed.id,
        hash: reviewed.hash,
        expectedAmountMinor: reviewed.amountMinor,
        expectedCurrency: 'USD',
        merchantId: 'someone-else'
      })
    );

    expect(error.code).toBe('merchant_mismatch');
  });
});

describe('proposeChange', () => {
  it('creates a new draft version for a paid scope without superseding the paid version', async () => {
    const { store, service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);
    await service.recordAcceptance({
      scopeId: reviewed.id,
      acceptance: {
        hash: reviewed.hash,
        actor: BUYER,
        confirmedAmountMinor: reviewed.amountMinor,
        confirmedCurrency: 'USD'
      }
    });
    await service.markOrderCreated({ scopeId: reviewed.id });
    await service.markPaid({ scopeId: reviewed.id, scopeHash: reviewed.hash });

    const result = await service.proposeChange({
      scopeId: reviewed.id,
      changeText: 'Please also add a contact form.',
      requestedBy: BUYER,
      assessment: {
        changeClass: 'new_scope_delta',
        summary: 'Client asked for a contact form that was not in the agreed scope.',
        lines: [line('contact-form', 1)],
        exclusions: [],
        deltaAmountMinor: 999999,
        confident: true,
        modelNotes: ''
      }
    });

    expect(result.superseded).toBe(false);
    expect(result.deltaAmountMinor).toBe(22000);
    expect(result.scope.version).toBe(reviewed.version + 1);
    expect(result.scope.parentId).toBe(reviewed.id);
    expect(result.scope.status).toBe('draft');
    expect(store.scopes.get(reviewed.id)?.status).toBe('paid');
    expect(store.scopes.get(reviewed.id)?.amountMinor).toBe(reviewed.amountMinor);
  });

  it('computes the delta from the catalog and merges repeated items by quantity', async () => {
    const { service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1), line('content-page', 1)]);

    const result = await service.proposeChange({
      scopeId: reviewed.id,
      changeText: 'We now need two more content pages.',
      requestedBy: BUYER,
      assessment: {
        changeClass: 'in_scope_adjustment',
        summary: 'Two extra content pages using the same template.',
        lines: [line('content-page', 2)],
        exclusions: [],
        deltaAmountMinor: 1,
        confident: true,
        modelNotes: ''
      }
    });

    expect(result.deltaAmountMinor).toBe(2 * 18000);
    expect(result.superseded).toBe(true);
    expect(result.scope.lines.find((candidate) => candidate.catalogItemId === 'content-page')?.quantity).toBe(3);
    expect((await service.getScopeView({ scopeId: result.scope.id })).scope.amountMinor).toBe(45000 + 3 * 18000);
  });

  it('does not create a payable version for a no-change or clarification assessment', async () => {
    const { store, service } = setup();
    const { reviewed } = await createAwaitingBuyer(service, [line('landing-page', 1)]);

    const result = await service.proposeChange({
      scopeId: reviewed.id,
      changeText: 'Can you confirm the page will work on a phone?',
      requestedBy: BUYER,
      assessment: {
        changeClass: 'clarification',
        summary: 'Buyer asked a question already answered by the scope.',
        lines: [],
        exclusions: [],
        deltaAmountMinor: 0,
        confident: true,
        modelNotes: ''
      }
    });

    expect(result.scope.id).toBe(reviewed.id);
    expect(result.deltaAmountMinor).toBe(0);
    expect(result.superseded).toBe(false);
    expect(store.scopes.size).toBe(2);
  });
});
