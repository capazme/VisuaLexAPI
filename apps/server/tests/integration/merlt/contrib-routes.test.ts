import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import {
  request,
  app,
  createTestUser,
  authHeader,
  prisma,
  type TestUser,
} from '../../helpers';
import { _resetContribClientForTests } from '../../../src/routes/merlt/contrib';

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';
const INTERNAL_SECRET = 'test-internal-secret';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  process.env.MERLT_CONTRIB_TIMEOUT_MS = '500';
  process.env.MERLT_INTERNAL_SECRET = INTERNAL_SECRET;
  _resetContribClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});

afterEach(() => nock.cleanAll());

afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_TIMEOUT_MS;
  delete process.env.MERLT_CONTRIB_TIMEOUT_MS;
  delete process.env.MERLT_INTERNAL_SECRET;
});

async function grantFull(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'full' });
}

/** MERL-T GET /api/v1/documents/:id answering with `uploadedBy` as the uploader. */
function documentUploadedBy(documentId: number, uploadedBy: string) {
  return nock(TEST_MERLT_BASE)
    .get(`/api/v1/documents/${documentId}`)
    .reply(200, { id: documentId, filename: 'x.txt', uploaded_by: uploadedBy, processing_status: 'uploaded' });
}

describe('POST /api/merlt/contrib/documents (upload)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('contrib-upload');
  });

  it('403s without full consent', async () => {
    const res = await request(app)
      .post('/api/merlt/contrib/documents')
      .set(authHeader(user))
      .attach('file', Buffer.from('appunti'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(res.status).toBe(403);
  });

  it('400s when no file is attached', async () => {
    await grantFull(user);
    const res = await request(app).post('/api/merlt/contrib/documents').set(authHeader(user));
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('file_required');
  });

  it('400s on an unsupported file type', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/contrib/documents')
      .set(authHeader(user))
      .attach('file', Buffer.from('x'), { filename: 'malware.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_file');
  });

  it('forwards a valid file to MERL-T and returns the document id (201)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/documents/upload').reply(200, { document_id: 99 });
    const res = await request(app)
      .post('/api/merlt/contrib/documents')
      .set(authHeader(user))
      .attach('file', Buffer.from('i miei appunti'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(res.body.documentId).toBe(99);
  });
});

describe('POST /api/merlt/contrib/documents/:id/extract', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('contrib-alice');
  });

  it('403s without full (contribution) consent', async () => {
    const res = await request(app)
      .post('/api/merlt/contrib/documents/42/extract')
      .set(authHeader(user));
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('contribution_consent_required');
  });

  it('creates a job and enqueues the extraction (202)', async () => {
    await grantFull(user);
    documentUploadedBy(42, user.id);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/documents/42/extract-async')
      .reply(202, { task_id: 'task-xyz' });

    const res = await request(app)
      .post('/api/merlt/contrib/documents/42/extract')
      .set(authHeader(user));

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
    const job = await prisma.merltExtractionJob.findUnique({ where: { id: res.body.jobId } });
    expect(job?.taskId).toBe('task-xyz');
    expect(job?.userId).toBe(user.id);
  });

  it('still returns the job when MERL-T enqueue fails', async () => {
    await grantFull(user);
    documentUploadedBy(42, user.id);
    nock(TEST_MERLT_BASE).post('/api/v1/documents/42/extract-async').reply(503, 'down');
    const res = await request(app)
      .post('/api/merlt/contrib/documents/42/extract')
      .set(authHeader(user));
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
  });

  // sec-contrib-extract-idor: document ids are sequential integers; extracting
  // someone else's upload would stage their verbatim excerpts under the caller.
  it("404s on another user's document: no job row, nothing enqueued", async () => {
    await grantFull(user);
    const other = await createTestUser('contrib-mallory');
    documentUploadedBy(42, other.id);
    const enqueue = nock(TEST_MERLT_BASE)
      .post('/api/v1/documents/42/extract-async')
      .reply(202, { task_id: 'task-stolen' });

    const res = await request(app)
      .post('/api/merlt/contrib/documents/42/extract')
      .set(authHeader(user));

    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('document_not_found');
    expect(enqueue.isDone()).toBe(false);
    expect(await prisma.merltExtractionJob.count()).toBe(0);
  });

  it('404s when MERL-T does not know the document', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).get('/api/v1/documents/42').reply(404, { detail: 'Document not found' });
    const res = await request(app)
      .post('/api/merlt/contrib/documents/42/extract')
      .set(authHeader(user));
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('document_not_found');
    expect(await prisma.merltExtractionJob.count()).toBe(0);
  });

  it('503s (and creates no job) when MERL-T cannot say who uploaded the document', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).get('/api/v1/documents/42').reply(500, 'boom');
    const res = await request(app)
      .post('/api/merlt/contrib/documents/42/extract')
      .set(authHeader(user));
    expect(res.status).toBe(503);
    expect(await prisma.merltExtractionJob.count()).toBe(0);
  });
});

