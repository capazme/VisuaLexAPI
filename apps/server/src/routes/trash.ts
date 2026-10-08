import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { listTrash, purgeTrashEntry, restoreTrashEntry, trashDossier, trashDossierItems, type DeletedBy } from '../trash/trash';

/**
 * The trash (MCP second round, spec §4.3). Two kinds of route:
 * - moving to the trash, for connected applications only (delegated table,
 *   `content:delete`): the web app keeps its own immediate deletion (S10) —
 *   except for study cards, which the web app moves too (`POST /lingo/cards/trash`);
 * - listing, restoring and emptying, for the user's session only: none of
 *   them is in the delegated table, so a connected application gets 403.
 */
const router = Router();
router.use(authenticate);

const itemsSchema = z.object({ itemIds: z.array(z.string().min(1).max(64)).min(1).max(50) }).strict();
// The entries the user saw in the confirmation dialog: the whole dossier moves only if it still holds exactly these.
const dossierSchema = z.object({ itemIds: z.array(z.string().min(1).max(64)).max(5000) }).strict();
const restoreSchema = z.object({ targetDossierId: z.string().min(1).max(64).optional() }).strict();

/** Who is deleting; only a connected application moves things to the trash. */
function deletedBy(req: Request): DeletedBy {
  if (!req.delegation) throw new AppError(403, 'Il cestino raccoglie solo ciò che eliminano le applicazioni collegate.');
  return { clientId: req.delegation.clientId, clientName: req.delegation.clientName, grantId: req.delegation.grantId };
}

router.post('/dossiers/:id/trash', async (req, res) => {
  const by = deletedBy(req);
  const { itemIds } = dossierSchema.parse(req.body);
  res.json(await trashDossier(req.user!.id, req.params.id, itemIds, by));
});

router.post('/dossiers/:id/trash-items', async (req, res) => {
  const by = deletedBy(req);
  const { itemIds } = itemsSchema.parse(req.body);
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
