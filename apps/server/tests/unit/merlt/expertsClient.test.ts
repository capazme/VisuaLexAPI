import nock from 'nock';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ExpertsClient } from '../../../src/services/merlt/expertsClient';
import {
  MerltTimeoutError,
  MerltServerError,
  MerltBadRequestError,
} from '../../../src/services/merlt/merltClient';

const BASE = 'http://experts-test.local:8000';
const client = new ExpertsClient({ baseUrl: BASE, timeoutMs: 200 });

beforeAll(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});
afterEach(() => nock.cleanAll());
afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
});

describe('ExpertsClient', () => {
  it('query() posts to /api/v1/experts/query and returns the body', async () => {
    nock(BASE)
      .post('/api/v1/experts/query', (b) => {
        const body = b as { query: string; user_id: string; include_trace: boolean };
        return body.query === 'art 1453' && body.user_id === 'u1' && body.include_trace === true;
      })
      .reply(200, {
        trace_id: 't1',
        synthesis: 'x',
        mode: 'convergent',
        sources: [],
        retrieved_sources: [{ urn: 'urn:nir:..~art1453', provenance: 'seed', trust: 1 }],
        experts_used: ['literal'],
        confidence: 0.8,
        execution_time_ms: 10,
      });
    const r = await client.query({ query: 'art 1453', user_id: 'u1', consent_level: 'full' });
    expect(r.trace_id).toBe('t1');
    expect(r.retrieved_sources[0].provenance).toBe('seed');
  });

  it('confirmSource() posts to /api/v1/enrichment/confirm-source', async () => {
    nock(BASE)
      .post('/api/v1/enrichment/confirm-source', (b) => (b as { node_id: string }).node_id === 'live:abc')
      .reply(200, { ok: true });
    const r = await client.confirmSource({ node_id: 'live:abc', user_id: 'u1' });
    expect(r).toEqual({ ok: true });
  });

  it('feedbackDetailed() and feedbackPreference() hit the right paths', async () => {
    nock(BASE).post('/api/v1/experts/feedback/detailed').reply(200, { success: true, message: 'ok' });
    nock(BASE).post('/api/v1/experts/feedback/preference').reply(200, { success: true, message: 'ok' });
    const d = await client.feedbackDetailed({ trace_id: 't', user_id: 'u', retrieval_score: 0.8, reasoning_score: 0.9, synthesis_score: 0.7 });
    const p = await client.feedbackPreference({ trace_id: 't', user_id: 'u', preferred_expert: 'systemic' });
    expect(d.success).toBe(true);
    expect(p.success).toBe(true);
  });

  it('maps 5xx to MerltServerError', async () => {
    nock(BASE).post('/api/v1/experts/query').reply(502, 'bad gw');
    await expect(client.query({ query: 'q', user_id: 'u', consent_level: 'full' })).rejects.toBeInstanceOf(MerltServerError);
  });

  it('maps 4xx to MerltBadRequestError', async () => {
    nock(BASE).post('/api/v1/experts/query').reply(422, { detail: 'too short' });
    await expect(client.query({ query: 'q', user_id: 'u', consent_level: 'full' })).rejects.toBeInstanceOf(MerltBadRequestError);
  });

  it('maps timeout to MerltTimeoutError', async () => {
    nock(BASE).post('/api/v1/experts/query').delayConnection(500).reply(200, {});
    await expect(client.query({ query: 'q', user_id: 'u', consent_level: 'full' })).rejects.toBeInstanceOf(MerltTimeoutError);
  });
});
