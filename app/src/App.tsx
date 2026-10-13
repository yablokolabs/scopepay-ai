import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type CatalogItemView, type ConfigResponse, type ScopeViewResponse } from './api.js';
import { FailureNotice } from './components/ScopeParts.js';
import { BriefPage } from './pages/Brief.js';
import { ChangesPage } from './pages/Changes.js';
import { ClientPage } from './pages/Client.js';
import { ReceiptPage } from './pages/Receipt.js';
import { ReviewPage } from './pages/Review.js';
import { SandboxStatusPage } from './pages/SandboxStatus.js';
import type { Scope } from './api.js';

type Step = 'brief' | 'review' | 'client' | 'receipt' | 'changes' | 'status';

const STEPS: { step: Step; label: string; needsScope: boolean }[] = [
  { step: 'brief', label: '1. Brief', needsScope: false },
  { step: 'review', label: '2. Merchant review', needsScope: true },
  { step: 'client', label: '3. Client approval', needsScope: true },
  { step: 'receipt', label: '4. Sandbox receipt', needsScope: true },
  { step: 'changes', label: '5. Change request', needsScope: true },
  { step: 'status', label: 'Sandbox state', needsScope: false }
];

interface Route {
  step: Step;
  scopeId: string | null;
  returningFromPaypal: boolean;
}

function parseRoute(): Route {
  const search = new URLSearchParams(window.location.search);
  if (window.location.pathname.startsWith('/checkout/return')) {
    return { step: 'receipt', scopeId: search.get('scope'), returningFromPaypal: true };
  }
  if (window.location.pathname.startsWith('/checkout/cancel')) {
    return { step: 'client', scopeId: search.get('scope'), returningFromPaypal: false };
  }
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [step, scopeId] = hash.split('/');
  const known = STEPS.some((candidate) => candidate.step === step);
  return { step: known ? (step as Step) : 'brief', scopeId: scopeId && scopeId.length > 0 ? scopeId : null, returningFromPaypal: false };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogItemView[]>([]);
  const [view, setView] = useState<ScopeViewResponse | null>(null);
  const [briefText, setBriefText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; details: string[] } | null>(null);
  const [captureNote, setCaptureNote] = useState<string | null>(null);

  useEffect(() => {
    const onNavigate = () => {
      setRoute(parseRoute());
      setCaptureNote(null);
    };
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('popstate', onNavigate);
    return () => {
      window.removeEventListener('hashchange', onNavigate);
      window.removeEventListener('popstate', onNavigate);
    };
  }, []);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch((caught) =>
        setLoadError(
          caught instanceof ApiError
            ? { message: caught.failure.message, details: caught.failure.details }
            : { message: (caught as Error).message, details: [] }
        )
      );
    api
      .config()
      .then(() => requestCatalog())
      .catch(() => setCatalog([]));
  }, []);

  async function requestCatalog() {
    const response = await fetch('/api/catalog');
    if (!response.ok) return;
    const payload = (await response.json()) as { catalog: { items: CatalogItemView[] } };
    setCatalog(payload.catalog.items);
  }

  const loadScope = useCallback(async (scopeId: string) => {
    try {
      const loaded = await api.scope(scopeId);
      setView(loaded);
      setLoadError(null);
      const stored = window.sessionStorage.getItem(`scopepay.brief.${scopeId}`);
      if (stored) setBriefText(stored);
      return loaded;
    } catch (caught) {
      setView(null);
      setLoadError(
        caught instanceof ApiError
          ? { message: caught.failure.message, details: caught.failure.details }
          : { message: (caught as Error).message, details: [] }
      );
      return null;
    }
  }, []);

  useEffect(() => {
    if (route.scopeId) {
      void loadScope(route.scopeId);
    } else {
      setView(null);
    }
  }, [route.scopeId, loadScope]);

  // Returning from PayPal: the server re-reads the order and captures it. The
  // browser landing here is not treated as proof; the receipt shows what PayPal said.
  useEffect(() => {
    if (!route.returningFromPaypal || !route.scopeId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.capture(route.scopeId as string, {});
        if (cancelled) return;
        setCaptureNote(`${result.message} (PayPal has now confirmed: ${result.captured ? 'captured' : 'not captured'}).`);
        await loadScope(route.scopeId as string);
      } catch (caught) {
        if (cancelled) return;
        setCaptureNote(
          caught instanceof ApiError
            ? `Capture was refused: ${caught.failure.message} ${caught.failure.details.join(' ')}`
            : `Capture failed: ${(caught as Error).message}`
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.returningFromPaypal, route.scopeId, loadScope]);

  function rememberBrief(scope: Scope, text: string) {
    window.sessionStorage.setItem(`scopepay.brief.${scope.id}`, text);
    setBriefText(text);
  }

  function navigate(step: Step, scopeId: string | null) {
    const target = scopeId ? `#/${step}/${scopeId}` : `#/${step}`;
    if (window.location.pathname !== '/') {
      window.history.replaceState(null, '', target);
      setRoute({ step, scopeId, returningFromPaypal: false });
      return;
    }
    window.location.hash = target;
  }

  const scopeId = route.scopeId ?? view?.scope.id ?? null;

  return (
    <div className="page">
      <header className="masthead">
        <h1 style={{ fontSize: '1.9rem', marginBottom: '0.15rem' }}>ScopePay</h1>
        <p>
          Agree on the work. Approve the payment. <span className="sandbox-tag">SANDBOX</span>
        </p>
      </header>

      <nav aria-label="ScopePay steps">
        <ol className="steps">
          {STEPS.map((entry) => {
            const disabled = entry.needsScope && !scopeId;
            return (
              <li key={entry.step} aria-current={route.step === entry.step ? 'step' : undefined}>
                {disabled ? (
                  <span className="muted">{entry.label}</span>
                ) : (
                  <a
                    href={scopeId ? `#/${entry.step}/${scopeId}` : `#/${entry.step}`}
                    onClick={(event) => {
                      if (window.location.pathname === '/') return;
                      event.preventDefault();
                      navigate(entry.step, scopeId);
                    }}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {entry.label}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {loadError ? <FailureNotice title={loadError.message} details={loadError.details} /> : null}

      {!config ? (
        <p className="muted">Loading the sandbox configuration…</p>
      ) : route.step === 'status' ? (
        <SandboxStatusPage config={config} />
      ) : route.step === 'brief' || !view ? (
        <BriefPage
          config={config}
          onDraftReady={(scope, text) => {
            rememberBrief(scope, text);
            void loadScope(scope.id);
            navigate('review', scope.id);
          }}
        />
      ) : route.step === 'review' ? (
        <ReviewPage
          view={view}
          catalog={catalog}
          catalogVersion={config.catalogVersion}
          briefText={briefText}
          refresh={() => loadScope(view.scope.id).then(() => undefined)}
          onApproved={(scope) => navigate('client', scope.id)}
        />
      ) : route.step === 'client' ? (
        <ClientPage
          view={view}
          config={config}
          briefText={briefText}
          refresh={() => loadScope(view.scope.id).then(() => undefined)}
          onPaid={(id) => navigate('receipt', id)}
        />
      ) : route.step === 'receipt' ? (
        <ReceiptPage view={view} refresh={() => loadScope(view.scope.id).then(() => undefined)} autoCaptureNote={captureNote} />
      ) : (
        <ChangesPage
          view={view}
          briefText={briefText}
          refresh={() => loadScope(view.scope.id).then(() => undefined)}
          onVersionCreated={(id) => {
            void loadScope(id);
            navigate('changes', id);
          }}
        />
      )}
    </div>
  );
}
