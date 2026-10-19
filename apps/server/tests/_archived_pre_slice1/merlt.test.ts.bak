import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, app, createTestUser, authHeader, prisma } from './helpers';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

describe('MERLT gateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists consent and gates features from stored preference', async () => {
    const user = await createTestUser('merlt-consent');

    const initial = await request(app).get('/api/merlt/features').set(authHeader(user));
    expect(initial.status).toBe(200);
    expect(initial.body.consent_level).toBe('none');
    expect(initial.body.features.merlt).toBe(false);

    const updated = await request(app)
      .put('/api/merlt/consent')
      .set(authHeader(user))
      .send({
        consentLevel: 'full',
        contributionEnabled: true,
        validationEnabled: true,
        reason: 'test opt-in',
      });

    expect(updated.status).toBe(200);
    expect(updated.body.consentLevel).toBe('full');
    expect(updated.body.features.features.merlt).toBe(true);
    expect(updated.body.features.features.merlt_contribution).toBe(true);

    const auditCount = await prisma.merltConsentAudit.count({ where: { userId: user.id } });
    expect(auditCount).toBe(1);
  });

  it('blocks expert query until the user grants MERLT consent', async () => {
    const user = await createTestUser('merlt-blocked');

    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'Analizza questa norma con MERLT.' });

    expect(res.status).toBe(403);
    expect(res.body.detail).toContain('consent');
  });

  it('forwards expert query with VisuaLex user and article context', async () => {
    const user = await createTestUser('merlt-forward');
    await request(app).put('/api/merlt/consent').set(authHeader(user)).send({ consentLevel: 'basic' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        trace_id: 'trace-1',
        synthesis: 'ok',
        mode: 'convergent',
        sources: [],
        experts_used: ['literal'],
        confidence: 0.9,
        execution_time_ms: 12,
      }),
    );

    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({
        query: 'Analizza articolo e fonti correlate.',
        articleText: 'Il testo della norma',
        normaData: {
          urn: 'urn:nir:test:art1',
          numero_articolo: '1',
        },
        includeTrace: true,
      });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)['X-User-ID']).toBe(user.id);
    const body = JSON.parse(String(init?.body));
    expect(body.user_id).toBe(user.id);
    expect(body.context.article_urn).toBe('urn:nir:test:art1');
    expect(body.context.retrieved_chunks[0].text).toBe('Il testo della norma');
  });

  it('aggregates deep health from MERLT app and dashboard health', async () => {
    const user = await createTestUser('merlt-health');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'healthy' }))
      .mockResolvedValueOnce(jsonResponse({ services: { falkor: 'ok', qdrant: 'ok' } }));

    const res = await request(app).get('/api/merlt/health/deep').set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(fetchMock.mock.calls[0][0]).toContain('/health');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/dashboard/health');
  });

  it('accepts legacy POST for consent updates from stale frontend clients', async () => {
    const user = await createTestUser('merlt-consent-post');

    const res = await request(app)
      .post('/api/merlt/consent')
      .set(authHeader(user))
      .send({ consentLevel: 'basic' });

    expect(res.status).toBe(200);
    expect(res.body.consentLevel).toBe('basic');
    expect(res.body.features.features.merlt).toBe(true);
  });

  it('maps Visualex article fields to MERLT enrichment contracts', async () => {
    const user = await createTestUser('merlt-enrichment-contract');
    await request(app).put('/api/merlt/consent').set(authHeader(user)).send({ consentLevel: 'full' });

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ in_graph: false }))
      .mockResolvedValueOnce(jsonResponse({ success: true, pending_entities: [], pending_relations: [] }));

    const check = await request(app)
      .get('/api/merlt/enrichment/check-article')
      .query({
        tipo_atto: 'codice civile',
        numero_articolo: '1',
        numero_atto: '262',
        data: '1942-03-16',
      })
      .set(authHeader(user));

    expect(check.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain('articolo=1');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('numero_articolo=1');

    const live = await request(app)
      .post('/api/merlt/enrichment/live')
      .set(authHeader(user))
      .send({
        article_text: 'Articolo test',
        norma_data: {
          tipo_atto: 'codice civile',
          numero_articolo: '1',
        },
      });

    expect(live.status).toBe(200);
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(String(init?.body));
    expect(body.tipo_atto).toBe('codice civile');
    expect(body.articolo).toBe('1');
    expect(body.user_id).toBe(user.id);
  });

  it('uses query-param graph endpoints for URL-shaped article URNs', async () => {
    const user = await createTestUser('merlt-graph-contract');
    const articleUrn = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:test;1~art1!vig=';
    const encodedUrn = encodeURIComponent(articleUrn);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ article_urn: articleUrn, entities: [] }))
      .mockResolvedValueOnce(jsonResponse({ article_urn: articleUrn, relations: [] }));

    const entities = await request(app)
      .get(`/api/merlt/graph/article/${encodedUrn}/entities`)
      .set(authHeader(user));
    const relations = await request(app)
      .get(`/api/merlt/graph/article/${encodedUrn}/relations`)
      .set(authHeader(user));

    expect(entities.status).toBe(200);
    expect(relations.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/graph/article-entities?article_urn=');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/v1/graph/article-relations?article_urn=');
  });

  it('preserves MERLT client error status instead of converting every contract error to 502', async () => {
    const user = await createTestUser('merlt-error-contract');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Payload invalid for MERLT' }, { status: 422 }),
    );

    const res = await request(app)
      .get('/api/merlt/enrichment/check-article')
      .query({ tipo_atto: 'codice civile', numero_articolo: '1' })
      .set(authHeader(user));

    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('Payload invalid for MERLT');
  });

  it('rejects invalid validation and proposal payloads before calling MERLT', async () => {
    const user = await createTestUser('merlt-local-contract-validation');
    await request(app).put('/api/merlt/consent').set(authHeader(user)).send({ consentLevel: 'full' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));

    const cases = [
      ['/api/merlt/enrichment/validate-entity', { limit: 20 }],
      ['/api/merlt/enrichment/validate-relation', { limit: 20 }],
      ['/api/merlt/enrichment/propose-entity', { limit: 20 }],
      ['/api/merlt/enrichment/propose-relation', { limit: 20 }],
    ] as const;

    for (const [path, body] of cases) {
      const res = await request(app).post(path).set(authHeader(user)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/required|Invalid/i);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects empty graph search query before calling MERLT', async () => {
    const user = await createTestUser('merlt-empty-graph-search');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));

    const res = await request(app)
      .post('/api/merlt/graph/search')
      .set(authHeader(user))
      .send({ query: '' });

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/query/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects undefined document parse IDs before calling MERLT', async () => {
    const user = await createTestUser('merlt-doc-undefined');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));

    const res = await request(app)
      .post('/api/merlt/documents/undefined/parse')
      .set(authHeader(user))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/document/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects admin training mutations when MERLT admin API key is not configured', async () => {
    const user = await createTestUser('merlt-admin-no-key');
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));

    const res = await request(app)
      .post('/api/merlt/ops/rlcf/training/start')
      .set(authHeader(user))
      .send({ epochs: 1, learning_rate: 0.0001, batch_size: 32, buffer_threshold: 50 });

    expect(res.status).toBe(503);
    expect(res.body.detail).toMatch(/API key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
