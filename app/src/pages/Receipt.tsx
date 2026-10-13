import { useState } from 'react';
import { ApiError, api, type ScopeViewResponse } from '../api.js';
import { BreakdownTable, FailureNotice, SandboxNotice, ScopeMeta, StatusMessage } from '../components/ScopeParts.js';

const STATUS_TEXT: Record<string, { kind: 'success' | 'pending' | 'error' | 'info'; text: string }> = {
  paid: { kind: 'success', text: 'PayPal reports this sandbox payment as captured.' },
  order_created: { kind: 'pending', text: 'An order exists but no capture has completed. Nothing has been paid yet.' },
  accepted: { kind: 'pending', text: 'The client approved this version but no order has been created.' },
  draft: { kind: 'info', text: 'This version is still a merchant draft and cannot be paid.' },
  awaiting_buyer: { kind: 'pending', text: 'Waiting for the client to approve this version.' },
  superseded: { kind: 'info', text: 'A newer version replaced this one. It can never be paid.' },
  rejected: { kind: 'error', text: 'The merchant rejected this version.' }
};

/**
 * Step 4 — the reconciled receipt.
 *
 * This page never infers payment from a browser event: it renders the stored
 * provider status and capture id, and offers an explicit refresh that re-reads
 * the order at PayPal.
 */
export function ReceiptPage({
  view,
  refresh,
  autoCaptureNote
}: {
  view: ScopeViewResponse;
  refresh: () => Promise<void>;
  autoCaptureNote: string | null;
}) {
  const { scope } = view;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [reconcileNote, setReconcileNote] = useState<string | null>(autoCaptureNote);
  const latest = view.attempts[view.attempts.length - 1] ?? null;
  const statusInfo = STATUS_TEXT[scope.status] ?? { kind: 'info' as const, text: `Status ${scope.status}.` };

  async function reconcile() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.reconcile(scope.id, latest?.paypalOrderId ? { orderId: latest.paypalOrderId } : {});
      setReconcileNote(
        result.attempt
          ? `Refreshed from ${result.source}. Provider status ${result.providerStatus ?? 'unknown'}${result.changed ? ' · local state changed' : ' · no change'}.`
          : 'No PayPal order exists for this scope yet, so there is nothing to reconcile.'
      );
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? { message: caught.failure.message, details: caught.failure.details }
          : { message: (caught as Error).message, details: [] }
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Receipt</h1>
      <SandboxNotice paypalConfigured={true} />
      <div className="card">
        <StatusMessage kind={statusInfo.kind}>{statusInfo.text}</StatusMessage>
        {latest ? (
          <dl className="definition">
            <dt>PayPal sandbox order</dt>
            <dd className="hash">{latest.paypalOrderId ?? 'not created'}</dd>
            <dt>Capture id</dt>
            <dd className="hash">{latest.captureId ?? 'none — no capture has completed'}</dd>
            <dt>Provider status</dt>
            <dd>
              {latest.providerStatus ?? 'not reported'} <span className="tag">local state: {latest.state}</span>
            </dd>
            <dt>Amount bound to this order</dt>
            <dd>
              {(latest.expectedAmountMinor / 100).toFixed(2)} {latest.expectedCurrency}{' '}
              <span className="muted">
                (order hash {latest.scopeHash.slice(0, 12)} · current version hash {scope.hash.slice(0, 12)})
              </span>
            </dd>
            <dt>Last updated</dt>
            <dd>{new Date(latest.updatedAt).toLocaleString()}</dd>
          </dl>
        ) : (
          <p className="muted">No payment attempt has been recorded for this version.</p>
        )}
        {latest?.lastError ? <StatusMessage kind="error">{latest.lastError}</StatusMessage> : null}
        <div className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={reconcile}>
            {busy ? 'Asking PayPal…' : 'Refresh status from PayPal'}
          </button>
          <span className="muted">
            A sandbox capture that PayPal reports as pending stays pending here. A declined capture stays declined.
            Refunds are outside this build and no refund control is shown.
          </span>
        </div>
        {reconcileNote ? <StatusMessage kind="info">{reconcileNote}</StatusMessage> : null}
        {error ? <FailureNotice title={error.message} details={error.details} /> : null}
      </div>

      <div className="card">
        <h2>The version that was paid</h2>
        <ScopeMeta scope={scope} currency={scope.currency} />
        <BreakdownTable rows={view.breakdown} total={scope.amountMinor} currency={scope.currency} />
        {view.acceptance ? (
          <p className="muted">
            Approved by {view.acceptance.actor} on {new Date(view.acceptance.acceptedAt).toLocaleString()} against hash{' '}
            <span className="hash">{view.acceptance.hash}</span>.
          </p>
        ) : null}
      </div>
    </section>
  );
}
