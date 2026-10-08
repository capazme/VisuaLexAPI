import { z } from 'zod';
import { resolveAnchors, type AnchorOutcome } from './anchors';
import { lingoCardCreateSchema, MAX_ANCHORS_PER_CARD, type LingoCardAncoraInput } from '../schemas/lingo/card';

/**
 * Decides cards before anything is written: the anchors, given as references,
 * are resolved and checked against the sources, and each card is either ready
 * for `createLingoCard` or refused with the reason. Shared by the creation of
 * cards and the edit of a draft, so both anchor in the same way.
 */

const anchorReferenceSchema = z
  .object({ riferimento: z.string().trim().min(1).max(200), principale: z.boolean().optional() })
  .strict();
export const cardInputSchema = lingoCardCreateSchema
  .omit({ ancore: true })
  .extend({
    ancore: z
      .array(anchorReferenceSchema)
      .min(1)
      .max(MAX_ANCHORS_PER_CARD)
      .refine((ancore) => ancore.filter((a) => a.principale).length <= 1, { message: 'Al massimo un’ancora principale per scheda.' }),
  })
  .strict();
export type CardInput = z.infer<typeof cardInputSchema>;

export type Planned = { index: number; input: unknown } | { index: number; refused: { detail: string; anchors?: AnchorOutcome[] } };

export interface CardsPlan {
  planned: Planned[];
  /** Every reference that did not anchor, across the cards. */
  failures: Exclude<AnchorOutcome, { outcome: 'anchored' }>[];
  /** Sources down for every reference: nothing could be checked. */
  allTransient: boolean;
}

export async function planCards(cards: CardInput[]): Promise<CardsPlan> {
  const references = [...new Set(cards.flatMap((card) => card.ancore.map((a) => a.riferimento)))];
  const outcomes = new Map<string, AnchorOutcome>((await resolveAnchors(references)).map((o) => [o.reference, o]));
  const failures = [...outcomes.values()].filter((o) => o.outcome !== 'anchored');
  const allTransient = failures.length === outcomes.size && failures.every((o) => o.transient);
  if (allTransient) return { planned: [], failures, allTransient };

  // Every card is decided before the first is written, so a call never stops halfway (code review of PR 5).
  const planned: Planned[] = cards.map((card, index) => {
    const anchors = card.ancore.map((a) => outcomes.get(a.riferimento)!);
    const failed = anchors.filter((a) => a.outcome !== 'anchored');
    if (failed.length > 0) return { index, refused: { detail: 'Un’ancora non è verificabile: la scheda non è stata creata.', anchors: failed } };
    // The URN is the identity (S6): two references to the same article are one anchor, primary if either was.
    const byUrn = new Map<string, LingoCardAncoraInput>();
    card.ancore.forEach((a, i) => {
      const { anchor } = anchors[i] as Extract<AnchorOutcome, { outcome: 'anchored' }>;
      const seen = byUrn.get(anchor.urn);
      byUrn.set(anchor.urn, { ...anchor, isPrimary: Boolean(seen?.isPrimary || a.principale) });
    });
    const { ancore: _references, ...fields } = card;
    const input = { ...fields, ancore: [...byUrn.values()] };
    const valid = lingoCardCreateSchema.safeParse(input);
    if (!valid.success) {
      return { index, refused: { detail: `La scheda non rispetta il formato: ${valid.error.issues[0]?.message ?? 'dati non validi'}.` } };
    }
    return { index, input };
  });
  return { planned, failures, allTransient };
}
