/**
 * Typed client for the ScopePay API.
 *
 * The browser never computes a price and never sends one it was told by the
 * model: amounts shown here are echoed back to the server for comparison only.
 */

export interface CatalogItemView {
  id: string;
  label: string;
  unitPriceMinor: number;
  minQty: number;
  maxQty: number;
  unit: string;
  deliverableTemplate: string;
  description: string;
}

export interface BreakdownRow {
  catalogItemId: string;
  label: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  deliverable: string;
}

export interface ScopeLine {
  catalogItemId: string;
  quantity: number;
  sourceSpan: { start: number; end: number; quote: string } | null;
  rationale: string;
}

export interface Scope {
  id: string;
  parentId: string | null;
  briefId: string;
  version: number;
  catalogVersion: string;
  lines: ScopeLine[];
  exclusions: string[];
  revisionLimit: number | null;
  amountMinor: number;
  currency: string;
  hash: string;
  status: string;
  createdBy: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewAction: string | null;
  reviewNote: string | null;
}

export interface PaymentAttemptView {
  id: string;
  state: string;
  providerStatus: string | null;
  captureId: string | null;
  paypalOrderId: string | null;
  expectedAmountMinor: number;
  expectedCurrency: string;
  scopeHash: string;
  approvalUrl: string | null;
  updatedAt: string;
  lastError: string | null;
}

export interface ScopeViewResponse {
  scope: Scope;
  breakdown: BreakdownRow[];
  acceptance: { hash: string; actor: string; acceptedAt: string; confirmedAmountMinor: number } | null;
  history: Scope[];
  attempts: PaymentAttemptView[];
  amountFormatted: string;
}

export interface ConfigResponse {
  sandbox: true;
  merchantId: string;
  merchantName: string;
  currency: string;
  catalogVersion: string;
  taxIncluded: boolean;
  shippingIncluded: boolean;
  model: string | null;
  modelConfigured: boolean;
  paypalConfigured: boolean;
  standardExclusions: string[];
}

export interface BriefFixture {
  id: string;
  category: string;
  text: string;
  notes: string;
}

export interface ChangeFixture {
  id: string;
  kind: string;
  text: string;
  expectedChangeClass: string;
}

export interface EventsResponse {
  events: { eventId: string; eventType: string; resourceId: string; verificationState: string; processedState: string; receivedAt: string; note: string }[];
}

export interface ApiFailure {
  code: string;
  message: string;
  details: string[];
}

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure, readonly status: number) {
    super(failure.message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const failure = (payload as { error?: ApiFailure } | null)?.error;
    throw new ApiError(
      failure ?? {
        code: 'unexpected_response',
        message: `The server answered ${response.status} with a body this page could not read.`,
        details: []
      },
      response.status
    );
  }
  return payload as T;
}

export interface BriefResponse {
  brief: { id: string; canonicalText: string; textHash: string };
  scope: Scope;
  breakdown: BreakdownRow[];
  proposal: { lines: ScopeLine[]; exclusions: string[]; revisionLimit: number | null; ambiguities: string[] };
  extraction: { model: string; latencyMs: number; promptTokens: number; completionTokens: number; attempts: number };
  warnings: string[];
  reusedExisting: boolean;
  amountFormatted: string;
}

export interface ChangeResponse {
  assessment: {
    changeClass: string;
    summary: string;
    lines: ScopeLine[];
    deltaAmountMinor: number;
    confident: boolean;
    modelNotes: string;
  };
  deltaAmountMinor: number;
  deltaFormatted: string;
  createdNewVersion: boolean;
  supersededPaidVersion: boolean;
  currentScope: Scope;
  history: Scope[];
  warnings: string[];
}

export interface CaptureResponse {
  attempt: PaymentAttemptView;
  captured: boolean;
  message: string;
  scopeStatus: string;
  amountFormatted: string;
}

export const api = {
  config: () => request<ConfigResponse>('/api/config'),
  fixtures: () => request<{ briefs: BriefFixture[]; changes: ChangeFixture[] }>('/api/fixtures'),
  events: () => request<EventsResponse>('/api/events'),
  scope: (id: string) => request<ScopeViewResponse>(`/api/scopes/${encodeURIComponent(id)}`),
  submitBrief: (body: { text: string; submittedBy: string }) =>
    request<BriefResponse>('/api/briefs', { method: 'POST', body: JSON.stringify(body) }),
  review: (id: string, body: { action: 'approve' | 'edit' | 'reject'; actor: string; note: string; lines?: ScopeLine[]; exclusions?: string[] }) =>
    request<{ scope: Scope; amountFormatted: string }>(`/api/scopes/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  accept: (id: string, body: { hash: string; actor: string; confirmedAmountMinor: number; confirmedCurrency: 'USD' }) =>
    request<{ scope: Scope; amountFormatted: string }>(`/api/scopes/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  createOrder: (id: string, body: { hash: string; actor: string; confirmedAmountMinor: number; confirmedCurrency: 'USD' }) =>
    request<{ attempt: PaymentAttemptView; approvalUrl: string | null; reusedExistingOrder: boolean; note: string }>(
      `/api/scopes/${encodeURIComponent(id)}/orders`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  capture: (id: string, body: { orderId?: string }) =>
    request<CaptureResponse>(`/api/scopes/${encodeURIComponent(id)}/capture`, { method: 'POST', body: JSON.stringify(body) }),
  reconcile: (id: string, body: { orderId?: string }) =>
    request<{ attempt: PaymentAttemptView | null; providerStatus: string | null; changed: boolean; source: string }>(
      `/api/scopes/${encodeURIComponent(id)}/reconcile`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  requestChange: (id: string, body: { text: string; requestedBy: string }) =>
    request<ChangeResponse>(`/api/scopes/${encodeURIComponent(id)}/changes`, { method: 'POST', body: JSON.stringify(body) })
};

export function formatMinor(amountMinor: number, currency: string): string {
  const value = Math.abs(amountMinor);
  return `${amountMinor < 0 ? '-' : ''}${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')} ${currency}`;
}
