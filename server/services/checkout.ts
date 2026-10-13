/**
 * Payment orchestration: the only place PayPal is called.
 *
 * Rules enforced here rather than in the UI:
 *  - acceptance of a specific scope hash happens before an order exists
 *  - the amount comes from the stored scope, never from the request body
 *  - a stale hash can never start or capture a payment
 *  - a duplicate submission reuses the existing attempt instead of buying twice
 *  - "captured" is only ever set from a provider status of COMPLETED
 */
import { CATALOG } from '../../lib/catalog.js';
import type { PaypalClient } from '../../lib/paypal.js';
import { formatMinor } from '../../lib/pricing.js';
import type { Store } from '../../lib/persistence.js';
import type { ScopeService } from '../../lib/scope.js';
import type { EventRecord, PaymentAttempt, PaymentState } from '../../lib/schemas.js';

export class CheckoutError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: string[] = [],
    readonly status = 409
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export interface CheckoutDeps {
  store: Store;
  scopes: ScopeService;
  /** Null until the merchant configures sandbox credentials; the domain checks still run. */
  paypal: PaypalClient | null;
  requestKeyPrefix: string;
  publicBaseUrl: string;
}

/**
 * Provider access is required only once the deterministic scope checks have
 * passed, so a stale or mismatched request is answered on its own merits even
 * when credentials are missing.
 */
function requirePaypal(deps: CheckoutDeps): PaypalClient {
  if (!deps.paypal) {
    throw new CheckoutError(
      'paypal_not_configured',
      'PayPal sandbox credentials are not configured on this server. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.',
      [],
      503
    );
  }
  return deps.paypal;
}

/** Active states mean "an order already exists for this scope hash". */
function isLiveAttempt(attempt: PaymentAttempt): boolean {
  return attempt.state === 'created' || attempt.state === 'approved' || attempt.state === 'reconcile_required';
}

export async function startCheckout(
  deps: CheckoutDeps,
  input: { scopeId: string; hash: string; actor: string; confirmedAmountMinor: number; confirmedCurrency: 'USD' }
): Promise<{ attempt: PaymentAttempt; approvalUrl: string | null; reused: boolean }> {
  const { store, scopes } = deps;

  const scope = await store.getScope(input.scopeId);
  if (!scope) {
    throw new CheckoutError('scope_not_found', `No scope version with id ${input.scopeId}.`, [], 404);
  }

  const priorAttempts = await store.listPaymentAttemptsForScope(input.scopeId);

  // 1. A live attempt for this same hash is a duplicate submission, not a new
  // purchase. This is checked before acceptance, which only accepts a scope that
  // has not been ordered yet, so a repeated click reuses the original order.
  const existing = priorAttempts.find((attempt) => attempt.scopeHash === input.hash && isLiveAttempt(attempt));
  if (existing) {
    return { attempt: existing, approvalUrl: existing.approvalUrl, reused: true };
  }

  // 2. The buyer accepts this exact version. Idempotent for a repeated click.
  await scopes.recordAcceptance({
    scopeId: input.scopeId,
    acceptance: {
      hash: input.hash,
      actor: input.actor,
      confirmedAmountMinor: input.confirmedAmountMinor,
      confirmedCurrency: input.confirmedCurrency
    }
  });

  // 3. Server-side gate: status, ownership, hash, amount and currency.
  const { scope: payable } = await scopes.assertPayable({
    scopeId: input.scopeId,
    hash: input.hash,
    expectedAmountMinor: input.confirmedAmountMinor,
    expectedCurrency: input.confirmedCurrency,
    merchantId: CATALOG.merchantId
  });

  const attempts = await store.listPaymentAttemptsForScope(input.scopeId);

  // 4. Unpaid attempts for an older hash are abandoned; they are never re-priced.
  for (const stale of attempts.filter((attempt) => attempt.scopeHash !== payable.hash && isLiveAttempt(attempt))) {
    await store.updatePaymentAttempt({
      ...stale,
      state: 'expired',
      lastError: `Superseded by scope ${payable.id} (${payable.hash.slice(0, 12)}). No capture is permitted.`,
      updatedAt: new Date().toISOString()
    });
  }

  const repeatedCaptureAttempt = attempts.find((attempt) => attempt.state === 'captured');
  if (repeatedCaptureAttempt) {
    throw new CheckoutError('already_paid', 'This scope version already has a captured sandbox payment.', [], 409);
  }

  // Every deterministic check has passed; only now does the provider get called.
  const paypal = requirePaypal(deps);
  const requestKey = `${deps.requestKeyPrefix}:${payable.id}:${payable.hash}`;
  const order = await paypal.createOrder({
    scopeRef: payable.id,
    scopeHash: payable.hash,
    amountMinor: payable.amountMinor,
    currency: payable.currency,
    merchantId: CATALOG.merchantId,
    requestKey,
    returnUrl: `${deps.publicBaseUrl}/checkout/return?scope=${encodeURIComponent(payable.id)}`,
    cancelUrl: `${deps.publicBaseUrl}/checkout/cancel?scope=${encodeURIComponent(payable.id)}`,
    description: `ScopePay sandbox scope v${payable.version} ${payable.hash.slice(0, 12)}`
  });

  const timestamp = new Date().toISOString();
  const attempt: PaymentAttempt = {
    id: `attempt-${payable.id}-${attempts.length + 1}`,
    scopeId: payable.id,
    scopeHash: payable.hash,
    expectedAmountMinor: payable.amountMinor,
    expectedCurrency: payable.currency,
    merchantId: CATALOG.merchantId,
    requestKey,
    paypalOrderId: order.orderId,
    captureId: null,
    providerStatus: order.status,
    state: 'created',
    approvalUrl: order.approvalUrl,
    createdAt: timestamp,
    updatedAt: timestamp,
    providerAmountMinor: null,
    providerCurrency: null,
    lastError: null
  };

  // 5. The provider id is persisted before any later state transition.
  await store.insertPaymentAttempt(attempt);
  await scopes.markOrderCreated({ scopeId: payable.id });

  return { attempt, approvalUrl: order.approvalUrl, reused: false };
}

