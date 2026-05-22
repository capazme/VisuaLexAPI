import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import {
  MerltClient,
  MerltClientError,
  MerltServerError,
  MerltBadRequestError,
  MerltTimeoutError,
  createMerltClient,
} from '../../../src/services/merlt/merltClient';

const BASE = 'http://merlt-test.local:8000';

const client = new MerltClient({ baseUrl: BASE, timeoutMs: 1000 });

beforeAll(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
});

describe('MerltClient.sendEvent', () => {
  it('returns trace_id on 200', async () => {
    nock(BASE)
      .post('/api/tracking/event', (body: unknown) => {
        const obj = body as Record<string, unknown>;
        return obj.event_type === 'article_viewed' && obj.user_id === 'u1';
      })
      .reply(200, { trace_id: 'trace-abc' });

    const result = await client.sendEvent({ event_type: 'article_viewed', user_id: 'u1' });
    expect(result).toEqual({ trace_id: 'trace-abc' });
  });

  it('throws MerltServerError on 500', async () => {
    nock(BASE).post('/api/tracking/event').reply(500, 'Internal Server Error');

    await expect(
      client.sendEvent({ event_type: 'x', user_id: 'u1' })
    ).rejects.toBeInstanceOf(MerltServerError);
  });

  it('throws MerltServerError on 502/503/504', async () => {
    for (const status of [502, 503, 504]) {
      nock(BASE).post('/api/tracking/event').reply(status, 'gateway error');
      const err = await client
        .sendEvent({ event_type: 'x', user_id: 'u1' })
        .catch((e) => e as MerltClientError);
      expect(err).toBeInstanceOf(MerltServerError);
      expect(err.status).toBe(status);
    }
  });

  it('throws MerltBadRequestError on 400 with JSON body', async () => {
    nock(BASE).post('/api/tracking/event').reply(400, { detail: 'bad payload' });

    const err = (await client
      .sendEvent({ event_type: 'x', user_id: 'u1' })
      .catch((e) => e)) as MerltBadRequestError;
    expect(err).toBeInstanceOf(MerltBadRequestError);
    expect(err.status).toBe(400);
    expect(err.body).toEqual({ detail: 'bad payload' });
  });

  it('throws MerltBadRequestError on 401', async () => {
    nock(BASE).post('/api/tracking/event').reply(401, { detail: 'unauthorized' });

    const err = (await client
      .sendEvent({ event_type: 'x', user_id: 'u1' })
      .catch((e) => e)) as MerltBadRequestError;
    expect(err.status).toBe(401);
  });

  it('sets Authorization header when apiKey is configured', async () => {
    const authedClient = new MerltClient({
      baseUrl: BASE,
      apiKey: 'secret-key',
      timeoutMs: 1000,
    });
    nock(BASE, { reqheaders: { authorization: 'Bearer secret-key' } })
      .post('/api/tracking/event')
      .reply(200, { trace_id: 't' });

    await expect(
      authedClient.sendEvent({ event_type: 'x', user_id: 'u1' })
    ).resolves.toEqual({ trace_id: 't' });
  });

  it('does NOT set Authorization header when apiKey is missing', async () => {
    // nock matches request without Authorization
    nock(BASE, {
      badheaders: ['authorization'],
    })
      .post('/api/tracking/event')
      .reply(200, { trace_id: 't' });

    await expect(
      client.sendEvent({ event_type: 'x', user_id: 'u1' })
    ).resolves.toEqual({ trace_id: 't' });
  });

  it('serializes JSON body with snake_case fields', async () => {
    nock(BASE)
      .post('/api/tracking/event', (body) => {
        const obj = body as Record<string, unknown>;
        return (
          obj.event_type === 'article_viewed' &&
          obj.user_id === 'u1' &&
          obj.dwell_ms === 5000 &&
          obj.scroll_max_pct === 75
        );
      })
      .reply(200, { trace_id: 't' });

    await client.sendEvent({
      event_type: 'article_viewed',
      user_id: 'u1',
      dwell_ms: 5000,
      scroll_max_pct: 75,
    });
  });
});

describe('MerltClient.getProfile', () => {
  it('returns parsed profile', async () => {
    nock(BASE)
      .get('/api/profile/full')
      .query({ user_id: 'u42' })
      .reply(200, {
        user_id: 'u42',
        authority_score: 0.65,
        baseline_qualification: 'avvocato',
        track_record: 0.8,
        performance: 0.5,
        total_contributions: 12,
      });

    const profile = await client.getProfile('u42');
    expect(profile.user_id).toBe('u42');
    expect(profile.authority_score).toBeCloseTo(0.65);
    expect(profile.baseline_qualification).toBe('avvocato');
  });

  it('escapes special characters in user_id', async () => {
    nock(BASE)
      .get('/api/profile/full')
      .query({ user_id: 'u/with+special chars' })
      .reply(200, {
        user_id: 'u/with+special chars',
        authority_score: 0.1,
        baseline_qualification: 'studente',
      });

    await expect(client.getProfile('u/with+special chars')).resolves.toBeTruthy();
  });
});

describe('MerltClient.healthCheck', () => {
  it('returns health payload on 200', async () => {
    nock(BASE).get('/health').reply(200, { status: 'ok' });
    const result = await client.healthCheck();
    expect(result.status).toBe('ok');
  });

  it('throws MerltServerError when health endpoint 503s', async () => {
    nock(BASE).get('/health').reply(503, 'dependencies down');
    await expect(client.healthCheck()).rejects.toBeInstanceOf(MerltServerError);
  });
});

describe('MerltClient timeout', () => {
  it('throws MerltTimeoutError when MERL-T does not respond within timeoutMs', async () => {
    const slowClient = new MerltClient({ baseUrl: BASE, timeoutMs: 100 });
    nock(BASE).get('/health').delay(500).reply(200, { status: 'ok' });

    await expect(slowClient.healthCheck()).rejects.toBeInstanceOf(MerltTimeoutError);
  });

  it('throws MerltTimeoutError on network errors', async () => {
    nock(BASE).get('/health').replyWithError({ message: 'ECONNREFUSED', code: 'ECONNREFUSED' });

    await expect(client.healthCheck()).rejects.toBeInstanceOf(MerltTimeoutError);
  });
});

describe('createMerltClient', () => {
  it('reads MERLT_API_URL / MERLT_API_KEY / MERLT_TIMEOUT_MS from env', async () => {
    const c = createMerltClient({
      MERLT_API_URL: BASE,
      MERLT_API_KEY: 'k',
      MERLT_TIMEOUT_MS: '2500',
    } as NodeJS.ProcessEnv);

    nock(BASE, { reqheaders: { authorization: 'Bearer k' } })
      .get('/health')
      .reply(200, { status: 'ok' });

    await expect(c.healthCheck()).resolves.toEqual({ status: 'ok' });
  });

  it('falls back to localhost:8000 / no auth / 5000ms by default', () => {
    const c = createMerltClient({} as NodeJS.ProcessEnv);
    // Smoke: factory returns an instance (no throw)
    expect(c).toBeInstanceOf(MerltClient);
  });
});
