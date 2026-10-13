/**
 * Canonical runtime schemas and shared types for ScopePay.
 *
 * Everything the browser, the AI model, PayPal or a webhook sends is parsed
 * through Zod here before any domain code runs. Model output and provider
 * payloads are untrusted input.
 *
 * Money is always integer minor units (cents) plus an ISO-4217 currency code.
 * No floating point money anywhere in the codebase.
 */
import { z } from 'zod';

export const Currency = z.enum(['USD']);
export type Currency = z.infer<typeof Currency>;

/** A single billable line in the merchant's service catalog. */
export const CatalogItem = z.object({
  /** Stable catalog identifier referenced by scopes and AI proposals. */
  id: z.string().min(1),
  label: z.string().min(1),
  /** Unit price in integer cents. */
  unitPriceMinor: z.number().int().nonnegative(),
  /** Inclusive quantity range the merchant will sell at catalog price. */
  minQty: z.number().int().positive(),
  maxQty: z.number().int().positive(),
  unit: z.string().min(1),
  /** Files/page types the item delivers, shown verbatim in the client scope summary. */
  deliverableTemplate: z.string().min(1),
  description: z.string().min(1)
});
export type CatalogItem = z.infer<typeof CatalogItem>;

export const Catalog = z.object({
  version: z.string().min(1),
  merchantId: z.string().min(1),
  merchantName: z.string().min(1),
  currency: Currency,
  /** Products are one-off service packages; no tax or shipping is modelled. */
  taxIncluded: z.literal(false),
  shippingIncluded: z.literal(true),
  items: z.array(CatalogItem).min(1)
});
export type Catalog = z.infer<typeof Catalog>;

/** A line item on a scope version, always traced back to catalog + brief text. */
export const ScopeLine = z.object({
  catalogItemId: z.string().min(1),
  quantity: z.number().int().positive(),
  /** Exact substring of the brief this line was derived from. */
  sourceSpan: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      quote: z.string().min(1)
    })
    .nullable(),
  /** Model's stated reason; advisory only, the merchant reviews it. */
  rationale: z.string().default('')
});
export type ScopeLine = z.infer<typeof ScopeLine>;

export const ScopeStatus = z.enum([
  'draft', // AI proposed, merchant has not reviewed
  'awaiting_buyer', // merchant finalized, buyer has not accepted
  'accepted', // buyer accepted this exact hash, no order yet
  'order_created', // sandbox order exists, not captured
  'paid', // capture verified against this exact hash
  'superseded', // replaced by a newer version; never payable again
  'rejected' // merchant rejected the proposal
]);
export type ScopeStatus = z.infer<typeof ScopeStatus>;

export const ScopeProposal = z.object({
  /** Model-proposed lines; validated against the catalog before acceptance. */
  lines: z.array(ScopeLine).default([]),
  /** Explicit exclusions surfaced to the buyer in plain language. */
  exclusions: z.array(z.string()).default([]),
  /** Revision limit the merchant offers for this package. */
  revisionLimit: z.number().int().nonnegative().nullable().default(null),
  /** Questions the model could not resolve; merchant or buyer must answer. */
  ambiguities: z.array(z.string()).default([])
});
export type ScopeProposal = z.infer<typeof ScopeProposal>;

/** Immutable, hash-addressed scope version. Never mutated after creation. */
export const ScopeVersion = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  briefId: z.string().min(1),
  version: z.number().int().positive(),
  catalogVersion: z.string().min(1),
  lines: z.array(ScopeLine),
  exclusions: z.array(z.string()),
  revisionLimit: z.number().int().nonnegative().nullable(),
  /** Server-computed total. The model never supplies this value. */
  amountMinor: z.number().int().nonnegative(),
  currency: Currency,
  /** SHA-256 over the canonical scope payload; quoted to the buyer and to PayPal. */
  hash: z.string().length(64),
  status: ScopeStatus,
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  /** Set when the merchant finalizes/edits a proposal into a payable version. */
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  reviewAction: z.enum(['approve', 'edit', 'reject']).nullable(),
  reviewNote: z.string().nullable()
});
export type ScopeVersion = z.infer<typeof ScopeVersion>;

export const Acceptance = z.object({
  id: z.string().min(1),
  scopeId: z.string().min(1),
  /** The exact hash the buyer accepted; mismatch invalidates checkout. */
  hash: z.string().length(64),
  actor: z.string().min(1),
  acceptedAt: z.string().datetime(),
  /** Buyer explicitly confirmed amount + currency at the moment of approval. */
  confirmedAmountMinor: z.number().int().nonnegative(),
  confirmedCurrency: Currency
});
export type Acceptance = z.infer<typeof Acceptance>;

export const PaymentState = z.enum([
  'created',
  'approved',
  'captured',
  'failed',
  'declined',
  'expired',
  'reconcile_required'
]);
export type PaymentState = z.infer<typeof PaymentState>;