function stateForCaptureStatus(status: string | null): PaymentState {
  switch (status) {
    case 'COMPLETED':
      return 'captured';
    case 'DECLINED':
      return 'declined';
    case 'FAILED':
      return 'failed';
    case 'PENDING':
      return 'reconcile_required';
    default:
      return 'reconcile_required';
  }
}

export async function captureScopeOrder(
  deps: CheckoutDeps,
  input: { scopeId: string; orderId?: string }
): Promise<{ attempt: PaymentAttempt; captured: boolean; message: string }> {
  const { store, scopes } = deps;
  const scope = await store.getScope(input.scopeId);
  if (!scope) {
    throw new CheckoutError('scope_not_found', `No scope version with id ${input.scopeId}.`, [], 404);
  }

  // The attempt is resolved by the provider order id, so a request made from a
  // newer scope page can never be pointed at an older, superseded order.
  const attempts = await store.listPaymentAttemptsForScope(input.scopeId);
  const attempt = input.orderId
    ? (await store.findPaymentAttemptByOrderId(input.orderId)) ?? attempts.find((c) => c.paypalOrderId === input.orderId)
    : attempts[attempts.length - 1];
  if (!attempt || !attempt.paypalOrderId) {
    throw new CheckoutError('attempt_not_found', 'No PayPal sandbox order exists for this scope.', [], 404);
  }
  if (attempt.state === 'captured') {
    return { attempt, captured: true, message: 'This order was already captured; the receipt is unchanged.' };
  }
  if (attempt.scopeId !== scope.id) {
    throw new CheckoutError(
      'attempt_scope_mismatch',
      'That PayPal order belongs to a different scope version.',
      [`order created for ${attempt.scopeId}`],
      409
    );
  }

  // Stale guard: the owning version must still be the current payable one, with
  // an unchanged hash. This is a precondition, checked before the provider is
  // called, so a superseded order is never captured.
  const owning = await store.getScope(attempt.scopeId);
  if (!owning || owning.hash !== attempt.scopeHash) {
    throw new CheckoutError(
      'stale_scope',
      'The scope changed after this order was created. Nothing was captured.',
      [`attempt hash ${attempt.scopeHash.slice(0, 12)} vs current ${owning?.hash.slice(0, 12) ?? 'missing'}`],
      409
    );
  }
  if (owning.status === 'paid') {
    return { attempt, captured: true, message: 'This scope version is already paid; the receipt is unchanged.' };
  }
  if (owning.status !== 'order_created' && owning.status !== 'accepted') {
    await store.updatePaymentAttempt({
      ...attempt,
      state: 'expired',
      lastError: `Scope version is ${owning.status}; capture refused.`,
      updatedAt: new Date().toISOString()
    });
    throw new CheckoutError(
      'stale_scope',
      'This scope version is no longer payable, so nothing was captured.',
      [`scope status ${owning.status}`],
      409
    );
  }

  const result = await requirePaypal(deps).captureOrder({
    orderId: attempt.paypalOrderId,
    expected: {
      amountMinor: attempt.expectedAmountMinor,
      currency: attempt.expectedCurrency,
      merchantId: attempt.merchantId
    },
    requestKey: attempt.requestKey
  });

  const state = stateForCaptureStatus(result.captureStatus);
  const updated: PaymentAttempt = {
    ...attempt,
    captureId: result.captureId ?? attempt.captureId,
    providerStatus: result.captureStatus ?? result.orderStatus,
    state,
    providerAmountMinor: result.amountMinor,
    providerCurrency: result.currency,
    updatedAt: new Date().toISOString(),
    lastError: state === 'captured' ? null : result.providerMessage
  };

  // Marking the scope paid first means a failure here cannot leave a local
  // receipt claiming money moved: the attempt stays reconcilable instead.
  if (state === 'captured') {
    await scopes.markPaid({ scopeId: owning.id, scopeHash: owning.hash });
  }
  await store.updatePaymentAttempt(updated);

  if (state === 'captured') {
    return {
      attempt: updated,
      captured: true,
      message: `Sandbox capture ${result.captureId} completed for ${formatMinor(updated.expectedAmountMinor, updated.expectedCurrency)}.`
    };
  }

  return {
    attempt: updated,
    captured: false,
    message: `PayPal reported capture status ${result.captureStatus ?? 'unknown'}; the payment is not complete.`
  };
}

