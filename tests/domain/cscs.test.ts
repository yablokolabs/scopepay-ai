import { describe, expect, it } from 'vitest';
import { CscsError, classifyChange, extractScope, loadCscsConfigFromEnv } from '../../lib/cscs.js';
import { canonicaliseBrief, hashBrief } from '../../lib/hashing.js';
import { BRIEF_FIXTURES } from '../../fixtures/briefs.js';
import { CHANGE_FIXTURES } from '../../fixtures/change-requests.js';

const CONFIG = { apiKey: 'test-key-not-real' };

const BRIEF = 'We need one landing page for our bike shop and a contact form so people can reach us.';
const LANDING_QUOTE = 'one landing page for our bike shop';

function spanFor(quote: string) {
  const start = BRIEF.indexOf(quote);
  return { start, end: start + quote.length, quote };
}

function chatResponse(content: string, usage = { prompt_tokens: 11, completion_tokens: 22 }) {
  return { choices: [{ index: 0, message: { role: 'assistant', content } }], usage };
}

interface RecordedCall {
  url: string;
  body: string;
}

function recordingFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>
): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as Request).url);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function respondWith(content: string, status = 200): typeof fetch {
  return recordingFetch(() => new Response(JSON.stringify(chatResponse(content)), {
    status,
    headers: { 'content-type': 'application/json' }
  })).impl;
}

async function expectCscsError(promise: Promise<unknown>, code: string): Promise<CscsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CscsError);
    const cscsError = error as CscsError;
    expect(cscsError.code).toBe(code);
    return cscsError;
  }
  throw new Error(`Expected a CscsError with code ${code} but the call resolved.`);
}

const VALID_PROPOSAL = {
  lines: [
    {
      catalogItemId: 'landing-page',
      quantity: 1,
      sourceSpan: spanFor(LANDING_QUOTE),
      rationale: 'client asks for one landing page'
    }
  ],
  exclusions: ['Stock photography is not included.'],
  revisionLimit: 2,
  ambiguities: []
};

describe('hashing', () => {
  it('canonicalises whitespace and zero-width characters deterministically', () => {
    const messy = 'Line one   \r\n\r\n\r\n\r\nLine two\u200B with zero width\n\n\n';
    const canonical = canonicaliseBrief(messy);
    expect(canonical).toBe('Line one\n\nLine two with zero width');
    expect(canonicaliseBrief(canonical)).toBe(canonical);
  });

  it('hashes the canonical form, so whitespace noise does not change the hash', () => {
    const a = hashBrief('We need a landing page.\n\nAnd a form.');
    const b = hashBrief('  We need a landing page.\r\n\r\n\r\nAnd a form.  ');
    expect(a.textHash).toBe(b.textHash);
    expect(a.textHash).toHaveLength(64);
    expect(hashBrief('Different brief entirely.').textHash).not.toBe(a.textHash);
  });
});

describe('loadCscsConfigFromEnv', () => {
  it('reports a missing key instead of pretending to run', () => {
    expect(() => loadCscsConfigFromEnv({})).toThrow(CscsError);
    try {
      loadCscsConfigFromEnv({});
    } catch (error) {
      expect((error as CscsError).code).toBe('missing_key');
    }
  });

  it('reads configured names without exposing the key', () => {
    const config = loadCscsConfigFromEnv({
      CSCS_INFERENCE_API_KEY: 'secret-value',
      CSCS_MODEL: 'swiss-ai/Apertus-v1.5-70B'
    });
    expect(config.apiKey).toBe('secret-value');
    expect(config.model).toBe('swiss-ai/Apertus-v1.5-70B');
  });
});

