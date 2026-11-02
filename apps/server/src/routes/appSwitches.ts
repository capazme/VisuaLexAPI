import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { AppError } from '../middleware/errorHandler';
import { isAppSwitchKey, isSwitchOnCached, listSwitches, setSwitch } from '../assistant/switches';

/**
 * `GET /api/features`, what the web app and the MCP server read: public (it says only which features are
 * on, and the MCP server asks it with no token before a session lists its tools), mounted in `app.ts`
 * before the limiters, so it answers from a few seconds' memory (`isSwitchOnCached`).
 */
export async function features(_req: Request, res: Response) {
  const [assistantPassages, assistantGlosses, lingoCourses, articleParts] = await Promise.all([
    isSwitchOnCached('assistant_passages'),
    isSwitchOnCached('assistant_glosses'),
    isSwitchOnCached('lingo_courses'),
    isSwitchOnCached('article_parts'),
  ]);
  res.json({ assistantPassages, assistantGlosses, lingoCourses, articleParts });
}

/** The administrator's side of the runtime switches (`/admin/switches`, none of it delegated). */
const router = Router();

router.use('/admin/switches', authenticate, requireAdmin);

router.get('/admin/switches', async (_req, res) => {
  res.json({ switches: await listSwitches() });
});

const switchSchema = z.object({ enabled: z.boolean() }).strict();

router.put('/admin/switches/:key', async (req, res) => {
  const { key } = req.params;
  if (!isAppSwitchKey(key)) throw new AppError(404, 'Interruttore non trovato.');
  const { enabled } = switchSchema.parse(req.body);
  res.json(await setSwitch(key, enabled, req.user!.id));
});

export default router;
