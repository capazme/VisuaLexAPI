import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { AppError } from '../middleware/errorHandler';
import { isAppSwitchKey, isSwitchOn, listSwitches, setSwitch } from '../assistant/switches';

/**
 * The runtime switches: what the web app and the MCP server read (`GET /features`, public: it says only
 * which features are on, and the MCP server asks it before a session lists its tools, with no token), and the
 * administrator's side (`/admin/switches`, none of it delegated). Mounted before the routers that
 * authenticate every `/api` request they see.
 */
const router = Router();

router.get('/features', async (_req, res) => {
  res.json({ assistantPassages: await isSwitchOn('assistant_passages') });
});

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