export const PaymentAttempt = z.object({
  id: z.string().min(1),
  scopeId: z.string().min(1),
  /** The hash this attempt is bound to. A stale hash can never be paid. */
  scopeHash: z.string().length(64),
  expectedAmountMinor: z.number().int().nonnegative(),
  expectedCurrency: Currency,
  merchantId: z.string().min(1),
  /** Local idempotency key; also sent to PayPal as Paypal-Request-Id. */
  requestKey: z.string().min(1),
  paypalOrderId: z.string().nullable(),
  captureId: z.string().nullable(),
  /** Actual status returned by PayPal, unchanged from the provider payload. */
  providerStatus: z.string().nullable(),
  state: PaymentState,
  approvalUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Provider-reported amount/currency once known, for reconciliation checks. */
  providerAmountMinor: z.number().int().nonnegative().nullable(),
  providerCurrency: z.string().nullable(),
  lastError: z.string().nullable()
});
export type PaymentAttempt = z.infer<typeof PaymentAttempt>;

export const Brief = z.object({
  id: z.string().min(1),
  /** SHA-256 of the canonical text; used for duplicate detection. */
  textHash: z.string().length(64),
  canonicalText: z.string().min(1),
  submittedBy: z.string().min(1),
  createdAt: z.string().datetime()
});
export type Brief = z.infer<typeof Brief>;

export const EventRecord = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  resourceId: z.string().min(1),
  verificationState: z.enum(['verified', 'invalid_signature', 'unverifiable']),
  receivedAt: z.string().datetime(),
  processedState: z.enum(['applied', 'duplicate', 'ignored', 'out_of_order']),
  note: z.string().default('')
});
export type EventRecord = z.infer<typeof EventRecord>;

/* ------------------------------------------------------------------ */
/* API request/response schemas                                        */
/* ------------------------------------------------------------------ */

export const BriefSubmission = z.object({
  text: z.string().min(20).max(8000),
  submittedBy: z.string().min(1).max(120)
});
export type BriefSubmission = z.infer<typeof BriefSubmission>;

export const MerchantReview = z.object({
  action: z.enum(['approve', 'edit', 'reject']),
  actor: z.string().min(1).max(120),
  note: z.string().max(2000).default(''),
  /** Required when action is 'edit': the merchant's authoritative lines. */
  lines: z.array(ScopeLine).optional(),
  exclusions: z.array(z.string()).optional(),
  revisionLimit: z.number().int().nonnegative().nullable().optional()
});
export type MerchantReview = z.infer<typeof MerchantReview>;

export const BuyerAcceptance = z.object({
  hash: z.string().length(64),
  actor: z.string().min(1).max(120),
  /** Buyer must echo the amount they saw; a mismatch blocks acceptance. */
  confirmedAmountMinor: z.number().int().nonnegative(),
  confirmedCurrency: Currency
});
export type BuyerAcceptance = z.infer<typeof BuyerAcceptance>;

export const ChangeRequest = z.object({
  text: z.string().min(5).max(4000),
  requestedBy: z.string().min(1).max(120)
});
export type ChangeRequest = z.infer<typeof ChangeRequest>;

export const ChangeClass = z.enum([
  'no_change',
  'clarification',
  'in_scope_adjustment',
  'new_scope_delta'
]);
export type ChangeClass = z.infer<typeof ChangeClass>;

export const ChangeAssessment = z.object({
  changeClass: ChangeClass,
  summary: z.string(),
  /** Any proposed new lines; the merchant still has to approve them. */
  lines: z.array(ScopeLine).default([]),
  exclusions: z.array(z.string()).default([]),
  /** Amount difference in cents versus the current scope; computed by the server. */
  deltaAmountMinor: z.number().int(),
  /** False when the model could not classify confidently; server keeps the paid scope. */
  confident: z.boolean(),
  modelNotes: z.string().default('')
});
export type ChangeAssessment = z.infer<typeof ChangeAssessment>;

export const ApiError = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.array(z.string()).default([])
  })
});
export type ApiError = z.infer<typeof ApiError>;

export function canonicalScopePayload(input: {
  briefId: string;
  version: number;
  catalogVersion: string;
  lines: ScopeLine[];
  exclusions: string[];
  revisionLimit: number | null;
  amountMinor: number;
  currency: string;
}): string {
  return JSON.stringify({
    briefId: input.briefId,
    version: input.version,
    catalogVersion: input.catalogVersion,
    currency: input.currency,
    amountMinor: input.amountMinor,
    revisionLimit: input.revisionLimit,
    exclusions: [...input.exclusions].sort(),
    lines: input.lines
      .map((line) => ({
        catalogItemId: line.catalogItemId,
        quantity: line.quantity,
        rationale: line.rationale
      }))
      .sort((a, b) => (a.catalogItemId < b.catalogItemId ? -1 : 1))
  });
}
