/**
 * Scope version domain service.
 *
 * This is the trust boundary between the AI proposal, the merchant and the
 * buyer. It owns:
 *   - brief canonicalisation and duplicate detection
 *   - immutable, hash-addressed scope versions
 *   - deterministic amounts recomputed from the merchant catalog only
 *   - staleness checks so a stale scope can never reach checkout
 *   - change requests that always produce a new version, never a mutation of a
 *     paid order
 *
 * Nothing here trusts the model, the browser or PayPal. Every value that
 * affects money is recomputed from the catalog and the stored scope row.
 */
import { randomUUID } from 'node:crypto';

import { CATALOG, STANDARD_EXCLUSIONS } from './catalog.js';
import { computeAmountMinor, priceBreakdown, validateLines, type PriceBreakdownRow } from './pricing.js';
import type { ScopeStatusPatch, Store } from './persistence.js';
import {
  canonicalScopePayload,
  type Acceptance,
  type Brief,
  type BuyerAcceptance,
  type Catalog,
  type ChangeAssessment,
  type MerchantReview,
  type ScopeLine,
  type ScopeProposal,
  type ScopeVersion
} from './schemas.js';
import { hashBrief, sha256Hex } from './hashing.js';

export type ScopeErrorCode =
  | 'scope_not_found'
  | 'scope_not_draft'
  | 'scope_not_awaiting_buyer'
  | 'scope_not_payable'
  | 'stale_scope'
  | 'hash_mismatch'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'invalid_review'
  | 'invalid_lines'
  | 'already_paid'
  | 'already_accepted'
  | 'merchant_mismatch'
  | 'not_accepted'
  | 'change_requires_new_version';

export class ScopeError extends Error {
  readonly code: ScopeErrorCode;
  readonly details: string[];

  constructor(code: ScopeErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'ScopeError';
    this.code = code;
    this.details = details;
  }
}

export interface ScopeDeps {
  store: Store;
  catalog?: Catalog;
  now?: () => Date;
  newId?: (prefix: string) => string;
}

export interface CreateDraftInput {
  text: string;
  submittedBy: string;
  proposal: ScopeProposal;
}

export interface CreateDraftResult {
  brief: Brief;
  scope: ScopeVersion;
  reusedExisting: boolean;
}

export interface ApplyMerchantReviewInput {
  scopeId: string;
  review: MerchantReview;
  actor?: string;
}

export interface RecordAcceptanceInput {
  scopeId: string;
  acceptance: BuyerAcceptance;
}

export interface RecordAcceptanceResult {
  scope: ScopeVersion;
  acceptance: Acceptance;
}

export interface AssertPayableInput {
  scopeId: string;
  hash: string;
  expectedAmountMinor: number;
  expectedCurrency: string;
  merchantId: string;
}

export interface AssertPayableResult {
  scope: ScopeVersion;
  acceptance: Acceptance;
}

export interface ProposeChangeInput {
  scopeId: string;
  changeText: string;
  assessment: ChangeAssessment;
  requestedBy: string;
}

export interface ProposeChangeResult {
  scope: ScopeVersion;
  deltaAmountMinor: number;
  superseded: boolean;
  /** Requests the catalog cannot sell as asked, reported instead of silently charged. */
  warnings: string[];
}

export interface ScopeView {
  scope: ScopeVersion;
  breakdown: PriceBreakdownRow[];
  acceptance: Acceptance | null;
  history: ScopeVersion[];
}

/** Statuses that can still be revised or paid. */
const LIVE_STATUSES = new Set(['draft', 'awaiting_buyer', 'accepted', 'order_created', 'paid']);

/**
 * Rebuild a line from the canonical schema shape so unknown properties supplied
 * by a model or a client (for example an invented `unitPriceMinor`) are dropped
 * before anything is persisted.
 */
