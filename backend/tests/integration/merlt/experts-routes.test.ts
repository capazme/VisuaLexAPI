import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from '../../helpers';
import { _resetExpertsClientForTests } from '../../../src/services/merlt/expertsClient';
import { _resetSteerDedupeForTests } from '../../../src/routes/merlt/experts';

const TEST_MERLT_BASE = 'http://experts-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_EXPERTS_TIMEOUT_MS = '500';
  _resetExpertsClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});
afterEach(() => nock.cleanAll());
afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_EXPERTS_TIMEOUT_MS;
});

async function grantFull(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'full' });
}

async function grantBasic(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'basic' });
}

/** A completed async answer of `user` carrying `traceId`: the cheapest ownership proof. */
async function ownAsyncTrace(user: TestUser, traceId: string): Promise<void> {
  await prisma.merltQaJob.create({
    data: {
      userId: user.id,
      query: 'art 1453?',
      mode: 'convergent',
      consentLevel: 'full',
      status: 'completed',
      traceId,
    },
  });
}

const QUERY_OK = {
  trace_id: 'trace_abc',
  synthesis: 'La risoluzione...',
  mode: 'convergent',
  sources: [],
  retrieved_sources: [{ urn: 'urn:nir:..~art1453', provenance: 'seed', trust: 1, node_id: 'urn:nir:..~art1453' }],
  experts_used: ['literal', 'precedent'],
  confidence: 0.55,
  execution_time_ms: 1234,
};

// Slice 4 P2a "il dibattito visibile": the 3 deliberation fields the engine
// computes and now surfaces at the DTO. The BFF must forward them verbatim.
const QUERY_OK_WITH_DEBATE = {
  trace_id: 'trace_debate',
  synthesis: 'I canoni divergono...',
  mode: 'divergent',
  sources: [],
  retrieved_sources: [],
  experts_used: ['literal', 'principles'],
  confidence: 0.42,
  execution_time_ms: 5678,
  disagreement_analysis: {
    has_disagreement: true,
    disagreement_type: 'interpretive',
    disagreement_level: 'expert_pair',
    intensity: 0.72,
    resolvability: 0.35,
    confidence: 0.81,
    conflicts: [
      {
        expert_a: 'literal',
        expert_b: 'principles',
        conflict_score: 0.68,
        contention_point: 'ambito di applicazione',
        excerpt_a: 'la lettera della norma...',
        excerpt_b: 'la ratio impone...',
      },
    ],
    pairwise_matrix: [
      [0, 0.68],
      [0.68, 0],
    ],
  },
  devils_advocate_flag: { active: true, expert: null },
  expert_contributions: [
    { expert: 'literal', thesis: 'Tesi letterale completa...', confidence: 0.9, weight: 0.42 },
    { expert: 'principles', thesis: 'Tesi per principi completa...', confidence: 0.8, weight: 0.58 },
  ],
};

