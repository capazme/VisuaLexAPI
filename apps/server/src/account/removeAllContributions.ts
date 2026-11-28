import type { LingoCardStato } from '../lib/db';
import { prisma } from '../lib/prisma';
import { deleteOwnCommentIn, deleteOwnThreadIn } from '../controllers/communityController';
import { maybeSweepCommunity } from '../forum/sweep';
import { removeOwnCommunityCard, withdrawOwnProposal } from '../lingo/removeOwnContributions';

/** What «remove my contributions» did, kind by kind (G-558). */
export type ContributionsRemoved = {
  glosse: { cancellate: number; svuotate: number };
  risposte: { cancellate: number; svuotate: number };
  validazioniForum: number;
  schede: { ritirate: number; cancellate: number; senzaNome: number };
  motivazioni: number;
};

/**
 * Everything the person wrote for others, removed at once before they leave (G-502, G-558), each kind by the rule it
 * already has:
 * - their glosse, then their replies and comments: deleted when nothing of anyone else hangs on them, otherwise
 *   emptied («cancellata dall'autore»), as the author's own delete does (`deleteOwnThreadIn`, `deleteOwnCommentIn`);
 * - the validations they gave in the Forum: withdrawn;
 * - their proposed cards: withdrawn to drafts, which are theirs alone and go with the account;
 * - their validated or under-review cards: deleted when nobody else uses them, otherwise kept without their name
 *   (G-556);
 * - the reasons written with their validation votes: erased, the judgements stay (G-557).
 * Their private work (dossiers, notes, drafts, courses) is not touched: it goes with the account.
 *
 * One transaction, so it is all or nothing. The Community's rows are locked in its order (spec 2026-11-14 §A): the
 * glosse involved, by id, then the replies and comments, by id; the cards after, one by one by id.
 */
export async function removeAllOwnContributions(userId: string): Promise<ContributionsRemoved> {
  await maybeSweepCommunity();
  return prisma.$transaction(async (tx) => {
    const done: ContributionsRemoved = {
      glosse: { cancellate: 0, svuotate: 0 },
      risposte: { cancellate: 0, svuotate: 0 },
      validazioniForum: 0,
      schede: { ritirate: 0, cancellate: 0, senzaNome: 0 },
      motivazioni: 0,
    };

    // The Community, in its lock order: every glossa this will write (the person's own, and those holding a reply of
    // theirs), then every reply and comment of theirs.
    await tx.$queryRaw`SELECT id FROM article_threads
      WHERE (user_id = ${userId} AND deleted_at IS NULL)
         OR id IN (SELECT thread_id FROM article_comments WHERE user_id = ${userId} AND deleted_at IS NULL)
      ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM article_comments WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY id FOR UPDATE`;

    const ownReplies = () => tx.articleComment.count({ where: { userId, deletedAt: null } });
    const repliesBefore = await ownReplies();
    const glosse = await tx.articleThread.findMany({ where: { userId, deletedAt: null }, select: { id: true }, orderBy: { id: 'asc' } });
    for (const { id } of glosse) {
      done.glosse[(await deleteOwnThreadIn(tx, userId, id)) === 'deleted' ? 'cancellate' : 'svuotate'] += 1;
    }
    // A glossa deleted for good took the person's own replies under it: they count as deleted replies.
    done.risposte.cancellate += repliesBefore - (await ownReplies());
    // Read after the glosse: a glossa deleted for good took the person's own replies under it. The newest first, so a
    // reply goes before the comment it answers and that comment can then be deleted rather than emptied.
    const risposte = await tx.articleComment.findMany({
      where: { userId, deletedAt: null }, select: { id: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    for (const { id } of risposte) {
      done.risposte[(await deleteOwnCommentIn(tx, userId, id)) === 'deleted' ? 'cancellate' : 'svuotate'] += 1;
    }
    done.validazioniForum = (await tx.forumValidation.deleteMany({ where: { validatorId: userId } })).count;

    // Locked before the state is read: a vote that decides a proposal meanwhile lands first, and the card is then
    // handled by the state it reached (a validated one by G-556; an archived one is the person's own and stays).
    const cards = await tx.$queryRaw<{ id: string; stato: LingoCardStato }[]>`
      SELECT id, stato FROM lingo_cards
      WHERE autore_id = ${userId} AND stato IN ('PROPOSTA_COMMUNITY', 'VALIDATA', 'DA_RIVEDERE')
      ORDER BY id FOR UPDATE`;
    for (const card of cards) {
      if (card.stato === 'PROPOSTA_COMMUNITY') {
        await withdrawOwnProposal(tx, userId, card.id);
        done.schede.ritirate += 1;
      } else if ((await removeOwnCommunityCard(tx, userId, card.id)).esito === 'cancellata') {
        done.schede.cancellate += 1;
      } else {
        done.schede.senzaNome += 1;
      }
    }
    done.motivazioni = (await tx.lingoValidazioneCard.updateMany({
      where: { utenteId: userId, motivazione: { not: null } }, data: { motivazione: null },
    })).count;
    return done;
  }, { maxWait: 10_000, timeout: 120_000 });
}
