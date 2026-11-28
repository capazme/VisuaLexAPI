import type { LingoCardStato, Prisma } from '../lib/db';
import { AppError } from '../middleware/errorHandler';
import { canTransition } from './cardStates';

/**
 * Removing one's own contributions to Learn before leaving (G-502): a card the community took up, and the reason
 * written with a validation vote.
 */

/** The states in which a card belongs to the community (G-556): validated, or back under review. */
const COMMUNITY_STATES: LingoCardStato[] = ['VALIDATA', 'DA_RIVEDERE'];

export const CARD_KEPT_WITHOUT_NAME = 'Altri studiano questa scheda: resta, senza il tuo nome.';

export type CardRemoval = { esito: 'cancellata' } | { esito: 'senza_nome'; detail: string };

/**
 * G-556: the author removes a validated or under-review card. It is deleted, with what hangs on it, when nobody else
 * uses it: nobody else has it in review, and it is in no course someone else wrote or follows. Otherwise it stays
 * without the author's name, as when the account is deleted, and the answer says so: the rule of the glosse.
 *
 * The card is locked first. A review that starts meanwhile takes a key-share lock on the card (`routes/lingoSrs.ts`),
 * so it waits for this transaction: it was committed before the check, and counts, or it finds the card gone or
 * without an author. The course branch is a defence today: a course's card (`daPercorso`) is never proposed, so it
 * never becomes validated. Locking the course from here would invert the course trash's order (course, modules,
 * cards), so it is not done.
 */
export async function removeOwnCommunityCard(tx: Prisma.TransactionClient, userId: string, cardId: string): Promise<CardRemoval> {
  const locked = await tx.$queryRaw<{ stato: LingoCardStato; modulo_id: string | null }[]>`
    SELECT stato, modulo_id FROM lingo_cards WHERE id = ${cardId} AND autore_id = ${userId} FOR UPDATE`;
  if (locked.length !== 1) throw new AppError(404, 'Scheda non trovata.');
  if (!COMMUNITY_STATES.includes(locked[0].stato)) {
    throw new AppError(409, 'Così si toglie una scheda validata o da rivedere: una bozza va nel cestino, una proposta si ritira.');
  }
  const [{ used }] = await tx.$queryRaw<{ used: boolean }[]>`
    SELECT (
      EXISTS (SELECT 1 FROM lingo_stato_ripasso WHERE card_id = ${cardId} AND utente_id <> ${userId})
      OR EXISTS (SELECT 1 FROM lingo_revisioni_srs WHERE card_id = ${cardId} AND utente_id <> ${userId})
      OR EXISTS (
        SELECT 1 FROM lingo_corsi_moduli m JOIN lingo_corsi c ON c.id = m.corso_id
        WHERE m.id = ${locked[0].modulo_id}
          AND (c.autore_id <> ${userId}
               OR EXISTS (SELECT 1 FROM lingo_corsi_iscrizioni i WHERE i.corso_id = c.id AND i.utente_id <> ${userId}))
      )
    ) AS used`;
  if (used) {
    await tx.lingoCard.update({ where: { id: cardId }, data: { autoreId: null } });
    return { esito: 'senza_nome', detail: CARD_KEPT_WITHOUT_NAME };
  }
  await tx.lingoCard.delete({ where: { id: cardId } });
  return { esito: 'cancellata' };
}

/**
 * G-557: the validator erases the reason they wrote with their vote. The judgement stays: it counted for the card's
 * state. Returns false when the person gave no vote on that card.
 */
export async function eraseOwnVoteReason(tx: Prisma.TransactionClient, userId: string, cardId: string): Promise<boolean> {
  const { count } = await tx.lingoValidazioneCard.updateMany({ where: { cardId, utenteId: userId }, data: { motivazione: null } });
  return count > 0;
}

/**
 * The author withdraws a proposed card: back to a draft at any time, its votes deleted and its accepted notice
 * cleared (`POST /api/lingo/cards/:id/ritira`, and the account's «remove my contributions», G-558).
 */
export async function withdrawOwnProposal(tx: Prisma.TransactionClient, userId: string, cardId: string) {
  // Locked like a vote's: a vote that comes in at this moment either lands before (and is deleted here) or finds a draft.
  const locked = await tx.$queryRaw<{ stato: LingoCardStato }[]>`SELECT stato FROM lingo_cards WHERE id = ${cardId} AND autore_id = ${userId} FOR UPDATE`;
  if (locked.length !== 1) throw new AppError(404, 'Scheda non trovata.');
  if (!canTransition(locked[0].stato, 'BOZZA_PERSONALE')) {
    throw new AppError(409, 'Solo una scheda in attesa di validazione si può ritirare.');
  }
  // The votes belong to the proposal being withdrawn: a new proposal starts from none.
  await tx.lingoValidazioneCard.deleteMany({ where: { cardId } });
  return tx.lingoCard.update({
    where: { id: cardId },
    data: { stato: 'BOZZA_PERSONALE', propostaTestoId: null },
    include: { ancore: true },
  });
}
