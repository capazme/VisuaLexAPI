import type { Prisma } from '@prisma/client';

export type CardRow = Prisma.LingoCardGetPayload<{ include: { ancore: true } }>;

/** A card as the routes answer it; the connected application's id never leaves the server. */
export const serialize = (card: CardRow) => ({
  id: card.id,
  materia: card.materia,
  istituto: card.istituto,
  tipo: card.tipo,
  domanda: card.domanda,
  risposta: card.risposta,
  spiegazione: card.spiegazione,
  stato: card.stato,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
  // Which connected application wrote the card; the client's id stays on the server.
  origine: card.createdByClientId ? { clientName: card.createdByClientName } : null,
  ancore: card.ancore.map((a) => ({ normaKey: a.normaKey, articleId: a.articleId, urn: a.urn, isPrimary: a.isPrimary })),
});
