import { useState } from 'react';
import { ApiError, api, type ConfigResponse, type PaymentAttemptView, type ScopeViewResponse } from '../api.js';
import { BreakdownTable, ExclusionsList, FailureNotice, SandboxNotice, ScopeLines, ScopeMeta, StatusMessage } from '../components/ScopeParts.js';

/**
 * Step 3 — the client approves a specific version, then pays in the sandbox.
 *
 * Approval requires an explicit confirmation of the amount and the exact version
 * hash. If a newer version exists, this page refuses to start a payment and says
 * so, rather than charging a stale amount.
 */
export function ClientPage({
  view,
  config,
  briefText,
  refresh,
  onPaid
}: {
  view: ScopeViewResponse;
  config: ConfigResponse;
  briefText: string | null;
  refresh: () => Promise<void>;
  onPaid: (scopeId: string, orderId: string | null) => void;
}) {
  const { scope } = view;
  const [actor, setActor] = useState('client@example.test');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [order, setOrder] = useState<{ attempt: PaymentAttemptView; approvalUrl: string | null; reused: boolean } | null>(null);
  const [capture, setCapture] = useState<{ captured: boolean; message: string } | null>(null);

  const payable = scope.status === 'awaiting_buyer' || scope.status === 'accepted' || scope.status === 'order_created';

  async function approveAndCreateOrder() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createOrder(scope.id, {
        hash: scope.hash,
        actor,
        confirmedAmountMinor: scope.amountMinor,
        confirmedCurrency: scope.currency as 'USD'
      });
      setOrder({ attempt: result.attempt, approvalUrl: result.approvalUrl, reused: result.reusedExistingOrder });
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

  async function captureNow(orderId?: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.capture(scope.id, orderId ? { orderId } : {});
      setCapture({ captured: result.captured, message: result.message });
      await refresh();
      onPaid(scope.id, orderId ?? null);
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

  const liveAttempt = view.attempts.find((attempt) => attempt.state === 'created' || attempt.state === 'approved');

  return (
    <section>
      <h1>Your agreed scope</h1>
      <p className="muted">
        Read the deliverables, the exclusions and the revisions included. Approving records this exact version and amount;
        anything agreed later becomes a new version with its own price.
      </p>
      <SandboxNotice paypalConfigured={config.paypalConfigured} />

      <div className="card">
        <ScopeMeta scope={scope} currency={scope.currency} />
        {view.acceptance ? (
          <StatusMessage kind="success">
            Accepted by {view.acceptance.actor} on {new Date(view.acceptance.acceptedAt).toLocaleString()} for{' '}
            {(view.acceptance.confirmedAmountMinor / 100).toFixed(2)} {scope.currency}.
          </StatusMessage>
        ) : null}
        <h2>What you are buying</h2>
        <BreakdownTable rows={view.breakdown} total={scope.amountMinor} currency={scope.currency} />
        <h2>Clauses traced to your brief</h2>
        <ScopeLines scope={scope} briefText={briefText ?? undefined} />
        <h2>Not included</h2>
        <ExclusionsList exclusions={scope.exclusions} />
      </div>

      <div className="card">
        <h2>Approve and pay <span className="sandbox-tag">SANDBOX</span></h2>
        {!payable ? (
          <StatusMessage kind={scope.status === 'paid' ? 'success' : 'pending'}>
            This version is {scope.status.replace(/_/g, ' ')}. {scope.status === 'paid' ? 'It is already paid.' : 'The merchant must approve it before it can be paid.'}
          </StatusMessage>
        ) : null}

        <label htmlFor="actor">Your name or email</label>
        <input id="actor" type="text" value={actor} onChange={(event) => setActor(event.target.value)} />

        <div className="check-row">
          <input
            id="confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            aria-describedby="confirm-help"
          />
          <label htmlFor="confirm" style={{ fontWeight: 400 }}>
            I have read the deliverables and exclusions, and I approve scope version {scope.version} at{' '}
            <strong>
              {(scope.amountMinor / 100).toFixed(2)} {scope.currency}
            </strong>{' '}
            with hash <span className="hash">{scope.hash.slice(0, 16)}…</span>
          </label>
        </div>
        <p id="confirm-help" className="muted">
          The server compares the approved amount and hash with the stored version. A mismatch stops checkout before an
          order exists.
        </p>

        <div className="actions">
          <button
            type="button"
            disabled={busy || !confirmed || !payable || !config.paypalConfigured}
            onClick={approveAndCreateOrder}
          >
            {busy ? 'Talking to PayPal…' : 'Approve and create sandbox order'}
          </button>
          {!config.paypalConfigured ? (
            <span className="muted">PayPal sandbox credentials are not configured, so this control is disabled rather than faked.</span>
          ) : null}
        </div>

        {order ? (
          <StatusMessage kind="pending">
            {order.reused ? 'That order already existed, so it was reused instead of buying twice. ' : 'A sandbox order was created. '}
            Order {order.attempt.paypalOrderId} · state {order.attempt.state} · provider status {order.attempt.providerStatus ?? 'not yet reported'}.
            {order.approvalUrl ? (
              <>
                {' '}
                <a href={order.approvalUrl}>Continue to the PayPal sandbox approval page</a>. PayPal returns you here and the
                server captures only after the provider reports an approved order.
              </>
            ) : (
              ' PayPal did not return an approval link for this order.'
            )}
          </StatusMessage>
        ) : null}

        {order || liveAttempt ? (
          <div className="actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => captureNow(order?.attempt.paypalOrderId ?? liveAttempt?.paypalOrderId ?? undefined)}>
              I approved this order — capture it now
            </button>
            <span className="muted">
              Capture is a server call that re-reads the order at PayPal first. A browser-side approval is not treated as proof of payment.
            </span>
          </div>
        ) : null}

        {capture ? (
          <StatusMessage kind={capture.captured ? 'success' : 'pending'}>{capture.message}</StatusMessage>
        ) : null}
        {error ? <FailureNotice title={error.message} details={error.details} /> : null}
      </div>
    </section>
  );
}
