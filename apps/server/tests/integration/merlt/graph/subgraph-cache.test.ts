import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import {
  request,
  app,
  createTestUser,
  authHeader,
  prisma,
  type TestUser,
} from '../../../helpers';
import {
  _resetGraphClientForTests,
  _resetSubgraphCacheForTests,
} from '../../../../src/routes/merlt/graph';
import {
  SubgraphCache,
  createSubgraphCache,
  subgraphCacheKey,
} from '../../../../src/services/merlt/subgraphCache';
import type { SubgraphResponse } from '../../../../src/schemas/merlt/graph';

/**
 * P1.12 — subgraph TTL cache with request coalescing on
 * GET /api/merlt/graph/article/:urn, invalidated by the ingestion
 * job-callback. Integration tests cover the route wiring (hit, coalescing,
 * invalidation); the TTL/LRU mechanics are unit-tested on the class directly
 * with a tiny TTL to avoid faking timers under supertest.
 */

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';
const INTERNAL_SECRET = 'test-internal-secret';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '1000';
  process.env.MERLT_INTERNAL_SECRET = INTERNAL_SECRET;
  _resetGraphClientForTests();
  _resetSubgraphCacheForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});

afterEach(() => {
  nock.cleanAll();
  _resetSubgraphCacheForTests();
});

afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_TIMEOUT_MS;
  delete process.env.MERLT_INTERNAL_SECRET;
});

function subgraphOf(rootUrn: string, extraNodes = 0): SubgraphResponse {
  const nodes = [
    { id: rootUrn, urn: rootUrn, type: 'Norma', label: 'Art. 2043 c.c.' },
    ...Array.from({ length: extraNodes }, (_, i) => ({
      id: `principio:${i}`,
      urn: null,
      type: 'Principio',
      label: `Principio ${i}`,
    })),
  ];
  return { nodes, edges: [], metadata: { total_nodes: nodes.length } };
}

describe('subgraph cache — route integration (P1.12)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('subgraph-cache');
    await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'basic' });
  });

  it('serves the second identical request from cache (single upstream call)', async () => {
    const urn = 'urn:nir:stato:codice.civile:1942;2043';

    let upstreamHits = 0;
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query(true)
      .times(1)
      .reply(() => {
        upstreamHits += 1;
        return [200, subgraphOf(urn)];
      });

    const first = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
      .set(authHeader(user));
    expect(first.status).toBe(200);

    // No interceptor is left: a second upstream call would fail with a network
    // error → 503. A 200 here can only come from the cache.
    const second = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
      .set(authHeader(user));

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(upstreamHits).toBe(1);
  });

  it('does not share cache entries across different depth/limit combos', async () => {
    const urn = 'urn:nir:stato:codice.civile:1942;2043';

    let upstreamHits = 0;
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query(true)
      .times(2)
      .reply(() => {
        upstreamHits += 1;
        return [200, subgraphOf(urn)];
      });

    const d1 = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}?depth=1`)
      .set(authHeader(user));
    const d2 = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}?depth=2`)
      .set(authHeader(user));

    expect(d1.status).toBe(200);
    expect(d2.status).toBe(200);
    expect(upstreamHits).toBe(2);
  });

  it('coalesces concurrent identical requests into ONE upstream call', async () => {
    const urn = 'urn:nir:stato:codice.civile:1942;1218';

    let upstreamHits = 0;
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query(true)
      .times(1)
      .delay(150)
      .reply(() => {
        upstreamHits += 1;
        return [200, subgraphOf(urn, 1)];
      });

    const [a, b] = await Promise.all([
      request(app)
        .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
        .set(authHeader(user)),
      request(app)
        .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
        .set(authHeader(user)),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(upstreamHits).toBe(1);
  });

  it('does NOT cache upstream failures (retry hits MERL-T again)', async () => {
    const urn = 'urn:nir:stato:codice.civile:1942;1453';

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query(true)
      .replyWithError({ code: 'ECONNREFUSED', message: 'down' });

    const failed = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
      .set(authHeader(user));
    expect(failed.status).toBe(503);

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query(true)
      .reply(200, subgraphOf(urn));

    const retried = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
      .set(authHeader(user));
    expect(retried.status).toBe(200);
    expect(retried.body.nodes).toHaveLength(1);
  });

  it('invalidates the cached subgraph when the job-callback reports completed', async () => {
    // The GET uses the raw VisuaLex urn (with !vig=) while the job row stores
    // the bare form — both normalize to the same cache prefix, proving the
    // invalidation path goes through normalizeGraphUrn.
    const bareUrn =
      'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';
    const rawUrn = `${bareUrn}!vig=`;

    let upstreamHits = 0;
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query(true)
      .times(1)
      .reply(() => {
        upstreamHits += 1;
        // Pre-ingestion: article not in graph yet → empty subgraph.
        return [200, { nodes: [], edges: [], metadata: {} }];
      });

    const before = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(rawUrn)}`)
      .set(authHeader(user));
    expect(before.status).toBe(200);
    expect(before.body.nodes).toHaveLength(0);

    // Worker finishes ingesting the article and calls back the BFF.
    const job = await prisma.merltIngestionJob.create({
      data: { articleUrn: bareUrn, userId: user.id, status: 'running' },
    });
    const callback = await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'completed', nodesCreated: 3, edgesCreated: 2 });
    expect(callback.status).toBe(200);

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query(true)
      .times(1)
      .reply(() => {
        upstreamHits += 1;
        return [200, subgraphOf(bareUrn, 2)];
      });

    // Without invalidation this would still serve the cached empty subgraph.
    const after = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(rawUrn)}`)
      .set(authHeader(user));

    expect(after.status).toBe(200);
    expect(after.body.nodes).toHaveLength(3);
    expect(upstreamHits).toBe(2);
  });

  it('keeps the cache on a failed callback (graph unchanged)', async () => {
    const urn = 'urn:nir:stato:codice.civile:1942;2059';

    let upstreamHits = 0;
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query(true)
      .times(1)
      .reply(() => {
        upstreamHits += 1;
        return [200, subgraphOf(urn)];
      });

    await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
      .set(authHeader(user));

    const job = await prisma.merltIngestionJob.create({
      data: { articleUrn: urn, userId: user.id, status: 'running' },
    });
    await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'failed', error: 'scrape timeout' });

    // No interceptor left: only the cache can answer 200.
    const res = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(upstreamHits).toBe(1);
  });
});

