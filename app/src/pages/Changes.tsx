import { useEffect, useState } from 'react';
import { ApiError, api, type ChangeFixture, type ChangeResponse, type ScopeViewResponse } from '../api.js';
import { ExclusionsList, FailureNotice, SandboxNotice, ScopeLines, StatusMessage, VersionHistory } from '../components/ScopeParts.js';

/**
 * Step 5 — what happens after agreement.
 *
 * A change request is classified by the model and priced by the server. It always
 * produces a new version; a paid version is never rewritten and never silently
 * charged again.
 */
export function ChangesPage({
  view,
  briefText,
  refresh,
  onVersionCreated
}: {
  view: ScopeViewResponse;
  briefText: string | null;
  refresh: () => Promise<void>;
  onVersionCreated: (scopeId: string) => void;
}) {
  const { scope } = view;
  const [text, setText] = useState('');
  const [requestedBy, setRequestedBy] = useState('client@example.test');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChangeResponse | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [fixtures, setFixtures] = useState<ChangeFixture[]>([]);

  useEffect(() => {
    api
      .fixtures()
      .then((payload) => setFixtures(payload.changes))
      .catch(() => setFixtures([]));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const classified = await api.requestChange(scope.id, { text, requestedBy });
      setResult(classified);
      // A priced change produces a new version; follow it so the page keeps
      // showing the version that is actually payable next.
      if (classified.createdNewVersion) {
        onVersionCreated(classified.currentScope.id);
      }
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
      <h1>Request a change</h1>
      <p className="muted">
        Describe the change in your own words. It is classified against the agreed scope, priced by the server from the
        catalog, and becomes a new version the merchant still has to approve.
      </p>
      <SandboxNotice paypalConfigured={true} />

      <div className="card">
        <label htmlFor="change">What changed?</label>
        <textarea id="change" value={text} onChange={(event) => setText(event.target.value)} />
        <label htmlFor="requestedBy">Requested by</label>
        <input id="requestedBy" type="text" value={requestedBy} onChange={(event) => setRequestedBy(event.target.value)} />
        <div className="actions">
          <button type="button" disabled={busy || text.trim().length < 5} onClick={submit}>
            {busy ? 'Classifying…' : 'Classify change'}
          </button>
        </div>
        {fixtures.length > 0 ? (
          <p className="muted">
            Synthetic change fixtures:{' '}
            {fixtures.slice(0, 10).map((fixture, index) => (
              <span key={fixture.id}>
                {index > 0 ? ' · ' : ''}
                <button type="button" className="secondary" onClick={() => setText(fixture.text)}>
                  {fixture.kind.replace(/_/g, ' ')}
                </button>
              </span>
            ))}
          </p>
        ) : null}
        {error ? <FailureNotice title={error.message} details={error.details} /> : null}
      </div>

      {result ? (
        <div className="card">
          <h2>Assessment</h2>
          <dl className="definition">
            <dt>Change class</dt>
            <dd>
              {result.assessment.changeClass.replace(/_/g, ' ')}{' '}
              <span className="tag">{result.assessment.confident ? 'confident' : 'needs a human decision'}</span>
            </dd>
            <dt>What the model understood</dt>
            <dd>{result.assessment.summary}</dd>
            {result.assessment.modelNotes ? (
              <>
                <dt>Model notes</dt>
                <dd className="muted">{result.assessment.modelNotes}</dd>
              </>
            ) : null}
            <dt>Price difference</dt>
            <dd>
              {result.deltaFormatted} <span className="muted">computed on the server from the catalog, not by the model</span>
            </dd>
            <dt>Paid version</dt>
            <dd>
              {result.supersededPaidVersion
                ? 'The paid version keeps its own receipt and is never rewritten. The new version is a separate proposal.'
                : 'The previously accepted version was superseded by the new version.'}
            </dd>
          </dl>
          {result.warnings.length > 0 ? (
            <StatusMessage kind="pending">
              Adjustments made to the model output:
              <ul className="pill-list">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </StatusMessage>
          ) : null}
          {result.assessment.lines.length === 0 ? (
            <StatusMessage kind="pending">
              The model mapped no catalog line to this request, so nothing was repriced and the agreed version was left
              untouched. A person has to decide whether catalog work is involved before anything can be charged.
            </StatusMessage>
          ) : null}
          <h3>Lines on the current version</h3>
          <ScopeLines scope={result.currentScope} briefText={briefText ?? undefined} />
          <h3>Exclusions on the new version</h3>
          <ExclusionsList exclusions={result.currentScope.exclusions} />
          <StatusMessage kind="pending">
            Nothing is charged by this change request. The merchant must approve version {result.currentScope.version}, and the
            client must approve it again before any further sandbox payment can be created.
          </StatusMessage>
        </div>
      ) : null}

      <div className="card">
        <h2>Version history</h2>
        <VersionHistory history={view.history} />
      </div>
    </section>
  );
}