describe('GET /api/merlt/contrib/documents/:id/candidates', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('contrib-bob');
  });

  it('proxies candidates scoped to the contributor', async () => {
    await grantFull(user);
    documentUploadedBy(42, user.id);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/documents/42/candidates')
      .query((q) => q.contributor_id === user.id)
      .reply(200, { candidates: [{ id: 1, candidate_type: 'entity', entity_text: 'X' }] });

    const res = await request(app)
      .get('/api/merlt/contrib/documents/42/candidates')
      .set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
  });

  it('503s when MERL-T is unavailable', async () => {
    await grantFull(user);
    documentUploadedBy(42, user.id);
    nock(TEST_MERLT_BASE).get('/api/v1/documents/42/candidates').query(true).reply(500, 'boom');
    const res = await request(app)
      .get('/api/merlt/contrib/documents/42/candidates')
      .set(authHeader(user));
    expect(res.status).toBe(503);
  });

  it("404s on another user's document without listing anything", async () => {
    await grantFull(user);
    const other = await createTestUser('contrib-eve');
    documentUploadedBy(42, other.id);
    const list = nock(TEST_MERLT_BASE)
      .get('/api/v1/documents/42/candidates')
      .query(true)
      .reply(200, { candidates: [{ id: 1, candidate_type: 'entity', entity_text: 'X' }] });

    const res = await request(app)
      .get('/api/merlt/contrib/documents/42/candidates')
      .set(authHeader(user));
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('document_not_found');
    expect(list.isDone()).toBe(false);
  });

  it('404s when MERL-T does not know the document', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).get('/api/v1/documents/42').reply(404, { detail: 'Document not found' });
    const res = await request(app)
      .get('/api/merlt/contrib/documents/42/candidates')
      .set(authHeader(user));
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('document_not_found');
  });
});

describe('GET /api/merlt/contrib/jobs/:jobId/status', () => {
  it('is owner-scoped (404 for another user)', async () => {
    const owner = await createTestUser('contrib-owner');
    const other = await createTestUser('contrib-other');
    const job = await prisma.merltExtractionJob.create({
      data: { documentId: '42', userId: owner.id, status: 'pending' },
    });

    const ok = await request(app)
      .get(`/api/merlt/contrib/jobs/${job.id}/status`)
      .set(authHeader(owner));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('pending');

    const denied = await request(app)
      .get(`/api/merlt/contrib/jobs/${job.id}/status`)
      .set(authHeader(other));
    expect(denied.status).toBe(404);
  });
});