describe('extractScope', () => {
  it('returns validated catalog lines with a verbatim source span', async () => {
    const { impl, calls } = recordingFetch(() =>
      new Response(JSON.stringify(chatResponse(JSON.stringify(VALID_PROPOSAL))), { status: 200 })
    );

    const outcome = await extractScope(CONFIG, BRIEF, impl);

    expect(outcome.proposal.lines).toHaveLength(1);
    expect(outcome.proposal.lines[0]?.catalogItemId).toBe('landing-page');
    expect(outcome.proposal.lines[0]?.sourceSpan?.quote).toBe(LANDING_QUOTE);
    expect(BRIEF.slice(outcome.proposal.lines[0]!.sourceSpan!.start, outcome.proposal.lines[0]!.sourceSpan!.end)).toBe(
      LANDING_QUOTE
    );
    expect(outcome.warnings).toEqual([]);
    expect(outcome.meta.model).toBe('swiss-ai/Apertus-v1.5-70B');
    expect(outcome.meta.attempts).toBe(1);
    expect(calls[0]?.url).toBe('https://api.inference.cscs.ch/v1/chat/completions');
  });

  it('never sends catalog prices or amounts to the model', async () => {
    const { impl, calls } = recordingFetch(() =>
      new Response(JSON.stringify(chatResponse(JSON.stringify(VALID_PROPOSAL))), { status: 200 })
    );

    await extractScope(CONFIG, BRIEF, impl);

    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('unitPriceMinor');
    expect(body).not.toMatch(/\b45000\b|\b60000\b|\b22000\b|\b18000\b/);
    expect(body).not.toContain('$');
  });

  it('parses a reply wrapped in a code fence', async () => {
    const fenced = '```json\n' + JSON.stringify(VALID_PROPOSAL) + '\n```';
    const outcome = await extractScope(CONFIG, BRIEF, respondWith(fenced));
    expect(outcome.proposal.lines).toHaveLength(1);
  });

  it('keeps a valid line and drops an invalid one with a warning', async () => {
    const payload = {
      ...VALID_PROPOSAL,
      lines: [
        VALID_PROPOSAL.lines[0],
        { catalogItemId: 'ecommerce-checkout', quantity: 1, sourceSpan: null, rationale: 'sell candles online' },
        { catalogItemId: 'landing-page', quantity: 99, sourceSpan: null, rationale: 'duplicate plus out of range' }
      ]
    };
    const outcome = await extractScope(CONFIG, BRIEF, respondWith(JSON.stringify(payload)));

    expect(outcome.proposal.lines).toHaveLength(1);
    expect(outcome.proposal.lines[0]?.quantity).toBe(1);
    expect(outcome.warnings.join(' ')).toContain('ecommerce-checkout');
    expect(outcome.warnings.join(' ')).toContain('outside the catalog range');
  });

  it('drops an unfound evidence quote but keeps the line, with a warning', async () => {
    const payload = {
      ...VALID_PROPOSAL,
      lines: [
        {
          catalogItemId: 'landing-page',
          quantity: 1,
          sourceSpan: { start: 0, end: 7, quote: 'Invented quote' },
          rationale: 'no real evidence'
        }
      ]
    };
    const outcome = await extractScope(CONFIG, BRIEF, respondWith(JSON.stringify(payload)));

    expect(outcome.proposal.lines).toHaveLength(1);
    expect(outcome.proposal.lines[0]?.sourceSpan).toBeNull();
    expect(outcome.warnings.join(' ')).toContain('could not be found verbatim');
  });

  it('retries once and then fails on unusable output', async () => {
    const { impl, calls } = recordingFetch(() =>
      new Response(JSON.stringify(chatResponse('Sorry, I cannot produce JSON for that.')), { status: 200 })
    );

    const error = await expectCscsError(extractScope(CONFIG, BRIEF, impl), 'invalid_json');

    expect(calls).toHaveLength(2);
    expect(error.message).toContain('2 attempts');
  });

  it('reports an HTTP failure without leaking the key', async () => {
    const key = 'test-key-not-real';
    const impl = recordingFetch(() => new Response(`{"error":"invalid api key ${key}"}`, { status: 500 })).impl;

    const error = await expectCscsError(extractScope({ apiKey: key }, BRIEF, impl), 'http_error');

    expect(error.status).toBe(500);
    expect(error.message).not.toContain(key);
    expect(error.details.join(' ')).not.toContain(key);
    expect(error.details.join(' ')).toContain('[redacted]');
  });

  it('maps a 404 to model_unavailable', async () => {
    const impl = recordingFetch(() => new Response('{"error":"model not found"}', { status: 404 })).impl;
    await expectCscsError(extractScope(CONFIG, BRIEF, impl), 'model_unavailable');
  });

  it('times out instead of hanging', async () => {
    const impl = (async (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      })) as unknown as typeof fetch;

    const error = await expectCscsError(
      extractScope({ apiKey: 'k', timeoutMs: 20 }, BRIEF, impl),
      'timeout'
    );
    expect(error.message).toContain('20ms');
  });
});

