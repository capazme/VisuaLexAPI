/**
 * The content of a dossier item of type `sentenza` (design 2026-10-01 §6): a decision's identity
 * and what the row shows, never its text. Mirrored on the client by `parseSentenzaContent`
 * (apps/web/src/components/features/dossier/dossierUtils.ts): change both together. Imported
 * items and Forum suggestions are untrusted, so unknown keys are refused.
 *
 * `etichetta` is a convenience copy of the decision's citation (source convention §8.3, D9, «A
 * ogni scrittura»): whatever the client sent, every write stores the citation the server
 * recomputes from the identity and the attributes (`norms/decisionCitation.ts`), and the item's
 * `title` follows it. Reading a dossier writes nothing.
 */
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { citeDecision } from '../norms/decisionCitation';

const SEZIONI = ['1', '2', '3', '4', '5', '6', '7', 'L', 'U', 'F'] as const;
const TIPI = ['sentenza', 'ordinanza', 'ordinanza interlocutoria', 'decreto'] as const;

export const decisionItemContentSchema = z
  .object({
    corte: z.enum(['cassazione', 'corte_costituzionale']),
    numero: z.number().int().min(1).max(999_999),
    anno: z.number().int().min(1900),
    archivio: z.enum(['civile', 'penale']).optional(),
    sezione: z.enum(SEZIONI).optional(),
    tipo: z.enum(TIPI).optional(),
    // A real month and day: the citation spells the date, so «2024-13-05» would read differently here and on the web.
    data_deposito: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/).optional(),
    etichetta: z.string().trim().min(1).max(200),
    _dossierMeta: z.object({ important: z.boolean() }).strict().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.anno > new Date().getFullYear()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['anno'], message: "l'anno è nel futuro" });
    }
    if (value.corte === 'cassazione' && !value.archivio) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['archivio'], message: "per la Cassazione serve l'archivio" });
    }
    if (value.corte === 'corte_costituzionale') {
      if (value.anno < 1956) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['anno'], message: 'la Corte costituzionale decide dal 1956' });
      }
      if (value.archivio || value.sezione) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['archivio'], message: 'la Corte costituzionale non ha archivio né sezione' });
      }
    }
  });

export type DecisionItemContent = z.infer<typeof decisionItemContentSchema>;

export function parseDecisionItemContent(content: unknown): DecisionItemContent {
  const parsed = decisionItemContentSchema.safeParse(content);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'voce'}: ${i.message}`).join('; ');
    throw new AppError(400, `Contenuto della sentenza non valido: ${detail}`);
  }
  return withDecisionLabel(parsed.data);
}

/** The content with its `etichetta` recomputed: the copy never drifts from the identity (D9). */
export function withDecisionLabel(content: DecisionItemContent): DecisionItemContent {
  return { ...content, etichetta: citeDecision(content) };
}

export type DecisionRebuild = { ok: true; entry: DecisionItemContent } | { ok: false; reason: string };

/**
 * A decision entry from someone else's data (a published environment, a Forum proposal), rebuilt
 * from closed values: unknown keys refused, `etichetta` recomputed whatever arrives, the dossier
 * star (`_dossierMeta`) left to the caller. An entry without `etichetta`, or with a null one (an
 * older or hand-made environment), is labelled too: the exported schema keeps requiring it for the dossier item
 * routes, so a placeholder stands in for the missing copy before it is parsed, only here.
 */
export function rebuildDecisionEntry(raw: unknown): DecisionRebuild {
  const input = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as { etichetta?: unknown }).etichetta == null
    ? { ...raw, etichetta: '-' }
    : raw;
  const parsed = decisionItemContentSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') || 'voce';
    return { ok: false, reason: `Sentenza non valida (${field}: ${parsed.error.issues[0]?.message ?? 'non accettato'})` };
  }
  const { _dossierMeta: _ignored, ...decision } = withDecisionLabel(parsed.data);
  return { ok: true, entry: decision };
}
