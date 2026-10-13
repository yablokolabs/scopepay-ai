import { useState } from 'react';
import { ApiError, api, type CatalogItemView, type Scope, type ScopeLine, type ScopeViewResponse } from '../api.js';
import { BreakdownTable, FailureNotice, ExclusionsList, SandboxNotice, ScopeLines, ScopeMeta, StatusMessage } from '../components/ScopeParts.js';

/**
 * Step 2 — merchant review.
 *
 * The merchant is the only actor with pricing authority, and even here only
 * quantity is editable: unit prices are catalog data. Approving creates a new
 * immutable version and hands it to the client.
 */
export function ReviewPage({
  view,
  catalog,
  catalogVersion,
  briefText,
  refresh,
  onApproved
}: {
  view: ScopeViewResponse;
  catalog: CatalogItemView[];
  catalogVersion: string;
  briefText: string | null;
  refresh: () => Promise<void>;
  onApproved: (scope: Scope) => void;
}) {
  const { scope } = view;
  const [lines, setLines] = useState<ScopeLine[]>(scope.lines);
  const [exclusions, setExclusions] = useState<string[]>(scope.exclusions);
  const [revisionLimit, setRevisionLimit] = useState<string>(scope.revisionLimit === null ? '' : String(scope.revisionLimit));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const projectedTotal = lines.reduce((total, line) => {
    const item = catalog.find((candidate) => candidate.id === line.catalogItemId);
    return total + (item ? item.unitPriceMinor * line.quantity : 0);
  }, 0);

  function updateQuantity(catalogItemId: string, quantity: number) {
    setLines((current) => current.map((line) => (line.catalogItemId === catalogItemId ? { ...line, quantity } : line)));
  }

  function removeLine(catalogItemId: string) {
    setLines((current) => current.filter((line) => line.catalogItemId !== catalogItemId));
  }

  function addLine(catalogItemId: string) {
    const item = catalog.find((candidate) => candidate.id === catalogItemId);
    if (!item) return;
    setLines((current) => [
      ...current,
      { catalogItemId, quantity: item.minQty, sourceSpan: null, rationale: 'Added by the merchant during review.' }
    ]);
  }

  async function send(action: 'approve' | 'edit' | 'reject') {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.review(scope.id, {
        action,
        actor: 'merchant@example.test',
        note,
        ...(action === 'reject' ? {} : { lines, exclusions, revisionLimit: revisionLimit === '' ? null : Number(revisionLimit) })
      });
      setMessage(
        action === 'reject'
          ? 'The proposal was rejected and cannot be paid.'
          : `Version ${result.scope.version} is now ${result.scope.status.replace(/_/g, ' ')} at ${result.amountFormatted}.`
      );
      await refresh();
      onApproved(result.scope);
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

  const isDraft = scope.status === 'draft';

  return (
    <section>
      <h1>Merchant review</h1>
      <p className="muted">
        You decide what the client is buying. The M0 model only proposed it — proposals are not payable, and an approved
        version can never be edited in place.
      </p>
      <SandboxNotice paypalConfigured={true} />

      <div className="card">
        <ScopeMeta scope={scope} currency={scope.currency} />
        <h2>Proposed by {scope.createdBy}</h2>
        <ScopeLines scope={{ ...scope, lines }} briefText={briefText ?? undefined} />
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Line items</h2>
          <p className="muted">
            Unit prices are catalog data (catalog {catalogVersion}). You can change quantities and remove lines; you cannot
            type a price.
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Quantity</th>
                <th scope="col" className="amount">
                  Unit price
                </th>
                <th scope="col" className="amount">
                  Line total
                </th>
                <th scope="col">Remove</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const item = catalog.find((candidate) => candidate.id === line.catalogItemId);
                return (
                  <tr key={line.catalogItemId}>
                    <td>{item?.label ?? line.catalogItemId}</td>
                    <td>
                      <label className="muted" htmlFor={`qty-${line.catalogItemId}`}>
                        Quantity for {item?.label ?? line.catalogItemId}
                      </label>
                      <input
                        id={`qty-${line.catalogItemId}`}
                        type="text"
                        inputMode="numeric"
                        style={{ width: '5rem' }}
                        value={line.quantity}
                        disabled={!isDraft}
                        onChange={(event) => {
                          const parsed = Number.parseInt(event.target.value.replace(/\D/g, ''), 10);
                          updateQuantity(line.catalogItemId, Number.isFinite(parsed) ? parsed : item?.minQty ?? 1);
                        }}
                      />
                      <div className="muted">
                        {item ? `allowed ${item.minQty}–${item.maxQty} ${item.unit}` : 'unknown item — the server will reject it'}
                      </div>
                    </td>
                    <td className="amount">{item ? (item.unitPriceMinor / 100).toFixed(2) : '—'}</td>
                    <td className="amount">{item ? ((item.unitPriceMinor * line.quantity) / 100).toFixed(2) : '—'}</td>
                    <td>
                      <button type="button" className="secondary" disabled={!isDraft} onClick={() => removeLine(line.catalogItemId)}>
                        Remove {item?.label ?? line.catalogItemId}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label htmlFor="add-line">Add a catalog item</label>
          <select
            id="add-line"
            defaultValue=""
            disabled={!isDraft}
            onChange={(event) => {
              if (event.target.value) addLine(event.target.value);
              event.target.value = '';
            }}
          >
            <option value="">Choose an item…</option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} — {(item.unitPriceMinor / 100).toFixed(2)} {scope.currency} per {item.unit}
              </option>
            ))}
          </select>
          <p className="total">Projected total: {(projectedTotal / 100).toFixed(2)} {scope.currency}</p>
          <p className="muted">The server recomputes this from the catalog when you send the version.</p>
        </div>

        <div className="card">
          <h2>Exclusions and revisions</h2>
          <p className="muted">Exclusions are shown to the client verbatim before they approve anything.</p>
          <ul className="pill-list">
            {exclusions.map((exclusion) => (
              <li key={exclusion}>
                {exclusion}{' '}
                <button
                  type="button"
                  className="secondary"
                  disabled={!isDraft}
                  onClick={() => setExclusions((current) => current.filter((candidate) => candidate !== exclusion))}
                >
                  Remove exclusion: {exclusion}
                </button>
              </li>
            ))}
          </ul>
          <label htmlFor="revision-limit">Revisions included</label>
          <input
            id="revision-limit"
            type="text"
            inputMode="numeric"
            style={{ width: '5rem' }}
            value={revisionLimit}
            disabled={!isDraft}
            onChange={(event) => setRevisionLimit(event.target.value.replace(/\D/g, ''))}
          />
          <label htmlFor="note">Review note (kept on the version)</label>
          <textarea id="note" value={note} onChange={(event) => setNote(event.target.value)} style={{ minHeight: '5rem' }} />
          <div className="actions">
            <button type="button" disabled={busy || !isDraft} onClick={() => send(lines.length === scope.lines.length ? 'approve' : 'edit')}>
              {busy ? 'Sending…' : 'Approve and send to client'}
            </button>
            <button type="button" className="secondary" disabled={busy || !isDraft} onClick={() => send('reject')}>
              Reject proposal
            </button>
          </div>
          {!isDraft ? <StatusMessage kind="info">This version is {scope.status.replace(/_/g, ' ')} and can no longer be reviewed.</StatusMessage> : null}
          {message ? <StatusMessage kind="success">{message}</StatusMessage> : null}
          {error ? <FailureNotice title={error.message} details={error.details} /> : null}
        </div>
      </div>

      <div className="card">
        <h2>Exclusions currently on this version</h2>
        <ExclusionsList exclusions={scope.exclusions} />
        <h2>Price breakdown as the client will see it</h2>
        <BreakdownTable rows={view.breakdown} total={scope.amountMinor} currency={scope.currency} />
      </div>
    </section>
  );
}