export async function reconcileScope(
  deps: CheckoutDeps,
  input: { scopeId: string; orderId?: string }
): Promise<{ attempt: PaymentAttempt | null; providerStatus: string | null; changed: boolean; source: string }> {
  const { store, scopes } = deps;
  const attempts = await store.listPaymentAttemptsForScope(input.scopeId);
  const attempt = input.orderId
    ? attempts.find((candidate) => candidate.paypalOrderId === input.orderId)
    : attempts[attempts.length - 1];
  if (!attempt || !attempt.paypalOrderId) {
    return { attempt: null, providerStatus: null, changed: false, source: 'no order exists yet' };
  }
  // Terminal states are never regressed by a refresh.
  if (attempt.state === 'captured' || attempt.state === 'declined') {
    return { attempt, providerStatus: attempt.providerStatus, changed: false, source: 'already terminal' };
  }

  const snapshot = await requirePaypal(deps).getOrder(attempt.paypalOrderId);
  let state: PaymentState = attempt.state;
  if (snapshot.captureId && snapshot.captureStatus === 'COMPLETED') {
    state = 'captured';
  } else if (snapshot.status === 'APPROVED') {
    state = 'approved';
  } else if (snapshot.status === 'VOIDED') {
    state = 'expired';
  }

  const updated: PaymentAttempt = {
    ...attempt,
    captureId: snapshot.captureId ?? attempt.captureId,
    providerStatus: snapshot.captureStatus ?? snapshot.status,
    providerAmountMinor: snapshot.amountMinor,
    providerCurrency: snapshot.currency,
    state,
    updatedAt: new Date().toISOString()
  };
  await store.updatePaymentAttempt(updated);
  if (state === 'captured') {
    const scope = await store.getScope(attempt.scopeId);
    if (scope && scope.hash === attempt.scopeHash) {
      await scopes.markPaid({ scopeId: scope.id, scopeHash: scope.hash });
    }
  }
  return {
    attempt: updated,
    providerStatus: updated.providerStatus,
    changed: state !== attempt.state || updated.captureId !== attempt.captureId,
    source: 'PayPal sandbox GET /v2/checkout/orders'
  };
}

