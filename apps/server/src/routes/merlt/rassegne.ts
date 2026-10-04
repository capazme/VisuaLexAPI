// apps/server/src/routes/merlt/rassegne.ts
/**
 * GET /api/merlt/rassegne — the Massimario's review paragraphs citing an article (reader panel).
 *
 * Read-only, every authenticated user (the reader's panel, not a graph view), no consent needed
 * (nothing is recorded about the reader). Any MERL-T failure becomes 503 merlt_unavailable: an
 * upstream 401 must never reach the web client's refresh interceptor (same reasoning as
 * opsIngestion.ts).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { createGraphClient } from '../../services/merlt/graphClient';
import { MerltClientError } from '../../services/merlt/merltClient';

const querySchema = z.object({
  urn: z.string().trim().min(1).max(500),
  anno: z.coerce.number().int().min(1900).max(2100).optional(),
  archivio: z.enum(['civile', 'penale']).optional(),
  cursor: z.string().regex(/^\d{1,6}$/).optional(),
});

let client: ReturnType<typeof createGraphClient> | null = null;
function rassegneClient(): ReturnType<typeof createGraphClient> {
  client ??= createGraphClient();
  return client;
}
export function _resetRassegneClientForTests(): void {
  client = null;
}

const router = Router();

router.get('/rassegne', authenticate, async (req: Request, res: Response): Promise<void> => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_query', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(await rassegneClient().rassegneByNorma(parsed.data));
  } catch (err) {
    if (err instanceof MerltClientError) {
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

export default router;
