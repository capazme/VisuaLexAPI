import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { lingoCardCreateSchema } from '../schemas/lingo/card';

/**
 * Creates a study card as its author's personal draft, with its anchors, in a
 * single nested write (so all of it happens or none of it does).
 *
 * `input` is validated here, and a `ZodError` is left to the error handler
 * (400), like in the controllers. It is `unknown` on purpose: the caller is a
 * route or an MCP tool, and neither may vouch for its own body. The author comes
 * from the session, never from the input, and the state starts at
 * `BOZZA_PERSONALE` whatever the input says (the schema refuses one that tries).
 * When no anchor is marked primary the first one is.
 */
export async function createLingoCard(authorId: string, input: unknown, client: Prisma.TransactionClient = prisma) {
  const card = lingoCardCreateSchema.parse(input);
  const markFirstPrimary = !card.ancore.some((a) => a.isPrimary);

  return client.lingoCard.create({
    data: {
      autoreId: authorId,
      materia: card.materia,
      istituto: card.istituto,
      tipo: card.tipo,
      domanda: card.domanda,
      risposta: card.risposta,
      spiegazione: card.spiegazione,
      ancore: {
        create: card.ancore.map((a, i) => ({
          normaKey: a.normaKey,
          articleId: a.articleId,
          urn: a.urn,
          aknFingerprint: a.aknFingerprint,
          isPrimary: a.isPrimary || (markFirstPrimary && i === 0),
        })),
      },
    },
    include: { ancore: true },
  });
}
