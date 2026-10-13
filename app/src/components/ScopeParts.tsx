import type { BreakdownRow, Scope } from '../api.js';
import { formatMinor } from '../api.js';

/**
 * Sandbox notice. Shown wherever money is mentioned. It states the real
 * integration state instead of implying a working payment when none exists.
 */
export function SandboxNotice({ paypalConfigured }: { paypalConfigured: boolean }) {
  return (
    <p className="sandbox-banner" role="note">
      <strong>SANDBOX ONLY.</strong> Every payment in this build is a PayPal developer sandbox order.
      No real money moves, no customer is charged and no live PayPal credentials are supported by design.{' '}
      {paypalConfigured
        ? 'Sandbox credentials are configured on the server.'
        : 'Sandbox credentials are not configured yet, so payment routes answer 503 until the merchant sets them.'}
    </p>
  );
}

export function StatusMessage({ kind, children }: { kind: 'info' | 'error' | 'success' | 'pending'; children: React.ReactNode }) {
  return (
    <p className="status" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'} aria-live="polite">
      {children}
    </p>
  );
}

export function FailureNotice({ title, details }: { title: string; details: string[] }) {
  return (
    <div className="status" data-kind="error" role="alert">
      <strong>{title}</strong>
      {details.length > 0 ? (
        <ul className="pill-list">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Price breakdown rendered from catalog data only; never from model text. */
export function BreakdownTable({ rows, total, currency }: { rows: BreakdownRow[]; total: number; currency: string }) {
  return (
    <table>
      <caption className="muted">Unit prices come from the merchant catalog. The total is recomputed on the server.</caption>
      <thead>
        <tr>
          <th scope="col">Catalog item</th>
          <th scope="col">Deliverable</th>
          <th scope="col" className="amount">
            Qty
          </th>
          <th scope="col" className="amount">
            Unit
          </th>
          <th scope="col" className="amount">
            Line total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.catalogItemId}>
            <td>{row.label}</td>
            <td>{row.deliverable}</td>
            <td className="amount">
              {row.quantity} {row.unit}
            </td>
            <td className="amount">{formatMinor(row.unitPriceMinor, currency)}</td>
            <td className="amount">{formatMinor(row.lineTotalMinor, currency)}</td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5}>No billable lines yet. Nothing can be paid until the merchant approves a priced scope.</td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4}>
            <span className="total">Total</span>{' '}
            <span className="muted">(no tax or shipping is charged in this catalog)</span>
          </td>
          <td className="amount total">{formatMinor(total, currency)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * The scope lines with the exact brief text they were derived from, so the buyer
 * can check the quote rather than trust a summary.
 */
export function ScopeLines({ scope, briefText }: { scope: Scope; briefText?: string }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {scope.lines.map((line) => (
        <li key={line.catalogItemId} style={{ marginBottom: '0.9rem' }}>
          <strong>{line.catalogItemId}</strong> <span className="tag">qty {line.quantity}</span>
          {line.rationale ? <div className="muted">{line.rationale}</div> : null}
          {line.sourceSpan ? (
            <>
              <span className="quote">“{line.sourceSpan.quote}”</span>
              <div className="muted">
                brief characters {line.sourceSpan.start}–{line.sourceSpan.end} of this version
              </div>
            </>
          ) : (
            <div className="muted">No brief quote is attached to this line; the merchant added it directly.</div>
          )}
        </li>
      ))}
      {scope.lines.length === 0 ? <li className="muted">No catalog lines in this version.</li> : null}
      {briefText ? (
        <li>
          <details>
            <summary>Show the brief this version was built from</summary>
            <p className="pre">{briefText}</p>
          </details>
        </li>
      ) : null}
    </ul>
  );
}

export function ExclusionsList({ exclusions }: { exclusions: string[] }) {
  return (
    <ul className="pill-list">
      {exclusions.map((exclusion) => (
        <li key={exclusion}>{exclusion}</li>
      ))}
    </ul>
  );
}

export function ScopeMeta({ scope, currency }: { scope: Scope; currency: string }) {
  return (
    <dl className="definition">
      <dt>Version</dt>
      <dd>
        v{scope.version} <span className="tag">{scope.status.replace(/_/g, ' ')}</span>
        {scope.parentId ? <span className="muted"> · derived from {scope.parentId}</span> : null}
      </dd>
      <dt>Amount</dt>
      <dd>
        {formatMinor(scope.amountMinor, currency)} <span className="muted">· catalog {scope.catalogVersion}</span>
      </dd>
      <dt>Revision limit</dt>
      <dd>{scope.revisionLimit === null ? 'not set' : `${scope.revisionLimit} revision${scope.revisionLimit === 1 ? '' : 's'}`}</dd>
      <dt>Version hash</dt>
      <dd className="hash">{scope.hash}</dd>
    </dl>
  );
}

export function VersionHistory({ history }: { history: Scope[] }) {
  if (history.length === 0) return null;
  return (
    <table>
      <caption className="muted">Every change to this brief creates a new immutable version. Paid versions are never rewritten.</caption>
      <thead>
        <tr>
          <th scope="col">Version</th>
          <th scope="col">Status</th>
          <th scope="col">Amount</th>
          <th scope="col">Created</th>
        </tr>
      </thead>
      <tbody>
        {history.map((version) => (
          <tr key={version.id}>
            <td>
              v{version.version} <span className="hash">{version.hash.slice(0, 12)}</span>
            </td>
            <td>{version.status.replace(/_/g, ' ')}</td>
            <td>{formatMinor(version.amountMinor, version.currency)}</td>
            <td>{new Date(version.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