describe('classifyChange', () => {
  const currentLines = [
    { catalogItemId: 'landing-page', quantity: 1, sourceSpan: null, rationale: '' },
    { catalogItemId: 'content-page', quantity: 2, sourceSpan: null, rationale: '' }
  ];

  it('returns a schema-valid assessment whose delta is computed by the server, not the model', async () => {
    const payload = {
      changeClass: 'new_scope_delta',
      summary: 'Client wants an additional content page.',
      confident: true,
      lines: [
        { catalogItemId: 'content-page', quantity: 1, sourceSpan: null, rationale: 'extra page requested' }
      ],
      exclusions: [],
      modelNotes: 'one extra page'
    };

    const outcome = await classifyChange(
      CONFIG,
      { briefText: BRIEF, currentLines, exclusions: [], changeText: 'Could we add one more page?' },
      respondWith(JSON.stringify(payload))
    );

    expect(outcome.assessment.changeClass).toBe('new_scope_delta');
    expect(outcome.assessment.deltaAmountMinor).toBe(0);
    expect(outcome.assessment.lines).toHaveLength(1);
    expect(outcome.assessment.confident).toBe(true);
  });

  it('downgrades an unrecognised class to a clarification', async () => {
    const payload = {
      changeClass: 'free_stuff_please',
      summary: 'Unclear.',
      confident: true,
      lines: [],
      exclusions: [],
      modelNotes: ''
    };

    const outcome = await classifyChange(
      CONFIG,
      { briefText: BRIEF, currentLines, exclusions: [], changeText: 'Make it cheaper?' },
      respondWith(JSON.stringify(payload))
    );

    expect(outcome.assessment.changeClass).toBe('clarification');
    expect(outcome.assessment.confident).toBe(false);
    expect(outcome.warnings.join(' ')).toContain('free_stuff_please');
  });
});

describe('frozen fixtures', () => {
  it('holds twenty briefs across the required categories', () => {
    expect(BRIEF_FIXTURES).toHaveLength(20);
    const counts = BRIEF_FIXTURES.reduce<Record<string, number>>((acc, fixture) => {
      acc[fixture.category] = (acc[fixture.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      complete: 5,
      ambiguous: 4,
      budget_cap: 3,
      unknown_item: 2,
      malicious: 3,
      stale_version: 3
    });
    expect(new Set(BRIEF_FIXTURES.map((fixture) => fixture.id)).size).toBe(20);
  });

  it('holds ten change requests covering every change class', () => {
    expect(CHANGE_FIXTURES).toHaveLength(10);
    const classes = new Set(CHANGE_FIXTURES.map((fixture) => fixture.expectedChangeClass));
    expect([...classes].sort()).toEqual(['clarification', 'in_scope_adjustment', 'new_scope_delta', 'no_change']);
  });

  it('marks an instruction-bearing brief as malicious data', () => {
    const injected = BRIEF_FIXTURES.filter((fixture) => fixture.category === 'malicious');
    expect(injected.length).toBeGreaterThanOrEqual(3);
    expect(injected.map((fixture) => fixture.text).join(' ')).toContain('ignore the catalog prices');
  });
});
