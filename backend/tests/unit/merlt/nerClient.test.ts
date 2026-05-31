import nock from 'nock';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { NerClient } from '../../../src/services/merlt/nerClient';
import {
  MerltTimeoutError,
  MerltServerError,
  MerltBadRequestError,
} from '../../../src/services/merlt/merltClient';

const BASE = 'http://ner-test.local:8000';
const client = new NerClient({ baseUrl: BASE, timeoutMs: 200 });

beforeAll(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});
afterEach(() => nock.cleanAll());
afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
});

describe('NerClient', () => {
  it('submitFeedback() posts to /api/v1/ner/feedback and returns the body', async () => {
    nock(BASE)
      .post('/api/v1/ner/feedback', (b) => {
        const body = b as { user_id: string; source_surface: string; feedback_type: string };
        return (
          body.user_id === 'u1' &&
          body.source_surface === 'article_xref' &&
          body.feedback_type === 'confirmation'
        );
      })
      .reply(200, { received: true, feedback_id: 'ner-abc', sample_weight: 1.0 });
    const r = await client.submitFeedback({
      user_id: 'u1',
      source_surface: 'article_xref',
      feedback_type: 'confirmation',
    });
    expect(r.received).toBe(true);
    expect(r.feedback_id).toBe('ner-abc');
    expect(r.sample_weight).toBe(1.0);
  });

  it('stats() GETs /api/v1/ner/feedback/stats', async () => {
    nock(BASE)
      .get('/api/v1/ner/feedback/stats')
      .reply(200, { total: 3, untrained: 2, by_type: { confirmation: 3 }, by_surface: { article_xref: 3 } });
    const r = await client.stats();
    expect(r.total).toBe(3);
    expect(r.by_type.confirmation).toBe(3);
  });

  it('maps 5xx to MerltServerError', async () => {
    nock(BASE).post('/api/v1/ner/feedback').reply(502, 'bad gw');
    await expect(
      client.submitFeedback({ user_id: 'u', source_surface: 'qa_chip', feedback_type: 'confirmation' })
    ).rejects.toBeInstanceOf(MerltServerError);
  });

  it('maps 4xx to MerltBadRequestError', async () => {
    nock(BASE).post('/api/v1/ner/feedback').reply(422, { detail: 'invalid source_surface' });
    await expect(
      client.submitFeedback({ user_id: 'u', source_surface: 'qa_chip', feedback_type: 'confirmation' })
    ).rejects.toBeInstanceOf(MerltBadRequestError);
  });

  it('maps timeout to MerltTimeoutError', async () => {
    nock(BASE).post('/api/v1/ner/feedback').delayConnection(500).reply(200, {});
    await expect(
      client.submitFeedback({ user_id: 'u', source_surface: 'qa_chip', feedback_type: 'confirmation' })
    ).rejects.toBeInstanceOf(MerltTimeoutError);
  });
});
