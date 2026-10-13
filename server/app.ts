/**
 * HTTP surface for ScopePay.
 *
 * Every route is a thin adapter: parse with Zod, call the domain service,
 * map domain errors to status codes. No route computes a price or trusts a
 * client-supplied amount.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { CATALOG, STANDARD_EXCLUSIONS } from '../lib/catalog.js';
import { CscsError, classifyChange, extractScope, type CscsConfig } from '../lib/cscs.js';
import { PaypalError, type PaypalClient } from '../lib/paypal.js';
import { formatMinor, priceBreakdown } from '../lib/pricing.js';
import type { Store } from '../lib/persistence.js';
import { ScopeError, type ScopeService } from '../lib/scope.js';
import { BuyerAcceptance, BriefSubmission, ChangeRequest, MerchantReview } from '../lib/schemas.js';
import { BRIEF_FIXTURES } from '../fixtures/briefs.js';
import { CHANGE_FIXTURES } from '../fixtures/change-requests.js';
import {
  CheckoutError,
  captureScopeOrder,
  handlePaypalWebhook,
  reconcileScope,
  startCheckout,
  type CheckoutDeps
} from './services/checkout.js';

export interface AppEnv {
  store: Store;
  scopes: ScopeService;
  paypal: PaypalClient | null;
  cscs: CscsConfig | null;
  requestKeyPrefix: string;
  publicBaseUrl: string;
  modelName: string | null;
}

function errorResponse(error: unknown): { body: unknown; status: number } {
  if (error instanceof CheckoutError) {
    return { body: { error: { code: error.code, message: error.message, details: error.details } }, status: error.status };
  }
  if (error instanceof ScopeError) {
    return { body: { error: { code: error.code, message: error.message, details: error.details } }, status: 409 };
  }
  if (error instanceof CscsError) {
    return {
      body: {
        error: {
          code: `model_${error.code}`,
          message: error.message,
          details: error.details
        }
      },
      status: error.code === 'missing_key' ? 503 : 502
    };
  }
  if (error instanceof PaypalError) {
    return { body: { error: { code: `paypal_${error.code}`, message: error.message, details: error.details } }, status: error.code === 'missing_credentials' ? 503 : 502 };
  }
  if (error instanceof z.ZodError) {
    return {
      body: {
        error: {
          code: 'invalid_request',
          message: 'The request body did not match the documented shape.',
          details: error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        }
      },
      status: 400
    };
  }
  return { body: { error: { code: 'internal_error', message: (error as Error).message, details: [] } }, status: 500 };
}

export function createApp(env: AppEnv): Hono {
  const app = new Hono();
  const deps: CheckoutDeps = {
    store: env.store,
    scopes: env.scopes,
    paypal: env.paypal as PaypalClient,
    requestKeyPrefix: env.requestKeyPrefix,
    publicBaseUrl: env.publicBaseUrl
  };

  const withPaypal = <T>(handler: () => Promise<T>): Promise<T> => {
    if (!env.paypal) {
      throw new CheckoutError(
        'paypal_not_configured',
        'PayPal sandbox credentials are not configured on this server. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.',
        [],
        503
      );
    }
    return handler();
  };

  app.get('/health', (c) =>
    c.json({
      ok: true,
      store: 'ready',
      paypalConfigured: Boolean(env.paypal),
      modelConfigured: Boolean(env.cscs),
      sandbox: true
    })
  );

  app.get('/api/config', (c) =>
    c.json({
      sandbox: true,
      merchantId: CATALOG.merchantId,
      merchantName: CATALOG.merchantName,
      currency: CATALOG.currency,
      catalogVersion: CATALOG.version,
      taxIncluded: CATALOG.taxIncluded,
      shippingIncluded: CATALOG.shippingIncluded,
      model: env.modelName,
      modelConfigured: Boolean(env.cscs),
      paypalConfigured: Boolean(env.paypal),
      standardExclusions: STANDARD_EXCLUSIONS
    })
  );

  app.get('/api/catalog', (c) => c.json({ catalog: CATALOG }));

  app.get('/api/fixtures', (c) =>
    c.json({
      briefs: BRIEF_FIXTURES.map((fixture) => ({
        id: fixture.id,
        category: fixture.category,
        text: fixture.text,
        notes: fixture.notes
      })),
      changes: CHANGE_FIXTURES.map((fixture) => ({
        id: fixture.id,
        kind: fixture.kind,
        text: fixture.text,
        expectedChangeClass: fixture.expectedChangeClass
      }))
    })
  );

  app.get('/api/events', async (c) => {
    const limit = Number(c.req.query('limit') ?? '25');
    const events = await env.store.listEvents(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25);
    return c.json({ events });
  });

  app.get('/api/scopes/:id', async (c) => {
    try {
      const view = await env.scopes.getScopeView({ scopeId: c.req.param('id') });
      const attempts = (await env.store.listPaymentAttemptsForScope(view.scope.id)).map((attempt) => ({
        id: attempt.id,
        state: attempt.state,
        providerStatus: attempt.providerStatus,
        captureId: attempt.captureId,
        paypalOrderId: attempt.paypalOrderId,
        expectedAmountMinor: attempt.expectedAmountMinor,
        expectedCurrency: attempt.expectedCurrency,
        scopeHash: attempt.scopeHash,
        approvalUrl: attempt.approvalUrl,
        updatedAt: attempt.updatedAt,
        lastError: attempt.lastError
      }));
      return c.json({
        scope: view.scope,
        breakdown: view.breakdown,
        acceptance: view.acceptance,
        history: view.history,
        attempts,
        amountFormatted: formatMinor(view.scope.amountMinor, view.scope.currency)
      });
    } catch (error) {
      const { body, status } = errorResponse(error);
      return c.json(body, status as 400);
    }
  });

  app.post('/api/briefs', async (c) => {
    try {
      const submission = BriefSubmission.parse(await c.req.json());
      if (!env.cscs) {
        throw new CscsError('missing_key', 'CSCS inference is not configured, so no scope can be extracted.');
      }
      const extraction = await extractScope(env.cscs, submission.text);
      const draft = await env.scopes.createDraft({
        text: submission.text,
        submittedBy: submission.submittedBy,
        proposal: extraction.proposal
      });
      return c.json(
        {
          brief: draft.brief,
          scope: draft.scope,
          breakdown: priceBreakdown(draft.scope.lines),
          proposal: extraction.proposal,
          extraction: extraction.meta,
          warnings: extraction.warnings,
          reusedExisting: draft.reusedExisting,
          amountFormatted: formatMinor(draft.scope.amountMinor, draft.scope.currency)
        },
        201
      );
    } catch (error) {
      const { body, status } = errorResponse(error);
      return c.json(body, status as 400);
    }
  });

  app.post('/api/scopes/:id/review', async (c) => {
    try {
      const review = MerchantReview.parse(await c.req.json());
      const scope = await env.scopes.applyMerchantReview({ scopeId: c.req.param('id'), review });
      return c.json({ scope, amountFormatted: formatMinor(scope.amountMinor, scope.currency) });
    } catch (error) {
      const { body, status } = errorResponse(error);
      return c.json(body, status as 400);
    }
  });

  app.post('/api/scopes/:id/accept', async (c) => {
    try {
      const acceptance = BuyerAcceptance.parse(await c.req.json());
      const result = await env.scopes.recordAcceptance({ scopeId: c.req.param('id'), acceptance });
      return c.json({
        scope: result.scope,
        acceptance: result.acceptance,
        amountFormatted: formatMinor(result.scope.amountMinor, result.scope.currency)
      });
    } catch (error) {
      const { body, status } = errorResponse(error);
      return c.json(body, status as 400);
    }
  });

  app.post('/api/scopes/:id/orders', async (c) => {
    try {
      const body = z
        .object({
          hash: z.string().length(64),
          actor: z.string().min(1).max(120),
          confirmedAmountMinor: z.number().int().nonnegative(),
          confirmedCurrency: z.literal('USD')
        })
        .parse(await c.req.json());
      const result = await withPaypal(() => startCheckout(deps, { scopeId: c.req.param('id'), ...body }));
      return c.json(
        {
          attempt: result.attempt,
          approvalUrl: result.approvalUrl,
          reusedExistingOrder: result.reused,
          sandbox: true,
          note: 'No money moves here. The buyer must approve this order on PayPal before any capture is possible.'
        },
        201
      );
    } catch (error) {
      const { body, status } = errorResponse(error);
      return c.json(body, status as 400);
    }
  });

  app.post('/api/scopes/:id/capture', async (c) => {
    try {
      const body = z.object({ orderId: z.string().min(1).optional() }).parse(await c.req.json().catch(() => ({})));
      const result = await withPaypal(() => captureScopeOrder(deps, { scopeId: c.req.param('id'), orderId: body.orderId }));
      const view = await env.scopes.getScopeView({ scopeId: c.req.param('id') });
      return c.json({
        attempt: result.attempt,
        captured: result.captured,
        message: result.message,
        scopeStatus: view.scope.status,
        amountFormatted: formatMinor(result.attempt.expectedAmountMinor, result.attempt.expectedCurrency)
      });
    } catch (error) {
      const { body, status } = errorResponse(error);
      return c.json(body, status as 400);
    }
  });

  app.post('/api/scopes/:id/reconcile', async (c) => {
    try {
      const body = z.object({ orderId: z.string().min(1).optional() }).parse(await c.req.json().catch(() => ({})));
      const result = await withPaypal(() => reconcileScope(deps, { scopeId: c.req.param('id'), orderId: body.orderId }));
      return c.json({
        attempt: result.attempt,
        providerStatus: result.providerStatus,
        changed: result.changed,
        source: result.source
      });
    } catch (error) {
      const { body, status } = errorResponse(error);
      return c.json(body, status as 400);
    }
  });

  app.post('/api/scopes/:id/changes', async (c) => {
    try {
      const change = ChangeRequest.parse(await c.req.json());
      const view = await env.scopes.getScopeView({ scopeId: c.req.param('id') });
      if (!env.cscs) {
        throw new CscsError('missing_key', 'CSCS inference is not configured, so a change cannot be classified.');
      }
      const brief = await env.store.getBrief(view.scope.briefId);
      if (!brief) {
        throw new CscsError('invalid_json', 'The brief for this scope no longer exists.');
      }
      const classified = await classifyChange(env.cscs, {
        briefText: brief.canonicalText,
        currentLines: view.scope.lines,
        exclusions: view.scope.exclusions,
        changeText: change.text
      });
      const result = await env.scopes.proposeChange({
        scopeId: view.scope.id,
        changeText: change.text,
        assessment: classified.assessment,
        requestedBy: change.requestedBy
      });
      const newView = await env.scopes.getScopeView({ scopeId: view.scope.id });
      return c.json(
        {
          assessment: { ...classified.assessment, deltaAmountMinor: result.deltaAmountMinor },
          deltaAmountMinor: result.deltaAmountMinor,
          deltaFormatted: formatMinor(result.deltaAmountMinor, view.scope.currency),
          supersededPaidVersion: !result.superseded && view.scope.status === 'paid',
          currentScope: newView.scope,
          history: newView.history,
          warnings: classified.warnings,
          extraction: classified.meta
        },
        201
      );
    } catch (error) {
      const { body, status } = errorResponse(error);
      return c.json(body, status as 400);
    }
  });

  app.post('/api/webhooks/paypal', async (c) => {
    try {
      const rawBody = await c.req.text();
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(c.req.header())) {
        headers[key.toLowerCase()] = value;
      }
      const result = await withPaypal(() => handlePaypalWebhook(deps, { headers, rawBody }));
      // PayPal expects a 2xx acknowledgement; anything unverified is stored and refused.
      return c.json({ accepted: result.accepted, reason: result.reason, applied: result.applied }, result.accepted ? 200 : 400);
    } catch (error) {
      const { body, status } = errorResponse(error);
      return c.json(body, status as 400);
    }
  });

  return app;
}