function normaliseLine(line: ScopeLine): ScopeLine {
  return {
    catalogItemId: line.catalogItemId,
    quantity: line.quantity,
    sourceSpan: line.sourceSpan
      ? { start: line.sourceSpan.start, end: line.sourceSpan.end, quote: line.sourceSpan.quote }
      : null,
    rationale: typeof line.rationale === 'string' ? line.rationale : ''
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

/** Merge a proposed delta into existing lines by summing quantities per catalog item. */
function mergeLines(base: ScopeLine[], delta: ScopeLine[]): ScopeLine[] {
  const merged = new Map<string, ScopeLine>();
  for (const line of base) merged.set(line.catalogItemId, { ...line });
  for (const line of delta) {
    const existing = merged.get(line.catalogItemId);
    merged.set(line.catalogItemId, existing
      ? { ...existing, quantity: existing.quantity + line.quantity, rationale: line.rationale || existing.rationale }
      : { ...line });
  }
  return [...merged.values()];
}

export function createScopeService(deps: ScopeDeps) {
  const store = deps.store;
  const catalog = deps.catalog ?? CATALOG;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);
  const iso = () => now().toISOString();

  async function requireScope(scopeId: string): Promise<ScopeVersion> {
    const scope = await store.getScope(scopeId);
    if (!scope) {
      throw new ScopeError('scope_not_found', `No scope version with id ${scopeId}.`);
    }
    return scope;
  }

  async function requireBrief(briefId: string): Promise<Brief> {
    const brief = await store.getBrief(briefId);
    if (!brief) {
      throw new ScopeError('scope_not_found', `The brief for briefId ${briefId} no longer exists.`);
    }
    return brief;
  }

  function buildScope(input: {
    id: string;
    parentId: string | null;
    briefId: string;
    version: number;
    lines: ScopeLine[];
    exclusions: string[];
    revisionLimit: number | null;
    status: ScopeVersion['status'];
    createdBy: string;
    reviewedBy?: string | null;
    reviewAction?: ScopeVersion['reviewAction'];
    reviewNote?: string | null;
  }): ScopeVersion {
    const amountMinor = computeAmountMinor(input.lines, catalog);
    const hash = sha256Hex(
      canonicalScopePayload({
        briefId: input.briefId,
        version: input.version,
        catalogVersion: catalog.version,
        lines: input.lines,
        exclusions: input.exclusions,
        revisionLimit: input.revisionLimit,
        amountMinor,
        currency: catalog.currency
      })
    );
    const timestamp = iso();
    return {
      id: input.id,
      parentId: input.parentId,
      briefId: input.briefId,
      version: input.version,
      catalogVersion: catalog.version,
      lines: input.lines,
      exclusions: input.exclusions,
      revisionLimit: input.revisionLimit,
      amountMinor,
      currency: catalog.currency,
      hash,
      status: input.status,
      createdBy: input.createdBy,
      createdAt: timestamp,
      reviewedBy: input.reviewedBy ?? null,
      reviewedAt: input.reviewedBy ? timestamp : null,
      reviewAction: input.reviewAction ?? null,
      reviewNote: input.reviewNote ?? null
    };
  }

  function assertValidLines(raw: ScopeLine[], briefText: string) {
    const lines = raw.map(normaliseLine);
    const result = validateLines(lines, briefText, catalog);
    if (!result.ok) {
      throw new ScopeError(
        'invalid_lines',
        'The proposed scope includes lines this catalog cannot price.',
        result.errors
      );
    }
    return result.lines;
  }

  /**
   * A hash that does not match may belong to an earlier version of the same
   * brief (stale) or may simply be fabricated. The distinction decides which
   * error the caller shows the buyer.
   */
  async function resolveHashCode(
    scope: ScopeVersion,
    hash: string
  ): Promise<'stale_scope' | 'hash_mismatch'> {
    const history = await store.listScopesForBrief(scope.briefId);
    return history.some((version) => version.hash === hash) ? 'stale_scope' : 'hash_mismatch';
  }

  async function createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
    const { canonicalText, textHash } = hashBrief(input.text);
    let brief = await store.findBriefByTextHash(textHash);

    if (brief) {
      const history = await store.listScopesForBrief(brief.id);
      const live = history
        .filter((scope) => LIVE_STATUSES.has(scope.status))
        .sort((a, b) => b.version - a.version)[0];
      if (live) {
        return { brief, scope: live, reusedExisting: true };
      }
    } else {
      const created: Brief = {
        id: newId('brief'),
        textHash,
        canonicalText,
        submittedBy: input.submittedBy,
        createdAt: iso()
      };
      await store.createBrief(created);
      brief = created;
    }

    const history = await store.listScopesForBrief(brief.id);
    const previous = [...history].sort((a, b) => b.version - a.version)[0] ?? null;

    const lines = assertValidLines(input.proposal.lines, brief.canonicalText);
    const exclusions = unique([...STANDARD_EXCLUSIONS, ...input.proposal.exclusions]);

    const scope = buildScope({
      id: newId('scope'),
      parentId: previous ? previous.id : null,
      briefId: brief.id,
      version: previous ? previous.version + 1 : 1,
      lines,
      exclusions,
      revisionLimit: input.proposal.revisionLimit ?? 2,
      status: 'draft',
      createdBy: input.submittedBy
    });

    await store.insertScope(scope);
    return { brief, scope, reusedExisting: false };
  }

  async function applyMerchantReview(input: ApplyMerchantReviewInput): Promise<ScopeVersion> {
    const scope = await requireScope(input.scopeId);
    const { review } = input;
    const reviewedBy = input.actor ?? review.actor;

    if (scope.status !== 'draft') {
      throw new ScopeError(
        'scope_not_draft',
        `Only a draft proposal can be reviewed; this version is ${scope.status}.`,
        [`scopeId=${scope.id}`, `status=${scope.status}`]
      );
    }

    if (review.action === 'reject') {
      return store.patchScopeStatus(scope.id, {
        status: 'rejected',
        reviewedBy,
        reviewedAt: iso(),
        reviewAction: 'reject',
        reviewNote: review.note ?? ''
      });
    }

    if (review.action === 'edit' && (!review.lines || review.lines.length === 0)) {
      throw new ScopeError(
        'invalid_review',
        'An edit review must include the merchant replacement lines.',
        ['review.action=edit requires a non-empty lines array']
      );
    }

    const brief = await requireBrief(scope.briefId);
    const candidateLines = review.action === 'edit' && review.lines ? review.lines : scope.lines;
    const lines = assertValidLines(candidateLines, brief.canonicalText);
    const exclusions = review.exclusions ? unique(review.exclusions) : scope.exclusions;
    const revisionLimit = review.revisionLimit === undefined ? scope.revisionLimit : review.revisionLimit;

    const next = buildScope({
      id: newId('scope'),
      parentId: scope.id,
      briefId: scope.briefId,
      version: scope.version + 1,
      lines,
      exclusions,
      revisionLimit,
      status: 'awaiting_buyer',
      createdBy: scope.createdBy,
      reviewedBy,
      reviewAction: review.action,
      reviewNote: review.note ?? ''
    });

    // Insert the replacement before superseding the parent so the payable
    // version is never missing, then retire the parent.
    await store.insertScope(next);
    await store.patchScopeStatus(scope.id, {
      status: 'superseded',
      reviewedBy,
      reviewedAt: iso(),
      reviewAction: review.action,
      reviewNote: review.note ?? ''
    });

    return next;
  }

  async function recordAcceptance(input: RecordAcceptanceInput): Promise<RecordAcceptanceResult> {
    const scope = await requireScope(input.scopeId);
    const acceptance = input.acceptance;

    if (scope.status === 'paid') {
      throw new ScopeError('already_paid', 'This scope version is already paid.', [`scopeId=${scope.id}`]);
    }
    if (scope.status !== 'awaiting_buyer' && scope.status !== 'accepted') {
      throw new ScopeError(
        'scope_not_awaiting_buyer',
        `This version is ${scope.status} and cannot be accepted by a buyer.`,
        [`scopeId=${scope.id}`, `status=${scope.status}`]
      );
    }
    if (acceptance.hash !== scope.hash) {
      const code = await resolveHashCode(scope, acceptance.hash);
      throw new ScopeError(
        code,
        code === 'stale_scope'
          ? 'The accepted scope is out of date; a newer version has been issued.'
          : 'The accepted hash does not match this scope version.',
        [`currentHash=${scope.hash}`, `acceptedHash=${acceptance.hash}`]
      );
    }
    if (acceptance.confirmedAmountMinor !== scope.amountMinor) {
      throw new ScopeError(
        'amount_mismatch',
        'The confirmed amount does not match the authoritative scope total.',
        [`scopeAmountMinor=${scope.amountMinor}`, `confirmedAmountMinor=${acceptance.confirmedAmountMinor}`]
      );
    }
    if (acceptance.confirmedCurrency !== scope.currency) {
      throw new ScopeError(
        'currency_mismatch',
        'The confirmed currency does not match the scope currency.',
        [`scopeCurrency=${scope.currency}`, `confirmedCurrency=${acceptance.confirmedCurrency}`]
      );
    }

    const existing = await store.getAcceptance(scope.id);
    if (scope.status === 'accepted' && existing && existing.hash === scope.hash) {
      return { scope, acceptance: existing };
    }

    const record: Acceptance = {
      id: newId('acceptance'),
      scopeId: scope.id,
      hash: scope.hash,
      actor: acceptance.actor,
      acceptedAt: iso(),
      confirmedAmountMinor: scope.amountMinor,
      confirmedCurrency: scope.currency
    };
    await store.saveAcceptance(record);
    const patched = await store.patchScopeStatus(scope.id, { status: 'accepted' });
    return { scope: patched, acceptance: record };
  }

  async function assertPayable(input: AssertPayableInput): Promise<AssertPayableResult> {
    const scope = await requireScope(input.scopeId);

    if (scope.status === 'paid') {
      throw new ScopeError('already_paid', 'This scope version has already been paid.', [`scopeId=${scope.id}`]);
    }
    if (scope.status === 'superseded') {
      throw new ScopeError(
        'stale_scope',
        'This scope version has been replaced by a newer version and can no longer be paid.',
        [`scopeId=${scope.id}`]
      );
    }
    if (input.merchantId !== catalog.merchantId) {
      throw new ScopeError(
        'merchant_mismatch',
        'This checkout session does not belong to the catalog merchant.',
        [`expectedMerchantId=${catalog.merchantId}`, `requestMerchantId=${input.merchantId}`]
      );
    }
    if (input.hash !== scope.hash) {
      const code = await resolveHashCode(scope, input.hash);
      throw new ScopeError(
        code,
        code === 'stale_scope'
          ? 'The requested scope is stale; the merchant has issued a newer version.'
          : 'The requested scope hash does not match the stored version.',
        [`currentHash=${scope.hash}`, `requestedHash=${input.hash}`]
      );
    }
    if (input.expectedAmountMinor !== scope.amountMinor) {
      throw new ScopeError(
        'amount_mismatch',
        'The checkout amount does not match the server-computed scope total.',
        [`scopeAmountMinor=${scope.amountMinor}`, `expectedAmountMinor=${input.expectedAmountMinor}`]
      );
    }
    if (input.expectedCurrency !== scope.currency) {
      throw new ScopeError(
        'currency_mismatch',
        'The checkout currency does not match the scope currency.',
        [`scopeCurrency=${scope.currency}`, `expectedCurrency=${input.expectedCurrency}`]
      );
    }
    if (scope.status === 'draft' || scope.status === 'awaiting_buyer') {
      throw new ScopeError(
        'not_accepted',
        'The buyer has not accepted this version yet.',
        [`scopeId=${scope.id}`, `status=${scope.status}`]
      );
    }
    if (scope.status === 'rejected') {
      throw new ScopeError('scope_not_payable', 'The merchant rejected this proposal.', [`scopeId=${scope.id}`]);
    }
    if (scope.status === 'order_created') {
      throw new ScopeError(
        'scope_not_payable',
        'A sandbox order already exists for this version; reconcile it instead of creating another.',
        [`scopeId=${scope.id}`]
      );
    }

    const acceptance = await store.getAcceptance(scope.id);
    if (!acceptance || acceptance.hash !== scope.hash) {
      throw new ScopeError('not_accepted', 'No buyer acceptance is stored for this scope version.', [
        `scopeId=${scope.id}`
      ]);
    }

    return { scope, acceptance };
  }

  async function markOrderCreated(input: { scopeId: string }): Promise<ScopeVersion> {
    const scope = await requireScope(input.scopeId);
    if (scope.status === 'order_created') return scope;
    if (scope.status !== 'accepted') {
      throw new ScopeError(
        'scope_not_payable',
        `Only an accepted scope can be sent to checkout; this version is ${scope.status}.`,
        [`scopeId=${scope.id}`, `status=${scope.status}`]
      );
    }
    return store.patchScopeStatus(scope.id, { status: 'order_created' });
  }

  async function markPaid(input: { scopeId: string; scopeHash: string }): Promise<ScopeVersion> {
    const scope = await requireScope(input.scopeId);
    if (scope.status === 'paid') {
      if (input.scopeHash === scope.hash) return scope;
      throw new ScopeError('already_paid', 'This scope version is already paid.', [`scopeId=${scope.id}`]);
    }
    if (scope.status !== 'order_created') {
      throw new ScopeError(
        'scope_not_payable',
        `A scope can only be paid after a sandbox order exists; this version is ${scope.status}.`,
        [`scopeId=${scope.id}`, `status=${scope.status}`]
      );
    }
    if (input.scopeHash !== scope.hash) {
      const code = await resolveHashCode(scope, input.scopeHash);
      throw new ScopeError(code, 'The captured payment belongs to a different scope hash.', [
        `currentHash=${scope.hash}`,
        `capturedHash=${input.scopeHash}`
      ]);
    }
    return store.patchScopeStatus(scope.id, { status: 'paid' });
  }

  async function proposeChange(input: ProposeChangeInput): Promise<ProposeChangeResult> {
    const current = await requireScope(input.scopeId);
    const assessment = input.assessment;

    // With no valid catalog line there is nothing the server can price, whatever
    // class the model chose. The agreed version is left exactly as it is instead
    // of creating a new version that claims a delta it cannot substantiate.
    if (assessment.lines.length === 0) {
      return { scope: current, deltaAmountMinor: 0, superseded: false, warnings: [] };
    }

    const brief = await requireBrief(current.briefId);
    const deltaLines = assessment.lines.map(normaliseLine);
    const warnings: string[] = [];

    // A change cannot buy more of an item than the catalog sells. Quantities are
    // capped at the catalog maximum and the shortfall is reported to the client
    // rather than failing the whole request or charging for it silently.
    const merged = mergeLines(current.lines, deltaLines);
    const lines = merged.map((line) => {
      const item = catalog.items.find((candidate) => candidate.id === line.catalogItemId);
      if (!item || line.quantity <= item.maxQty) return line;
      warnings.push(
        `${item.label} is at its catalog maximum of ${item.maxQty} ${item.unit}, so the extra ${line.quantity - item.maxQty} ${item.unit} in this request cannot be added. It needs a separate agreement.`
      );
      return { ...line, quantity: item.maxQty };
    });

    const validLines = assertValidLines(lines, brief.canonicalText);
    const deltaAmountMinor = computeAmountMinor(validLines, catalog) - current.amountMinor;
    const exclusions = unique([...current.exclusions, ...assessment.exclusions]);

    const next = buildScope({
      id: newId('scope'),
      parentId: current.id,
      briefId: current.briefId,
      version: current.version + 1,
      lines: validLines,
      exclusions,
      revisionLimit: current.revisionLimit,
      status: 'draft',
      createdBy: input.requestedBy,
      reviewNote: assessment.summary
    });

    await store.insertScope(next);

    // A paid version is immutable and stays payable; its receipt must keep
    // pointing at the exact scope that was paid for.
    const superseded = current.status !== 'paid';
    if (superseded) {
      await store.patchScopeStatus(current.id, { status: 'superseded' });
    }

    return { scope: next, deltaAmountMinor, superseded, warnings };
  }

  async function getScopeView(input: { scopeId: string }): Promise<ScopeView> {
    const scope = await requireScope(input.scopeId);
    const [acceptance, history] = await Promise.all([
      store.getAcceptance(scope.id),
      store.listScopesForBrief(scope.briefId)
    ]);
    return {
      scope,
      breakdown: priceBreakdown(scope.lines, catalog),
      acceptance,
      history: [...history].sort((a, b) => a.version - b.version)
    };
  }

  return {
    createDraft,
    applyMerchantReview,
    recordAcceptance,
    assertPayable,
    markOrderCreated,
    markPaid,
    proposeChange,
    getScopeView
  };
}

export type ScopeService = ReturnType<typeof createScopeService>;

export type { ScopeStatusPatch };
