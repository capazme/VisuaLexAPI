import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import { authenticate } from '../../middleware/auth';
import { internalAuth } from '../../middleware/internalAuth';
import { contributionGuard } from '../../services/merlt/contributionGuard';
import { validatePromotionGate } from '../../services/merlt/promotionGate';
import { promoteRequestSchema, extractionCallbackSchema } from '../../schemas/merlt/contrib';
import { createContribClient, ContribClient } from '../../services/merlt/contribClient';
import { MerltClientError } from '../../services/merlt/merltClient';

/**
 * MERL-T contribution layer BFF routes (Slice 2c — "Apprendi dai miei appunti").
 *
 * Mounted at /api/merlt (see routes/merlt/index.ts), per-route middleware (the
 * internal callback skips JWT, like graph.ts).
 *
 *  - POST /contrib/documents/:id/extract        authenticate + contributionGuard
 *  - GET  /contrib/documents/:id/candidates     authenticate + contributionGuard
 *  - GET  /contrib/jobs/:jobId/status           authenticate (owner-scoped)
 *  - POST /contrib/candidates/:id/promote       authenticate + contributionGuard (+ copyright gate)
 *  - POST /internal/extraction-callback         internalAuth
 *
 * Upload (POST /contrib/documents, multipart) is added separately (needs multer).
 */

const router = Router();
const prisma = new PrismaClient();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // mirror MERL-T MAX_UPLOAD_SIZE_MB=50
const ALLOWED_EXT = /\.(pdf|txt|docx)$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_EXT.test(file.originalname)) cb(null, true);
    else cb(new Error('unsupported_file_type'));
  },
});

/** Wrap multer so its errors become clean 400/413 instead of the generic handler. */
function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ detail: 'file_too_large' });
        return;
      }
      res.status(400).json({
        detail: 'invalid_file',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    next();
  });
}

let cachedContribClient: ContribClient | null = null;
function contribClient(): ContribClient {
  if (!cachedContribClient) cachedContribClient = createContribClient();
  return cachedContribClient;
}
export function _resetContribClientForTests(): void {
  cachedContribClient = null;
}

/**
 * POST /api/merlt/contrib/documents (multipart, field `file`)
 * Validates type/size on the BFF, then forwards to MERL-T /documents/upload
 * with the VisuaLex user id (string). Returns the MERL-T document id.
 */
router.post(
  '/contrib/documents',
  authenticate,
  contributionGuard,
  uploadSingle,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ detail: 'file_required' });
      return;
    }
    try {
      const result = await contribClient().uploadDocument({
        file: file.buffer,
        filename: file.originalname,
        contentType: file.mimetype,
        userId: req.user.id,
        documentType: typeof req.body?.documentType === 'string' ? req.body.documentType : undefined,
        legalDomain: typeof req.body?.legalDomain === 'string' ? req.body.legalDomain : undefined,
        title: typeof req.body?.title === 'string' ? req.body.title : undefined,
      });
      res.status(201).json({ documentId: result.document_id, duplicate: result.duplicate });
    } catch (err) {
      if (err instanceof MerltClientError) {
        res.status(503).json({ detail: 'merlt_unavailable' });
        return;
      }
      throw err;
    }
  },
);

/**
 * POST /api/merlt/contrib/documents/:id/extract
 * Create a pending extraction job, best-effort ask MERL-T to enqueue the async
 * extract-to-staging task (threading the job id through). Returns 202.
 */
router.post(
  '/contrib/documents/:id/extract',
  authenticate,
  contributionGuard,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    const documentId = req.params.id;
    const docIdNum = Number.parseInt(documentId, 10);
    if (Number.isNaN(docIdNum)) {
      res.status(400).json({ detail: 'invalid_document_id' });
      return;
    }

    const job = await prisma.merltExtractionJob.create({
      data: { documentId, userId: req.user.id, status: 'pending' },
    });

    // Best-effort enqueue: if MERL-T is down we still keep the job row so the
    // client can poll / retry later (mirrors graph ingest).
    try {
      const { task_id } = await contribClient().extractAsync(docIdNum, req.user.id, job.id);
      await prisma.merltExtractionJob.update({ where: { id: job.id }, data: { taskId: task_id } });
    } catch (err) {
      if (!(err instanceof MerltClientError)) throw err;
    }

    res.status(202).json({ jobId: job.id, status: 'pending' });
  },
);

/**
 * GET /api/merlt/contrib/documents/:id/candidates
 * Proxy to MERL-T, scoped to the current contributor (no IDOR). 503 on outage.
 */
