import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import { ContribClient } from '../../../src/services/merlt/contribClient';
import {
  MerltServerError,
  MerltBadRequestError,
  MerltTimeoutError,
} from '../../../src/services/merlt/merltClient';

const BASE = 'http://merlt-test.local:8000';
const client = new ContribClient({ baseUrl: BASE, timeoutMs: 1000 });

beforeAll(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});
afterEach(() => nock.cleanAll());
afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
});

describe('ContribClient', () => {
  it('extractAsync POSTs /documents/{id}/extract-async with user_id + bff_job_id', async () => {
    nock(BASE)
      .post('/api/v1/documents/42/extract-async', (body) => {
        const b = body as { user_id: string; options: { bff_job_id: string } };
        return b.user_id === 'u1' && b.options.bff_job_id === 'job-1';
      })
      .reply(202, { task_id: 'task-abc' });

    const res = await client.extractAsync(42, 'u1', 'job-1');
    expect(res.task_id).toBe('task-abc');
  });

  it('listCandidates GETs candidates scoped by contributor_id', async () => {
    nock(BASE)
      .get('/api/v1/documents/42/candidates')
      .query({ contributor_id: 'u1' })
      .reply(200, { candidates: [{ id: 1, candidate_type: 'entity', entity_text: 'Risoluzione' }] });

    const res = await client.listCandidates(42, 'u1');
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0].entity_text).toBe('Risoluzione');
  });

  it('getCandidate GETs /candidates/{id} (includes verbatim)', async () => {
    nock(BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', entity_text: 'X', verbatim_excerpt: 'raw text' });

    const res = await client.getCandidate(7);
    expect(res.verbatim_excerpt).toBe('raw text');
  });

  it('proposeEntity POSTs /enrichment/propose-entity and returns the pending id', async () => {
    nock(BASE)
      .post('/api/v1/enrichment/propose-entity', (body) => {
        const b = body as Record<string, unknown>;
        return b.contributed_by === 'u1' && b.fonte === 'utente:appunti.pdf';
      })
      .reply(200, { pending_id: 'pe-1', entity_id: 'ent-1' });

    const res = await client.proposeEntity({
      article_urn: 'urn:test',
      nome: 'Risoluzione',
      tipo: 'concetto',
      descrizione: 'riformulata',
      fonte: 'utente:appunti.pdf',
      contributed_by: 'u1',
      source_document_id: 42,
    });
    expect(res.pending_id).toBe('pe-1');
  });

  it('markPromoted POSTs /candidates/{id}/mark-promoted', async () => {
    nock(BASE).post('/api/v1/candidates/7/mark-promoted').reply(200, { ok: true });
    await expect(client.markPromoted(7)).resolves.toBeDefined();
  });

  it('maps 5xx to MerltServerError', async () => {
    nock(BASE).get('/api/v1/candidates/9').reply(500, 'boom');
    await expect(client.getCandidate(9)).rejects.toBeInstanceOf(MerltServerError);
  });

  it('maps 4xx to MerltBadRequestError', async () => {
    nock(BASE).get('/api/v1/candidates/9').reply(404, { detail: 'not found' });
    await expect(client.getCandidate(9)).rejects.toBeInstanceOf(MerltBadRequestError);
  });

  it('maps network failure to MerltTimeoutError', async () => {
    nock(BASE).get('/api/v1/candidates/9').replyWithError('socket hang up');
    await expect(client.getCandidate(9)).rejects.toBeInstanceOf(MerltTimeoutError);
  });
});
