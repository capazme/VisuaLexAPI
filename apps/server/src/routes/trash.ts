import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { BY_THE_USER, listTrash, purgeTrashEntry, restoreTrashEntry, trashDossier, trashDossierItems, type DeletedBy } from '../trash/trash';

/**
 * The trash (MCP second round, spec §4.3). Two kinds of route:
 * - moving to the trash: `POST /dossiers/:id/trash` (a whole dossier, with the
 *   entries seen) for connected applications only (delegated table,
 *   `content:delete`); `POST /dossiers/:id/trash-items` for them and for the web
 *   app's session too, which moves the entries the user removes (S10, as amended
 *   on 13 October 2026, question 181). The web app moves a whole dossier through
 *   its own `DELETE /dossiers/:id`, one entry through `DELETE /dossiers/:id/items/:itemId`
 *   and study cards through `POST /lingo/cards/trash`;
 * - listing, restoring and emptying, for the user's session only: none of
 *   them is in the delegated table, so a connected application gets 403.
 */
const router = Router();
router.use(authenticate);

// A connected application moves 1 to 50 entries a call; the user's own selection in the web app has no such cap
// («Seleziona tutto» on a long dossier is still one action, one trash entry).
const itemsSchema = z.object({ itemIds: z.array(z.string().min(1).max(64)).min(1).max(50) }).strict();
const ownItemsSchema = z.object({ itemIds: z.array(z.string().min(1).max(64)).min(1).max(5000) }).strict();
// The entries the user saw in the confirmation dialog, and the number of planner tasks it told them: the whole
// dossier moves only if it still holds exactly these.
const dossierSchema = z
  .object({ itemIds: z.array(z.string().min(1).max(64)).max(5000), taskCount: z.number().int().min(0).max(1_000_000) })
  .strict();
const restoreSchema = z.object({ targetDossierId: z.string().min(1).max(64).optional() }).strict();

/** Who is deleting: the connected application of an exchanged token, else the user's own session. */
function deletedBy(req: Request): DeletedBy {
  if (!req.delegation) return BY_THE_USER;
  return { clientId: req.delegation.clientId, clientName: req.delegation.clientName, grantId: req.delegation.grantId };
}

/** The whole-dossier move keeps the seen-ids check, which only a connected application sends: a session uses `DELETE /dossiers/:id`. */
function connectedApplication(req: Request): DeletedBy {
  if (!req.delegation) throw new AppError(403, 'Queste rotte sono per le applicazioni collegate.');
  return deletedBy(req);
}

router.post('/dossiers/:id/trash', async (req, res) => {
  const by = connectedApplication(req);
  const { itemIds, taskCount } = dossierSchema.parse(req.body);
  res.json(await trashDossier(req.user!.id, req.params.id, { itemIds, taskCount }, by));
});

router.post('/dossiers/:id/trash-items', async (req, res) => {
  const by = deletedBy(req);
  const { itemIds } = (req.delegation ? itemsSchema : ownItemsSchema).parse(req.body);
  res.json(await trashDossierItems(req.user!.id, req.params.id, itemIds, by));
});

router.get('/trash', async (req, res) => {
  res.json(await listTrash(req.user!.id));
});

router.post('/trash/:id/restore', async (req, res) => {
  const { targetDossierId } = restoreSchema.parse(req.body ?? {});
  res.json(await restoreTrashEntry(req.user!.id, req.params.id, targetDossierId));
});

router.delete('/trash/:id', async (req, res) => {
  await purgeTrashEntry(req.user!.id, req.params.id);
  res.status(204).end();
});

export default router;