describe('POST /api/merlt/contrib/candidates/:id/promote', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('contrib-carol');
  });

  const entityBody = {
    candidateType: 'entity' as const,
    articleUrn: 'urn:test',
    nome: 'Risoluzione',
    tipo: 'concetto',
    descrizione: 'La risoluzione estingue il contratto con effetto retroattivo.',
    fonte: 'Torrente, Manuale, p.120',
    attested: true,
  };

  it('rejects (422) when attestation is missing — no proposal is made', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', document_id: 42, verbatim_excerpt: 'raw verbatim' });
    documentUploadedBy(42, user.id);

    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send({ ...entityBody, attested: false });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ detail: 'promotion_rejected', reason: 'not_attested' });
  });

  it('rejects (422) when the text equals the verbatim excerpt', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', document_id: 42, verbatim_excerpt: entityBody.descrizione });
    documentUploadedBy(42, user.id);

    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('not_reformulated');
  });

  it('promotes a valid entity → pending proposal (200)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', document_id: 42, verbatim_excerpt: 'raw verbatim text' });
    documentUploadedBy(42, user.id);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/enrichment/propose-entity', (b) => (b as { contributed_by: string }).contributed_by === user.id)
      // Real MERL-T shape: id is nested under pending_entity (EntityProposalResponse).
      .reply(200, { success: true, pending_entity: { id: 'pe-99', nome: 'X', tipo: 'concetto' }, message: 'ok' });
    nock(TEST_MERLT_BASE).post('/api/v1/candidates/7/mark-promoted').reply(200, { ok: true });

    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);

    expect(res.status).toBe(200);
    expect(res.body.pendingId).toBe('pe-99');
  });

  it('does not mark a candidate promoted when MERL-T defers on a duplicate, and says so', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', document_id: 42, verbatim_excerpt: 'raw verbatim text' });
    documentUploadedBy(42, user.id);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/enrichment/propose-entity')
      // Dedup-defer: no pending_entity, just the duplicate warning.
      .reply(200, {
        success: false,
        message: "Entita' identica gia' esistente",
        has_duplicates: true,
        duplicate_action_required: true,
        duplicates: [{ entity_id: 'concetto:risoluzione', entity_text: 'Risoluzione', entity_type: 'concetto' }],
      });
    // Deliberately NO mark-promoted interceptor: the route must NOT call it when
    // no pending id came back (nock would throw on an unexpected request).

    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);

    expect(res.status).toBe(200);
    expect(res.body.pendingId).toBeNull();
    expect(res.body.created).toBe(false);
    expect(res.body.duplicateActionRequired).toBe(true);
    expect(res.body.message).toBe("Entita' identica gia' esistente");
    expect(res.body.duplicates).toEqual([{ id: 'concetto:risoluzione', text: 'Risoluzione' }]);
  });

  it('files the entity under the candidate LLM type and carries provenance to MERL-T', async () => {
    await grantFull(user);
    let sent: Record<string, unknown> | undefined;
    nock(TEST_MERLT_BASE).get('/api/v1/candidates/7').reply(200, {
      id: 7,
      candidate_type: 'entity',
      entity_type: 'definizione',
      document_id: 42,
      verbatim_excerpt: 'raw verbatim text',
    });
    documentUploadedBy(42, user.id);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/enrichment/propose-entity', (b) => {
        sent = b as Record<string, unknown>;
        return true;
      })
      .reply(200, { success: true, pending_entity: { id: 'pe-100', nome: 'X', tipo: 'definizione' } });
    nock(TEST_MERLT_BASE).post('/api/v1/candidates/7/mark-promoted').reply(200, { ok: true });

    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send({ ...entityBody, tipo: 'concetto', skipDuplicateCheck: true, acknowledgedDuplicateOf: 'concetto:r' });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    // The client said concetto; the authoritative candidate says definizione.
    expect(sent?.tipo).toBe('definizione');
    expect(sent?.fonte).toBe('community');
    expect(sent?.source_reference).toBe('Torrente, Manuale, p.120');
    expect(sent?.source_document_id).toBe(42);
    expect(sent?.skip_duplicate_check).toBe(true);
    expect(sent?.acknowledged_duplicate_of).toBe('concetto:r');
  });

  // sec-contrib-promote-idor: candidate ids are sequential too; promoting
  // someone else's candidate would file their note as the caller's proposal
  // and, by marking it promoted, purge it from the owner's review list.
  it("404s on a candidate from another user's document: nothing proposed, nothing marked", async () => {
    await grantFull(user);
    const other = await createTestUser('contrib-trudy');
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', document_id: 42, verbatim_excerpt: 'raw verbatim text' });
    documentUploadedBy(42, other.id);
    const propose = nock(TEST_MERLT_BASE)
      .post('/api/v1/enrichment/propose-entity')
      .reply(200, { success: true, pending_entity: { id: 'pe-stolen' } });
    const mark = nock(TEST_MERLT_BASE).post('/api/v1/candidates/7/mark-promoted').reply(200, { ok: true });

    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);

    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('candidate_not_found');
    expect(propose.isDone()).toBe(false);
    expect(mark.isDone()).toBe(false);
  });

  it('404s on a candidate whose contributor is someone else, even on an owned document', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).get('/api/v1/candidates/7').reply(200, {
      id: 7,
      candidate_type: 'entity',
      document_id: 42,
      contributor_id: 'someone-else',
      verbatim_excerpt: 'raw verbatim text',
    });
    documentUploadedBy(42, user.id);
    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('candidate_not_found');
  });

  it('404s on a candidate without a document_id (ownership cannot be proved)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', verbatim_excerpt: 'raw verbatim text' });
    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('candidate_not_found');
  });

  it('404s (not 503) when MERL-T does not know the candidate', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).get('/api/v1/candidates/7').reply(404, { detail: 'Candidate not found' });
    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('candidate_not_found');
  });

  it('404s when the candidate document is unknown to MERL-T', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', document_id: 42, verbatim_excerpt: 'raw verbatim text' });
    nock(TEST_MERLT_BASE).get('/api/v1/documents/42').reply(404, { detail: 'Document not found' });
    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('candidate_not_found');
  });

  // B1: note-derived relations used to forward the LLM's concept names, which
  // the consensus writer then MERGEd as phantom :Norma nodes.
  const relationBody = {
    candidateType: 'relation' as const,
    articleUrn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
    sourceUrn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
    targetEntityId: 'concetto:risoluzione_del_contratto',
    tipoRelazione: 'DISCIPLINA',
    descrizione: "L'art. 1453 disciplina la risoluzione per inadempimento.",
    fonte: 'Appunti personali',
    attested: true,
  };

  it('400 unresolved_endpoint on a relation endpoint that is a bare name (no MERL-T call)', async () => {
    await grantFull(user);
    for (const bad of [
      { sourceUrn: 'risoluzione del contratto' },
      { targetEntityId: 'inadempimento' },
      { targetEntityId: 'Concetto:risoluzione' },
      { sourceUrn: 'https://example.com/risoluzione' },
      { targetEntityId: 'concetto: risoluzione del contratto' },
    ]) {
      const res = await request(app)
        .post('/api/merlt/contrib/candidates/7/promote')
        .set(authHeader(user))
        .send({ ...relationBody, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.detail).toBe('unresolved_endpoint');
    }
  });

  it('forwards resolved relation endpoints (URN, Normattiva URL, entity id, pending id)', async () => {
    await grantFull(user);
    const cases: Array<{ sourceUrn: string; targetEntityId: string }> = [
      { sourceUrn: relationBody.sourceUrn, targetEntityId: 'concetto:risoluzione_del_contratto' },
      {
        sourceUrn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262~art1455',
        targetEntityId: 'concetto:1a2b3c4d',
      },
      { sourceUrn: 'principio:buona_fede', targetEntityId: relationBody.sourceUrn },
    ];
    for (const endpoints of cases) {
      let sent: Record<string, unknown> | undefined;
      nock(TEST_MERLT_BASE).get('/api/v1/candidates/9').reply(200, {
        id: 9,
        candidate_type: 'relation',
        document_id: 42,
        verbatim_excerpt: 'estratto originale',
      });
      documentUploadedBy(42, user.id);
      nock(TEST_MERLT_BASE)
        .post('/api/v1/enrichment/propose-relation', (b) => {
          sent = b as Record<string, unknown>;
          return true;
        })
        .reply(200, { success: true, relation_id: 'rel-1' });
      nock(TEST_MERLT_BASE).post('/api/v1/candidates/9/mark-promoted').reply(200, { ok: true });

      const res = await request(app)
        .post('/api/merlt/contrib/candidates/9/promote')
        .set(authHeader(user))
        .send({ ...relationBody, ...endpoints, sourceUrn: `  ${endpoints.sourceUrn} ` });

      expect(res.status, JSON.stringify(endpoints)).toBe(200);
      expect(res.body.pendingId).toBe('rel-1');
      // Trimmed, otherwise verbatim: the resolved identifier is the contract.
      expect(sent?.source_urn).toBe(endpoints.sourceUrn);
      expect(sent?.target_entity_id).toBe(endpoints.targetEntityId);
      expect(sent?.tipo_relazione).toBe('DISCIPLINA');
    }
  });

  it('403s without full consent', async () => {
    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/merlt/internal/extraction-callback', () => {
  it('updates the job with the worker secret, rejects a wrong secret', async () => {
    const owner = await createTestUser('contrib-dora');
    const job = await prisma.merltExtractionJob.create({
      data: { documentId: '42', userId: owner.id, status: 'pending' },
    });

    const bad = await request(app)
      .post('/api/merlt/internal/extraction-callback')
      .set('X-Internal-Secret', 'wrong')
      .send({ bffJobId: job.id, status: 'completed', candidatesCreated: 3 });
    expect(bad.status).toBe(401);

    const ok = await request(app)
      .post('/api/merlt/internal/extraction-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'completed', candidatesCreated: 3 });
    expect(ok.status).toBe(200);

    const updated = await prisma.merltExtractionJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('completed');
    expect(updated?.candidatesCreated).toBe(3);
    expect(updated?.completedAt).not.toBeNull();
  });

  it('accepts the worker payload with explicit null fields (regression: job stuck pending)', async () => {
    // The worker serializes absent fields as explicit null (candidatesCreated/error).
    // The schema must use .nullish() (not .optional()) or the completion callback
    // 400s and the job is stuck 'pending' forever — extraction never shows as done.
    const owner = await createTestUser('contrib-nullcb');
    const job = await prisma.merltExtractionJob.create({
      data: { documentId: '99', userId: owner.id, status: 'pending' },
    });

    const res = await request(app)
      .post('/api/merlt/internal/extraction-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'completed', candidatesCreated: null, error: null });
    expect(res.status).toBe(200);

    const updated = await prisma.merltExtractionJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).not.toBeNull();
  });
});
