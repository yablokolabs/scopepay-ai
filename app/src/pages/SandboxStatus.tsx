import { useEffect, useState } from 'react';
import { api, type ConfigResponse, type EventsResponse } from '../api.js';

/**
 * Integration state for whoever is running the demo.
 *
 * It reports what is actually configured and which verified webhook events have
 * arrived. It never prints a credential and it does not claim a capability the
 * server does not have.
 */
export function SandboxStatusPage({ config }: { config: ConfigResponse }) {
  const [events, setEvents] = useState<EventsResponse['events']>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .events()
      .then((payload) => setEvents(payload.events))
      .catch((caught) => setError((caught as Error).message));
  }, []);

  return (
    <section>
      <h1>Sandbox integration state</h1>
      <div className="card">
        <dl className="definition">
          <dt>Environment</dt>
          <dd>SANDBOX only — live credentials are rejected by the payment client</dd>
          <dt>Merchant</dt>
          <dd>
            {config.merchantName} <span className="hash">{config.merchantId}</span>
          </dd>
          <dt>Catalog</dt>
          <dd>
            {config.catalogVersion} · {config.currency} · tax {config.taxIncluded ? 'included' : 'not charged'} · shipping{' '}
            {config.shippingIncluded ? 'not charged' : 'charged'}
          </dd>
          <dt>Extraction model</dt>
          <dd>
            {config.modelConfigured ? config.model : 'not configured — set CSCS_INFERENCE_API_KEY'}
          </dd>
          <dt>PayPal sandbox credentials</dt>
          <dd>
            {config.paypalConfigured
              ? 'configured on the server (values are never sent to the browser)'
              : 'not configured — set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the server'}
          </dd>
        </dl>
      </div>

      <div className="card">
        <h2>Webhook events received</h2>
        <p className="muted">
          Only signature-verified events are applied. Unverified callbacks are stored as invalid and ignored, and a
          repeated event id never applies twice. Webhook delivery is not guaranteed to be instant, so the receipt page also
          refreshes status directly from PayPal.
        </p>
        {error ? <p className="status" data-kind="error">{error}</p> : null}
        {events.length === 0 ? (
          <p className="muted">No events recorded yet. Events appear here after PayPal posts to /api/webhooks/paypal with a verified signature.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Resource</th>
                <th scope="col">Signature</th>
                <th scope="col">Applied</th>
                <th scope="col">Received</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.eventId}>
                  <td>{event.eventType}</td>
                  <td className="hash">{event.resourceId}</td>
                  <td>{event.verificationState.replace(/_/g, ' ')}</td>
                  <td>{event.processedState.replace(/_/g, ' ')}</td>
                  <td>{new Date(event.receivedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