const WebhookEventSchema = {
  id: (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
};

/**
 * Verified webhook handling.
 *
 * Nothing from the request is trusted until PayPal confirms the signature with
 * the configured webhook id. Events are stored before they are applied, and a
 * repeated event id is a no-op so redelivery cannot double-apply a payment.
 */
export async function handlePaypalWebhook(
  deps: CheckoutDeps,
  input: { headers: Record<string, string | undefined>; rawBody: string }
): Promise<{ accepted: boolean; reason: string; event: EventRecord; applied: boolean }> {
  const { store, scopes } = deps;
  // A callback can never be trusted without a signature check, so this is the
  // one place where the provider is required before any other work happens.
  const paypal = requirePaypal(deps);
  const receivedAt = new Date().toISOString();
  const parsedBody = (() => {
    try {
      return JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  const verification = await paypal.verifyWebhook({ headers: input.headers, body: input.rawBody });
  const eventId = WebhookEventSchema.id(parsedBody?.id) ?? `unidentified-${receivedAt}`;
  const eventType = typeof parsedBody?.event_type === 'string' ? parsedBody.event_type : 'UNKNOWN';
  const resource = (parsedBody?.resource ?? {}) as Record<string, unknown>;
  const related = ((resource.supplementary_data as Record<string, unknown> | undefined)?.related_ids ??
    {}) as Record<string, unknown>;
  const orderId =
    typeof related.order_id === 'string'
      ? related.order_id
      : eventType.startsWith('CHECKOUT.ORDER')
        ? typeof resource.id === 'string'
          ? resource.id
          : null
        : null;
  const resourceId = orderId ?? (typeof resource.id === 'string' ? resource.id : 'unknown');

  const record: EventRecord = {
    eventId,
    eventType,
    resourceId,
    verificationState: verification.verified ? 'verified' : 'invalid_signature',
    receivedAt,
    processedState: 'ignored',
    note: verification.reason
  };

  if (!verification.verified) {
    await store.saveEvent(record);
    return { accepted: false, reason: `Signature not verified: ${verification.reason}`, event: record, applied: false };
  }

  const existing = await store.getEvent(eventId);
  if (existing) {
    return { accepted: true, reason: 'Duplicate event id; already recorded.', event: existing, applied: false };
  }

  const attempt = orderId ? await store.findPaymentAttemptByOrderId(orderId) : null;
  let applied = false;
  let note = 'No matching local payment attempt; recorded for audit only.';
  let processedState: EventRecord['processedState'] = 'ignored';

  if (attempt) {
    const captureId = typeof resource.id === 'string' ? resource.id : null;
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      if (attempt.state === 'captured') {
        processedState = 'duplicate';
        note = 'Capture already recorded; terminal state left unchanged.';
      } else if (attempt.scopeHash === (await store.getScope(attempt.scopeId))?.hash) {
        await store.updatePaymentAttempt({
          ...attempt,
          state: 'captured',
          captureId: captureId ?? attempt.captureId,
          providerStatus: typeof resource.status === 'string' ? resource.status : 'COMPLETED',
          updatedAt: new Date().toISOString()
        });
        await scopes.markPaid({ scopeId: attempt.scopeId, scopeHash: attempt.scopeHash });
        processedState = 'applied';
        note = `Capture ${captureId ?? 'unknown'} verified for ${formatMinor(attempt.expectedAmountMinor, attempt.expectedCurrency)}.`;
        applied = true;
      } else {
        processedState = 'out_of_order';
        note = 'Scope version changed; the paid version keeps its own receipt and this event is only recorded.';
      }
    } else if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      if (attempt.state === 'created') {
        await store.updatePaymentAttempt({
          ...attempt,
          state: 'approved',
          providerStatus: 'APPROVED',
          updatedAt: new Date().toISOString()
        });
        processedState = 'applied';
        note = 'Buyer approved the sandbox order; capture is still required for payment.';
        applied = true;
      } else {
        processedState = 'duplicate';
        note = `Approval event arrived after state ${attempt.state}; ignored.`;
      }
    } else if (eventType === 'PAYMENT.CAPTURE.DENIED') {
      if (attempt.state === 'captured') {
        processedState = 'out_of_order';
        note = 'Denial for an already captured attempt; terminal state preserved.';
      } else {
        await store.updatePaymentAttempt({ ...attempt, state: 'declined', updatedAt: new Date().toISOString() });
        processedState = 'applied';
        note = 'Sandbox capture was denied by PayPal.';
        applied = true;
      }
    } else if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
      processedState = 'applied';
      note = 'Refund observed on the provider. Refunds are out of MVP scope; the receipt records the event only.';
      applied = true;
    }
  }

  await store.saveEvent({ ...record, processedState, note });
  return { accepted: true, reason: note, event: { ...record, processedState, note }, applied };
}
