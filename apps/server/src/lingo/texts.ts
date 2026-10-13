import { LingoTestoChiave, type LingoTestoVersione, type Prisma } from '@prisma/client';

/**
 * The texts a person must accept (spec decision 22). A text is never edited: an
 * administrator's change is a new version, and what a person accepted, and what
 * a card was proposed under, keep pointing at the version they saw.
 */

/** The key a path names, or null: only the enum's own values (an object lookup would answer `constructor`). */
export const parseTextKey = (raw: string): LingoTestoChiave | null =>
  (Object.values(LingoTestoChiave) as string[]).includes(raw) ? (raw as LingoTestoChiave) : null;

/** The highest version of a text. The migrations write version 1, so one always exists. */
export const currentText = (tx: Prisma.TransactionClient, chiave: LingoTestoChiave): Promise<LingoTestoVersione> =>
  tx.lingoTestoVersione.findFirstOrThrow({ where: { chiave }, orderBy: { versione: 'desc' } });

/** Whether the person accepted exactly this version. */
export async function hasAccepted(tx: Prisma.TransactionClient, userId: string, testoId: string): Promise<boolean> {
  const row = await tx.lingoAccettazioneTesto.findUnique({ where: { utenteId_testoId: { utenteId: userId, testoId } }, select: { id: true } });
  return row !== null;
}

/** A version as `GET /api/lingo/testi/:chiave` and the 409 of a proposal answer it. The text goes out as stored. */
export const serializeText = (text: LingoTestoVersione, accettata: boolean) => ({
  id: text.id,
  chiave: text.chiave,
  versione: text.versione,
  titolo: text.titolo,
  corpo: text.corpo,
  conferma: text.conferma,
  azione: text.azione,
  accettata,
});
