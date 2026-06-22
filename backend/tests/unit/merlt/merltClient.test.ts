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
  it('returns { received, timestamp } on 200 and posts to /api/v1/tracking/events', async () => {
    nock(BASE)
      .post('/api/v1/tracking/events', (body: unknown) => {
        const b = body as { events: Array<Record<string, unknown>> };
        return (
          Array.isArray(b.events) &&
          b.events.length === 1 &&
          b.events[0].type === 'article:viewed' &&
          (b.events[0].data as Record<string, unknown>).user_id === 'u1' &&
          typeof b.events[0].timestamp === 'number'
        );
      })
      .reply(200, { received: 1, timestamp: '2026-05-23T00:00:00Z' });

    const result = await client.sendEvent({ type: 'article:viewed', user_id: 'u1' });
    expect(result).toEqual({ received: 1, timestamp: '2026-05-23T00:00:00Z' });
  });

  it('wraps a single event into the batch { events: [...] } shape', async () => {
    nock(BASE)
      .post('/api/v1/tracking/events', (body: unknown) => {
        const b = body as { events: Array<Record<string, unknown>> };
        const d = b.events[0].data as Record<string, unknown>;
        return (
          b.events[0].type === 'highlight:created' &&
          d.user_id === 'u1' &&
          d.article_urn === 'urn:test' &&
          // ensure `type` is NOT duplicated inside data
          d.type === undefined
        );
      })
      .reply(200, { received: 1, timestamp: 't' });

    await client.sendEvent({
      type: 'highlight:created',
      user_id: 'u1',
      article_urn: 'urn:test',
    });
  });

  it('throws MerltServerError on 500', async () => {
    nock(BASE).post('/api/v1/tracking/events').reply(500, 'Internal Server Error');
    await expect(
      client.sendEvent({ type: 'x', user_id: 'u1' })
    ).rejects.toBeInstanceOf(MerltServerError);
  });

  it('throws MerltServerError on 502/503/504', async () => {
    for (const status of [502, 503, 504]) {
      nock(BASE).post('/api/v1/tracking/events').reply(status, 'gateway error');
      const err = await client
        .sendEvent({ type: 'x', user_id: 'u1' })
        .catch((e) => e as MerltClientError);
      expect(err).toBeInstanceOf(MerltServerError);
      expect(err.status).toBe(status);
    }
  });

  it('throws MerltBadRequestError on 400 with JSON body', async () => {
    nock(BASE).post('/api/v1/tracking/events').reply(400, { detail: 'bad payload' });

    const err = (await client
      .sendEvent({ type: 'x', user_id: 'u1' })
      .catch((e) => e)) as MerltBadRequestError;
    expect(err).toBeInstanceOf(MerltBadRequestError);
    expect(err.status).toBe(400);
    expect(err.body).toEqual({ detail: 'bad payload' });
  });

  it('throws MerltBadRequestError on 401', async () => {
    nock(BASE).post('/api/v1/tracking/events').reply(401, { detail: 'unauthorized' });

    const err = (await client
      .sendEvent({ type: 'x', user_id: 'u1' })
      .catch((e) => e)) as MerltBadRequestError;
    expect(err.status).toBe(401);
  });

  it('sets the X-API-Key header (NOT Authorization: Bearer) when apiKey is configured', async () => {
    const authedClient = new MerltClient({
      baseUrl: BASE,
      apiKey: 'secret-key',
      timeoutMs: 1000,
    });
    // MERL-T verify_api_key reads X-API-Key; Bearer is rejected (gotcha #1).
    nock(BASE, { reqheaders: { 'x-api-key': 'secret-key' }, badheaders: ['authorization'] })
      .post('/api/v1/tracking/events')
      .reply(200, { received: 1, timestamp: 't' });

    await expect(
      authedClient.sendEvent({ type: 'x', user_id: 'u1' })
    ).resolves.toEqual({ received: 1, timestamp: 't' });
  });

  it('does NOT set any auth header when apiKey is missing', async () => {
    nock(BASE, { badheaders: ['authorization', 'x-api-key'] })
      .post('/api/v1/tracking/events')
      .reply(200, { received: 1, timestamp: 't' });

    await expect(
      client.sendEvent({ type: 'x', user_id: 'u1' })
    ).resolves.toEqual({ received: 1, timestamp: 't' });
  });
});

describe('MerltClient.getProfile', () => {
  const sampleProfile = {
    user_id: 'u42',
    display_name: 'u42',
    authority: {
      score: 0.65,
      tier: 'avvocato',
      breakdown: {
        baseline: 0.3,
        track_record: 0.5,
        level_authority: 0.5,
      },
      next_tier_threshold: 0.6,
      progress_to_next: 80,
    },
    domains: {},
    stats: {
      total_contributions: 12,
      approved: 10,
      rejected: 1,
      pending: 1,
      vote_weight: 0.65,
    },
    recent_activity: [],
    joined_at: null,
    last_updated: null,
  };

  it('returns parsed profile from /api/v1/profile/full', async () => {
    nock(BASE)
      .get('/api/v1/profile/full')
      .query({ user_id: 'u42' })
      .reply(200, sampleProfile);

    const profile = await client.getProfile('u42');
    expect(profile.user_id).toBe('u42');
    expect(profile.authority.score).toBeCloseTo(0.65);
    expect(profile.authority.tier).toBe('avvocato');
    expect(profile.stats?.total_contributions).toBe(12);
  });

  it('escapes special characters in user_id', async () => {
    nock(BASE)
      .get('/api/v1/profile/full')
      .query({ user_id: 'u/with+special chars' })
      .reply(200, { ...sampleProfile, user_id: 'u/with+special chars' });

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

    nock(BASE, { reqheaders: { 'x-api-key': 'k' } })
      .get('/health')
      .reply(200, { status: 'ok' });

    await expect(c.healthCheck()).resolves.toEqual({ status: 'ok' });
  });

  it('falls back to localhost:8000 / no auth / 5000ms by default', () => {
    const c = createMerltClient({} as NodeJS.ProcessEnv);
    expect(c).toBeInstanceOf(MerltClient);
  });
});