describe('MERL-T experts routes (Loop β Phase F)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('experts-alice');
    // The traceId-keyed routes require the caller to own the trace.
    for (const traceId of ['trace_abc', 'trace_xyz', 'trace_rel', 'trace_debate']) {
      await ownAsyncTrace(user, traceId);
    }
  });

  it('401 without auth', async () => {
    const res = await request(app).post('/api/merlt/experts/query').send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(401);
  });

  it('403 without any consent (asking needs at least basic — Slice 3 D2)', async () => {
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('consent_required');
  });

  it('basic consent CAN ask (asking is consumption, not contribution — Slice 3 D2)', async () => {
    await grantBasic(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query', (b) => (b as { consent_level: string }).consent_level === 'basic')
      .reply(200, QUERY_OK);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(200);
    expect(res.body.trace_id).toBe('trace_abc');
  });

  it('400 on too-short query', async () => {
    await grantFull(user);
    const res = await request(app).post('/api/merlt/experts/query').set(authHeader(user)).send({ query: 'q' });
    expect(res.status).toBe(400);
  });

  it('proxies the query, injects user_id + consent_level=full, returns provenance-tagged sources', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query', (b) => {
        const body = b as { query: string; user_id: string; consent_level: string; include_trace: boolean };
        return (
          body.query === 'art 1453 risoluzione' &&
          body.user_id === user.id &&
          body.consent_level === 'full' &&
          body.include_trace === true
        );
      })
      .reply(200, QUERY_OK);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione', mode: 'convergent' });
    expect(res.status).toBe(200);
    expect(res.body.trace_id).toBe('trace_abc');
    expect(res.body.retrieved_sources[0].provenance).toBe('seed');
  });

  // Wave 2 context-anchored ask: contextUrn rides to MERL-T inside
  // context.context_urn (snake_case), next to the existing mode.
  it('forwards contextUrn inside context.context_urn (anchored ask)', async () => {
    await grantBasic(user);
    let sentContext: Record<string, unknown> | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query', (b) => {
        sentContext = (b as { context?: Record<string, unknown> }).context;
        return true;
      })
      .reply(200, QUERY_OK);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({
        query: 'art 1453 risoluzione',
        mode: 'convergent',
        contextUrn: 'urn:nir:stato:codice.civile:1942-03-16;262~art1453',
      });
    expect(res.status).toBe(200);
    expect(sentContext).toEqual({
      mode: 'convergent',
      context_urn: 'urn:nir:stato:codice.civile:1942-03-16;262~art1453',
    });
  });

  // Nodes-as-context: the FE context basket → MERL-T context.entities (the
  // channel the orchestrator actually consumes). Norma nodes → norm_references,
  // concept nodes → legal_concepts; both deduped.
  it('maps the context basket to context.entities (norm_references + legal_concepts, deduped)', async () => {
    await grantBasic(user);
    let sentContext: Record<string, unknown> | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query', (b) => {
        sentContext = (b as { context?: Record<string, unknown> }).context;
        return true;
      })
      .reply(200, QUERY_OK);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({
        query: 'come opera il beneficio di escussione?',
        mode: 'convergent',
        context: {
          normReferences: [
            'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1944',
            'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1944',
          ],
          legalConcepts: ['fideiussione'],
        },
      });
    expect(res.status).toBe(200);
    expect(sentContext).toEqual({
      mode: 'convergent',
      entities: {
        norm_references: [
          'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1944',
        ],
        legal_concepts: ['fideiussione'],
      },
    });
  });

  it('an empty context basket sends NO entities', async () => {
    await grantBasic(user);
    let sentContext: Record<string, unknown> | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query', (b) => {
        sentContext = (b as { context?: Record<string, unknown> }).context;
        return true;
      })
      .reply(200, QUERY_OK);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'domanda generale?', mode: 'convergent', context: { normReferences: [], legalConcepts: [] } });
    expect(res.status).toBe(200);
    expect(sentContext).toEqual({ mode: 'convergent' });
    expect(sentContext).not.toHaveProperty('entities');
  });

  it('an unanchored ask (chip removed) sends NO context_urn', async () => {
    await grantBasic(user);
    let sentContext: Record<string, unknown> | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query', (b) => {
        sentContext = (b as { context?: Record<string, unknown> }).context;
        return true;
      })
      .reply(200, QUERY_OK);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione', mode: 'convergent' });
    expect(res.status).toBe(200);
    expect(sentContext).toEqual({ mode: 'convergent' });
    expect(sentContext).not.toHaveProperty('context_urn');
  });

  it('no mode + no contextUrn → context stays undefined (legacy shape)', async () => {
    await grantBasic(user);
    let sentBody: Record<string, unknown> | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query', (b) => {
        sentBody = b as Record<string, unknown>;
        return true;
      })
      .reply(200, QUERY_OK);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(200);
    expect(sentBody).not.toHaveProperty('context');
  });

  it('400 on a blank contextUrn', async () => {
    await grantBasic(user);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione', contextUrn: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_body');
  });

  it('503 when MERL-T is unavailable (5xx)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/experts/query').reply(502, 'down');
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('passes through a MERL-T 4xx', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/experts/query').reply(422, { detail: 'query too short upstream' });
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('query too short upstream');
  });

  it('confirm-source forwards node_id + entity_text + injected user_id', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/enrichment/confirm-source', (b) => {
        const body = b as { node_id: string; user_id: string; entity_text: string };
        return body.node_id === 'live:abc123' && body.user_id === user.id && body.entity_text === 'art. 1453';
      })
      .reply(200, { node_id: 'live:abc123', pending_entity_id: 42 });
    const res = await request(app)
      .post('/api/merlt/experts/confirm-source')
      .set(authHeader(user))
      .send({ nodeId: 'live:abc123', entityText: 'art. 1453' });
    expect(res.status).toBe(200);
    expect(res.body.pending_entity_id).toBe(42);
  });

  it('rejects a non-provisional confirm-source node id (400)', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/experts/confirm-source')
      .set(authHeader(user))
      .send({ nodeId: 'urn:nir:..~art1453', entityText: 'art. 1453' });
    expect(res.status).toBe(400);
  });

  it('rejects confirm-source without entityText (400, B3)', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/experts/confirm-source')
      .set(authHeader(user))
      .send({ nodeId: 'live:abc123' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_body');
  });

  it('rejects confirm-source when entityText is the raw provisional id (400, B3)', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/experts/confirm-source')
      .set(authHeader(user))
      .send({ nodeId: 'live:abc123', entityText: 'live:abc123' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_body');
  });

  it('rejects confirm-source when entityText starts with a bare live: prefix (400, B3)', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/experts/confirm-source')
      .set(authHeader(user))
      .send({ nodeId: 'live:abc123', entityText: 'live:deadbeef' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_body');
  });

  it('inline feedback forwards rating + user_id', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/inline', (b) => {
        const body = b as { trace_id: string; user_id: string; rating: number };
        return body.trace_id === 'trace_abc' && body.user_id === user.id && body.rating === 5;
      })
      .reply(200, { success: true, feedback_id: 1, message: 'ok' });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/inline')
      .set(authHeader(user))
      .send({ traceId: 'trace_abc', rating: 5 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('history forwards user_id + clamped limit and returns the list', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/experts/history')
      .query((q) => q.user_id === user.id && q.limit === '20')
      .reply(200, [
        { trace_id: 'trace_x', query: 'art 1453?', synthesis: 'La risoluzione…', mode: 'convergent', confidence: 0.6, experts_used: ['literal'], sources: [], created_at: '2026-05-31T10:00:00Z' },
      ]);
    const res = await request(app).get('/api/merlt/experts/history').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body[0].trace_id).toBe('trace_x');
  });

  it('history requires at least basic consent (403 when none)', async () => {
    const res = await request(app).get('/api/merlt/experts/history').set(authHeader(user));
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('consent_required');
  });

  it('preference feedback (divergent) forwards preferred_expert', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/preference', (b) => (b as { preferred_expert: string }).preferred_expert === 'systemic')
      .reply(200, { success: true, message: 'ok' });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/preference')
      .set(authHeader(user))
      .send({ traceId: 'trace_abc', preferredExpert: 'systemic' });
    expect(res.status).toBe(200);
  });

  // Slice 4 P2b "insegna i pesi" (L2 teach-the-weights): the preference channel
  // is the ONLY path that carries the canon identity MERL-T now routes into the
  // gating gradient. The BFF must forward (a) preferred_expert verbatim AND
  // (b) user_id — MERL-T derives the jurist's authority server-side FROM user_id
  // to authority-weight the advantage. Neither can be dropped or the gradient is
  // wrong (unweighted) or lost (no canon).
  it('preference feedback forwards trace_id + preferred_expert + injected user_id (L2 authority key)', async () => {
    await grantFull(user);
    let captured: { trace_id?: string; preferred_expert?: string; user_id?: string } = {};
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/preference', (b) => {
        captured = b as typeof captured;
        return true;
      })
      .reply(200, { success: true, message: 'ok' });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/preference')
      .set(authHeader(user))
      .send({ traceId: 'trace_xyz', preferredExpert: 'precedent', comment: 'più peso al precedente' });
    expect(res.status).toBe(200);
    expect(captured.trace_id).toBe('trace_xyz');
    expect(captured.preferred_expert).toBe('precedent');
    // user_id is the authority-lookup key on the MERL-T side; the client must
    // never let it be client-supplied — it comes from the JWT.
    expect(captured.user_id).toBe(user.id);
  });

  it('preference feedback accepts all 4 canon identities (literal|systemic|principles|precedent)', async () => {
    await grantFull(user);
    for (const canon of ['literal', 'systemic', 'principles', 'precedent'] as const) {
      nock(TEST_MERLT_BASE)
        .post('/api/v1/experts/feedback/preference', (b) => (b as { preferred_expert: string }).preferred_expert === canon)
        .reply(200, { success: true, message: 'ok' });
      const res = await request(app)
        .post('/api/merlt/experts/feedback/preference')
        .set(authHeader(user))
        .send({ traceId: 'trace_abc', preferredExpert: canon });
      expect(res.status).toBe(200);
    }
  });

  it('preference feedback rejects an unknown canon (400, no forward to MERL-T)', async () => {
    await grantFull(user);
    // No nock interceptor: if the route forwarded, the request would fail on
    // disabled net-connect — the 400 must come from Zod BEFORE any MERL-T call.
    const res = await request(app)
      .post('/api/merlt/experts/feedback/preference')
      .set(authHeader(user))
      .send({ traceId: 'trace_abc', preferredExpert: 'gating' });
    expect(res.status).toBe(400);
  });

  it('preference feedback requires full consent (403 with only basic)', async () => {
    await grantBasic(user);
    const res = await request(app)
      .post('/api/merlt/experts/feedback/preference')
      .set(authHeader(user))
      .send({ traceId: 'trace_abc', preferredExpert: 'systemic' });
    expect(res.status).toBe(403);
  });

  // Slice 4 P2a "il dibattito visibile": the BFF must forward the 3 deliberation
  // DTO fields verbatim (disagreement_analysis + devils_advocate_flag +
  // expert_contributions). FE renders contrast arcs / canon nodes / theses off them.
  it('query forwards disagreement_analysis + devils_advocate_flag + expert_contributions verbatim (P2a)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/experts/query').reply(200, QUERY_OK_WITH_DEBATE);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(200);
    // disagreement_analysis: the contrast arc + intensity/resolvability metrics
    expect(res.body.disagreement_analysis.has_disagreement).toBe(true);
    expect(res.body.disagreement_analysis.intensity).toBe(0.72);
    expect(res.body.disagreement_analysis.resolvability).toBe(0.35);
    expect(res.body.disagreement_analysis.conflicts).toHaveLength(1);
    expect(res.body.disagreement_analysis.conflicts[0].expert_a).toBe('literal');
    expect(res.body.disagreement_analysis.conflicts[0].expert_b).toBe('principles');
    expect(res.body.disagreement_analysis.conflicts[0].conflict_score).toBe(0.68);
    expect(res.body.disagreement_analysis.pairwise_matrix).toEqual([
      [0, 0.68],
      [0.68, 0],
    ]);
    // devils_advocate_flag: active, expert null (attribution deferred to P2b)
    expect(res.body.devils_advocate_flag.active).toBe(true);
    expect(res.body.devils_advocate_flag.expert).toBeNull();
    // expert_contributions: per-canon full thesis + confidence + routing weight
    expect(res.body.expert_contributions).toHaveLength(2);
    expect(res.body.expert_contributions[0].expert).toBe('literal');
    expect(res.body.expert_contributions[0].thesis).toBe('Tesi letterale completa...');
    expect(res.body.expert_contributions[0].weight).toBe(0.42);
    expect(res.body.expert_contributions[1].expert).toBe('principles');
    expect(res.body.expert_contributions[1].weight).toBe(0.58);
  });

  it('convergent query omits disagreement (null) and still forwards it (P2a)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/experts/query').reply(200, {
      ...QUERY_OK,
      disagreement_analysis: null,
      devils_advocate_flag: { active: false, expert: null },
      expert_contributions: [],
    });
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(200);
    expect(res.body.disagreement_analysis).toBeNull();
    expect(res.body.devils_advocate_flag.active).toBe(false);
    expect(res.body.expert_contributions).toEqual([]);
  });

  // Slice 4 L3 "privilegia questa relazione": the relation channel carries the
  // TARGET IDENTITY (which graph relation to favour) into the traversal-head
  // gradient. Like preference (L2), the BFF must forward relation_type verbatim
  // and inject user_id from the JWT (MERL-T's authority-lookup key) — never
  // client-supplied.
  it('relation feedback 401 without auth', async () => {
    const res = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .send({ traceId: 'trace_abc', relationType: 'modifica' });
    expect(res.status).toBe(401);
  });

  it('relation feedback requires full consent (403 with only basic — teaching, Slice 3 D2)', async () => {
    await grantBasic(user);
    const res = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .set(authHeader(user))
      .send({ traceId: 'trace_abc', relationType: 'modifica' });
    expect(res.status).toBe(403);
  });

  it('relation feedback rejects an invalid body (400, no forward to MERL-T)', async () => {
    await grantFull(user);
    // No nock interceptor: if the route forwarded, the request would fail on
    // disabled net-connect — the 400 must come from Zod BEFORE any MERL-T call.
    for (const body of [
      {}, // both missing
      { relationType: 'modifica' }, // traceId missing
      { traceId: 'trace_abc' }, // relationType missing
      { traceId: 'trace_abc', relationType: '   ' }, // blank after trim
      { traceId: 'trace_abc', relationType: 'x'.repeat(101) }, // over 100 cap
    ]) {
      const res = await request(app)
        .post('/api/merlt/experts/feedback/relation')
        .set(authHeader(user))
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.detail).toBe('invalid_body');
    }
  });

  it('relation feedback forwards trace_id + relation_type + injected user_id (L3 target identity)', async () => {
    await grantFull(user);
    let captured: { trace_id?: string; relation_type?: string; user_id?: string; comment?: string } = {};
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/relation', (b) => {
        captured = b as typeof captured;
        return true;
      })
      .reply(200, { success: true, feedback_id: 7, message: 'Relation preference saved: modifica' });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .set(authHeader(user))
      .send({ traceId: 'trace_rel', relationType: 'modifica', comment: 'la catena delle novelle è decisiva qui' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(captured.trace_id).toBe('trace_rel');
    expect(captured.relation_type).toBe('modifica');
    expect(captured.comment).toBe('la catena delle novelle è decisiva qui');
    // user_id is the authority-lookup key on the MERL-T side; it comes from the
    // JWT, never from the client body.
    expect(captured.user_id).toBe(user.id);
  });

  it('relation feedback trims relationType before forwarding', async () => {
    await grantFull(user);
    let captured: { relation_type?: string } = {};
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/relation', (b) => {
        captured = b as typeof captured;
        return true;
      })
      .reply(200, { success: true, message: 'ok' });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .set(authHeader(user))
      .send({ traceId: 'trace_rel', relationType: '  DISCIPLINA  ' });
    expect(res.status).toBe(200);
    expect(captured.relation_type).toBe('DISCIPLINA');
  });

  it('relation feedback maps MERL-T 5xx to 503 merlt_unavailable', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/experts/feedback/relation').reply(502, 'down');
    const res = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .set(authHeader(user))
      .send({ traceId: 'trace_rel', relationType: 'modifica' });
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('refine forwards the debate fields too (the debate stays visible on follow-ups, P2a)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/refine', (b) => {
        const body = b as { trace_id: string; user_id: string; follow_up_query: string };
        return body.trace_id === 'trace_debate' && body.user_id === user.id && body.follow_up_query === 'e la buona fede?';
      })
      .reply(200, QUERY_OK_WITH_DEBATE);
    const res = await request(app)
      .post('/api/merlt/experts/refine')
      .set(authHeader(user))
      .send({ traceId: 'trace_debate', followUpQuery: 'e la buona fede?' });
    expect(res.status).toBe(200);
    expect(res.body.disagreement_analysis.conflicts[0].conflict_score).toBe(0.68);
    expect(res.body.devils_advocate_flag.active).toBe(true);
    expect(res.body.expert_contributions).toHaveLength(2);
  });
});

