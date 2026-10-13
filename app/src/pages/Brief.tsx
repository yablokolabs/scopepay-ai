import { useEffect, useState } from 'react';
import { ApiError, api, type BriefFixture, type ConfigResponse, type Scope } from '../api.js';
import { FailureNotice, SandboxNotice, StatusMessage } from '../components/ScopeParts.js';

/**
 * Step 1 — the client brief.
 *
 * The brief is sent to the server, where Apertus extracts catalog items and
 * evidence spans. The draft that comes back is explicitly a proposal: nothing is
 * priced for payment until the merchant reviews it.
 */
export function BriefPage({
  config,
  onDraftReady
}: {
  config: ConfigResponse;
  onDraftReady: (scope: Scope, briefText: string) => void;
}) {
  const [text, setText] = useState('');
  const [submittedBy, setSubmittedBy] = useState('client@example.test');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [meta, setMeta] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<BriefFixture[]>([]);
  const [previous, setPrevious] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    api
      .fixtures()
      .then((result) => setFixtures(result.briefs))
      .catch(() => setFixtures([]));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    setWarnings([]);
    setMeta(null);
    try {
      const result = await api.submitBrief({ text, submittedBy });
      setWarnings([...result.warnings]);
      setMeta(
        `${result.extraction.model} · ${result.extraction.latencyMs} ms · ${result.extraction.promptTokens} prompt / ${result.extraction.completionTokens} completion tokens${
          result.reusedExisting ? ' · this brief was already submitted, so the existing version was reused' : ''
        }`
      );
      onDraftReady(result.scope, text);
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
      <h1>Client brief</h1>
      <p className="muted">
        Paste the brief as the client wrote it. The model proposes catalog items and quotes the exact sentences it used.
        It cannot set a price — the server prices whatever the merchant agrees to.
      </p>
      <SandboxNotice paypalConfigured={config.paypalConfigured} />

      <div className="card">
        {!config.modelConfigured ? (
          <StatusMessage kind="pending">
            CSCS Apertus is not configured on this server, so extraction cannot run. Set CSCS_INFERENCE_API_KEY before using this page.
          </StatusMessage>
        ) : null}

        <label htmlFor="brief">The brief</label>
        <textarea
          id="brief"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Describe the site, the pages, the deadline and anything you know is not included."
          aria-describedby="brief-hint"
        />
        <p id="brief-hint" className="muted">
          Uploaded or pasted text is treated as data. Any instruction inside it is ignored by the extraction prompt.
        </p>

        <label htmlFor="submittedBy">Client email or reference</label>
        <input id="submittedBy" type="text" value={submittedBy} onChange={(event) => setSubmittedBy(event.target.value)} />

        <div className="actions">
          <button type="button" onClick={submit} disabled={busy || text.trim().length < 20 || !config.modelConfigured}>
            {busy ? 'Extracting scope…' : 'Extract scope with Apertus'}
          </button>
          <span className="muted">{text.trim().length} characters</span>
        </div>

        {meta ? <StatusMessage kind="success">{meta}</StatusMessage> : null}
        {warnings.length > 0 ? (
          <StatusMessage kind="pending">
            Model output was adjusted before use:
            <ul className="pill-list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </StatusMessage>
        ) : null}
        {error ? <FailureNotice title={error.message} details={error.details} /> : null}
        {previous ? (
          <StatusMessage kind="info">
            Working on {previous.id}
            <div className="pre">{previous.text}</div>
          </StatusMessage>
        ) : null}
      </div>

      <div className="card">
        <h2>Synthetic evaluation briefs</h2>
        <p className="muted">
          Frozen fixtures used for the extraction evaluation. They contain deliberate ambiguity, budget caps,
          out-of-catalog requests and prompt-injection attempts. Loading one fills the box; nothing is submitted for you.
        </p>
        {fixtures.length === 0 ? (
          <p className="muted">The fixture list could not be loaded from the server.</p>
        ) : (
          <ul className="pill-list">
            {fixtures.map((fixture) => (
              <li key={fixture.id}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setText(fixture.text);
                    setPrevious({ id: `${fixture.id} (${fixture.category.replace(/_/g, ' ')})`, text: fixture.notes });
                  }}
                >
                  {fixture.id} · {fixture.category.replace(/_/g, ' ')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