describe('SubgraphCache — TTL / LRU / factory (unit)', () => {
  const value = (label: string): SubgraphResponse => ({
    nodes: [{ id: label, type: 'Norma', label }],
    edges: [],
  });

  it('expires entries after the TTL and refetches', async () => {
    const cache = new SubgraphCache(50, 10); // 50ms TTL: unit-only, factory clamps to ≥60s
    const key = subgraphCacheKey('urn:test', 2, 200);

    let calls = 0;
    const fetcher = async (): Promise<SubgraphResponse> => {
      calls += 1;
      return value(`v${calls}`);
    };

    const first = await cache.getOrFetch(key, fetcher);
    expect(first.nodes[0].id).toBe('v1');

    // Within TTL → cached.
    const cached = await cache.getOrFetch(key, fetcher);
    expect(cached.nodes[0].id).toBe('v1');
    expect(calls).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 70));

    const refetched = await cache.getOrFetch(key, fetcher);
    expect(refetched.nodes[0].id).toBe('v2');
    expect(calls).toBe(2);
  });

  it('evicts the least-recently-used entry when the bound is reached', async () => {
    const cache = new SubgraphCache(60_000, 2);
    const keyA = subgraphCacheKey('urn:a', 1, 25);
    const keyB = subgraphCacheKey('urn:b', 1, 25);
    const keyC = subgraphCacheKey('urn:c', 1, 25);

    await cache.getOrFetch(keyA, async () => value('a'));
    await cache.getOrFetch(keyB, async () => value('b'));
    // Touch A so B becomes the LRU entry.
    await cache.getOrFetch(keyA, async () => value('a-refetched'));
    // Inserting C evicts B (bound = 2).
    await cache.getOrFetch(keyC, async () => value('c'));
    expect(cache.size).toBe(2);

    // A must still be cached (it was touched, so C evicted B not A).
    const a = await cache.getOrFetch(keyA, async () => value('a2'));
    expect(a.nodes[0].id).toBe('a');

    let bRefetched = false;
    const b = await cache.getOrFetch(keyB, async () => {
      bRefetched = true;
      return value('b2');
    });
    expect(bRefetched).toBe(true);
    expect(b.nodes[0].id).toBe('b2');
  });

  it('invalidateUrn drops every depth/limit combo for that urn only', async () => {
    const cache = new SubgraphCache(60_000, 10);
    await cache.getOrFetch(subgraphCacheKey('urn:x', 1, 25), async () => value('x1'));
    await cache.getOrFetch(subgraphCacheKey('urn:x', 2, 200), async () => value('x2'));
    await cache.getOrFetch(subgraphCacheKey('urn:y', 1, 25), async () => value('y'));

    expect(cache.invalidateUrn('urn:x')).toBe(2);
    expect(cache.size).toBe(1);

    const y = await cache.getOrFetch(subgraphCacheKey('urn:y', 1, 25), async () => value('y2'));
    expect(y.nodes[0].id).toBe('y');
  });

  it('factory: defaults TTL to 120s and clamps the env override to [60s, 300s]', () => {
    expect(createSubgraphCache({}).ttlMs).toBe(120_000);
    expect(createSubgraphCache({}).maxEntries).toBe(200);
    expect(createSubgraphCache({ MERLT_SUBGRAPH_CACHE_TTL_MS: '1000' }).ttlMs).toBe(60_000);
    expect(createSubgraphCache({ MERLT_SUBGRAPH_CACHE_TTL_MS: '999999' }).ttlMs).toBe(300_000);
    expect(createSubgraphCache({ MERLT_SUBGRAPH_CACHE_TTL_MS: '90000' }).ttlMs).toBe(90_000);
    // Non-numeric values fall back to defaults instead of NaN-poisoning expiry.
    expect(createSubgraphCache({ MERLT_SUBGRAPH_CACHE_TTL_MS: 'abc' }).ttlMs).toBe(120_000);
    expect(createSubgraphCache({ MERLT_SUBGRAPH_CACHE_MAX_ENTRIES: '50' }).maxEntries).toBe(50);
  });
});