// sec-experts-trace-idor: /refine and /feedback/* used to forward any traceId,
// so a leaked id let anyone rate or steer another jurist's answer (poisoning
// the RLCF buffer) or pull its query into their own refinement.
describe('trace ownership on the traceId-keyed routes', () => {
  let owner: TestUser;
  let intruder: TestUser;
  beforeEach(async () => {
    owner = await createTestUser('trace-owner');
    intruder = await createTestUser('trace-intruder');
    await grantFull(owner);
    await grantFull(intruder);
    _resetSteerDedupeForTests();
  });

  const ROUTES: Array<{ path: string; upstream: string; body: Record<string, unknown> }> = [
    { path: '/api/merlt/experts/feedback/inline', upstream: '/api/v1/experts/feedback/inline', body: { rating: 5 } },
    {
      path: '/api/merlt/experts/feedback/source',
      upstream: '/api/v1/experts/feedback/source',
      body: { sourceId: 'urn:nir:x~art1453', relevance: 4 },
    },
    {
      path: '/api/merlt/experts/feedback/detailed',
      upstream: '/api/v1/experts/feedback/detailed',
      body: { retrievalScore: 0.8, reasoningScore: 0.7, synthesisScore: 0.9 },
    },
    {
      path: '/api/merlt/experts/feedback/preference',
      upstream: '/api/v1/experts/feedback/preference',
      body: { preferredExpert: 'literal' },
    },
    {
      path: '/api/merlt/experts/feedback/relation',
      upstream: '/api/v1/experts/feedback/relation',
      body: { relationType: 'DISCIPLINA' },
    },
    {
      path: '/api/merlt/experts/refine',
      upstream: '/api/v1/experts/feedback/refine',
      body: { followUpQuery: 'e la buona fede?' },
    },
  ];

  it("404s every route on another user's async trace, forwarding nothing", async () => {
    await ownAsyncTrace(owner, 'trace_owned');
    for (const route of ROUTES) {
      // The intruder has no job row, so the BFF asks MERL-T: the trace names its owner.
      nock(TEST_MERLT_BASE)
        .get('/api/v1/experts/trace/trace_owned')
        .reply(200, { trace_id: 'trace_owned', user_id: owner.id, stages: {} });
      const upstream = nock(TEST_MERLT_BASE).post(route.upstream).reply(200, { success: true });
      const res = await request(app)
        .post(route.path)
        .set(authHeader(intruder))
        .send({ traceId: 'trace_owned', ...route.body });
      expect(res.status, route.path).toBe(404);
      expect(res.body.detail).toBe('trace_not_found');
      expect(upstream.isDone(), route.path).toBe(false);
      nock.cleanAll();
    }
  });

  it('the owner of an async trace passes on every route (job row, no MERL-T lookup)', async () => {
    await ownAsyncTrace(owner, 'trace_owned');
    for (const route of ROUTES) {
      nock(TEST_MERLT_BASE)
        .post(route.upstream, (b) => (b as { trace_id: string }).trace_id === 'trace_owned')
        .reply(200, route.path.endsWith('/refine') ? QUERY_OK : { success: true });
      const res = await request(app)
        .post(route.path)
        .set(authHeader(owner))
        .send({ traceId: 'trace_owned', ...route.body });
      expect(res.status, route.path).toBe(200);
    }
    expect(nock.isDone()).toBe(true);
  });

  it('a sync trace is owned when the MERL-T trace names the caller', async () => {
    nock(TEST_MERLT_BASE)
      .get('/api/v1/experts/trace/trace_sync')
      .reply(200, { trace_id: 'trace_sync', input: { user_id: owner.id } });
    nock(TEST_MERLT_BASE).post('/api/v1/experts/feedback/inline').reply(200, { success: true });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/inline')
      .set(authHeader(owner))
      .send({ traceId: 'trace_sync', rating: 1 });
    expect(res.status).toBe(200);
  });

  it("a sync trace is owned when it is in the caller's MERL-T history (the stored trace names no user)", async () => {
    nock(TEST_MERLT_BASE)
      .get('/api/v1/experts/trace/trace_sync')
      .reply(200, { trace_id: 'trace_sync', stages: {} });
    nock(TEST_MERLT_BASE)
      .get('/api/v1/experts/history')
      .query((q) => q.user_id === owner.id && q.limit === '100')
      .reply(200, [{ trace_id: 'trace_other' }, { trace_id: 'trace_sync' }]);
    nock(TEST_MERLT_BASE).post('/api/v1/experts/feedback/inline').reply(200, { success: true });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/inline')
      .set(authHeader(owner))
      .send({ traceId: 'trace_sync', rating: 5 });
    expect(res.status).toBe(200);
  });

  it("404 when the trace is neither the caller's job, nor named for them, nor in their history", async () => {
    nock(TEST_MERLT_BASE).get('/api/v1/experts/trace/trace_sync').reply(404, { detail: 'Trace trace_sync not found' });
    nock(TEST_MERLT_BASE)
      .get('/api/v1/experts/history')
      .query((q) => q.user_id === intruder.id)
      .reply(200, [{ trace_id: 'trace_mine' }]);
    const upstream = nock(TEST_MERLT_BASE).post('/api/v1/experts/feedback/inline').reply(200, { success: true });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/inline')
      .set(authHeader(intruder))
      .send({ traceId: 'trace_sync', rating: 5 });
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('trace_not_found');
    expect(upstream.isDone()).toBe(false);
  });

  it('503 (not a verdict) when MERL-T cannot be asked about the trace', async () => {
    nock(TEST_MERLT_BASE).get('/api/v1/experts/trace/trace_sync').reply(502, 'down');
    const res = await request(app)
      .post('/api/merlt/experts/feedback/inline')
      .set(authHeader(owner))
      .send({ traceId: 'trace_sync', rating: 5 });
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });
});