router.get(
  '/contrib/documents/:id/candidates',
  authenticate,
  contributionGuard,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    const docIdNum = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(docIdNum)) {
      res.status(400).json({ detail: 'invalid_document_id' });
      return;
    }
    try {
      const result = await contribClient().listCandidates(docIdNum, req.user.id);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof MerltClientError) {
        res.status(503).json({ detail: 'merlt_unavailable' });
        return;
      }
      throw err;
    }
  },
);

/**
 * GET /api/merlt/contrib/jobs/:jobId/status — owner-scoped (404 otherwise).
 */
router.get(
  '/contrib/jobs/:jobId/status',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    const job = await prisma.merltExtractionJob.findFirst({
      where: { id: req.params.jobId, userId: req.user.id },
    });
    if (!job) {
      res.status(404).json({ detail: 'job_not_found' });
      return;
    }
    res.status(200).json({
      jobId: job.id,
      status: job.status,
      candidatesCreated: job.candidatesCreated,
      error: job.errorMessage,
    });
  },
);

/**
 * GET /api/merlt/contrib/me/jobs
 * The current user's recent extraction jobs — gives the hub a "I miei contributi"
 * surface so a refresh doesn't lose the in-progress flow (ContribPage state is
 * in-memory and was throwing context away on every reload). Owner-scoped.
 */
router.get(
  '/contrib/me/jobs',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    const jobs = await prisma.merltExtractionJob.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        documentId: true,
        status: true,
        candidatesCreated: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
      },
    });
    res.status(200).json({ jobs });
  },
);

/**
 * POST /api/merlt/contrib/candidates/:id/promote
 * Server-side copyright gate (fonte + reformulation + attestation), then create
 * the canonical RLCF proposal. The authoritative verbatim is fetched from
 * MERL-T (the client cannot supply it) and the reformulated text is checked
 * against it. 422 promotion_rejected on a gate failure.
 */
router.post(
  '/contrib/candidates/:id/promote',
  authenticate,
  contributionGuard,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    const parsed = promoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
      return;
    }
    const candidateId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(candidateId)) {
      res.status(400).json({ detail: 'invalid_candidate_id' });
      return;
    }
    const body = parsed.data;

    try {
      const candidate = await contribClient().getCandidate(candidateId);

      const gate = validatePromotionGate({
        fonte: body.fonte,
        reformulatedText: body.descrizione,
        verbatimExcerpt: candidate.verbatim_excerpt ?? '',
        attested: body.attested,
      });
      if (!gate.ok) {
        res.status(422).json({ detail: 'promotion_rejected', reason: gate.reason });
        return;
      }

      const fonte = `utente:${req.user.id}`.slice(0, 50);
      const proposal =
        body.candidateType === 'entity'
          ? await contribClient().proposeEntity({
              // Stand-alone proposals fall back to the staging placeholder so
              // free-text notes without a clear norma still create a proposal.
              article_urn: body.articleUrn?.trim() || 'user_document',
              nome: body.nome,
              tipo: body.tipo,
              descrizione: body.descrizione,
              fonte: body.fonte.slice(0, 50) || fonte,
              contributed_by: req.user.id,
              user_id: req.user.id,
              source_document_id: candidate.id,
            })
          : await contribClient().proposeRelation({
              article_urn: body.articleUrn,
              source_urn: body.sourceUrn,
              target_entity_id: body.targetEntityId,
              tipo_relazione: body.tipoRelazione,
              descrizione: body.descrizione,
              fonte: body.fonte.slice(0, 50) || fonte,
              contributed_by: req.user.id,
              user_id: req.user.id,
              source_document_id: candidate.id,
            });

      await contribClient().markPromoted(candidateId);

      res.status(200).json({ pendingId: proposal.pending_id });
    } catch (err) {
      if (err instanceof MerltClientError) {
        res.status(503).json({ detail: 'merlt_unavailable' });
        return;
      }
      throw err;
    }
  },
);

/**
 * POST /api/merlt/internal/extraction-callback — worker → BFF (internalAuth).
 */
router.post(
  '/internal/extraction-callback',
  internalAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = extractionCallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
      return;
    }
    const { bffJobId, status, candidatesCreated, error } = parsed.data;

    const job = await prisma.merltExtractionJob.findUnique({ where: { id: bffJobId } });
    if (!job) {
      res.status(404).json({ detail: 'job_not_found' });
      return;
    }
    const isTerminal = ['completed', 'failed', 'timeout'].includes(status);
    await prisma.merltExtractionJob.update({
      where: { id: bffJobId },
      data: {
        status,
        candidatesCreated: candidatesCreated ?? undefined,
        errorMessage: error ?? undefined,
        startedAt: status === 'running' ? new Date() : undefined,
        completedAt: isTerminal ? new Date() : undefined,
      },
    });

    res.status(200).json({ updated: true });
  },
);

export default router;
