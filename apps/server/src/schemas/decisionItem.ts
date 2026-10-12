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
import { EU_CASE, EU_COURTS, EU_FIRST_YEAR, EU_MAX_NUMERO, EU_SECTION, isEuCourt } from '../norms/euCourts';
import { ADMIN_COURTS, ADMIN_FIRST_YEAR, ADMIN_MAX_NUMERO, ADMIN_SECTION, PROVVEDIMENTO, isAdminCourt, isSeat, kindFamily } from '../norms/adminCourts';

const SEZIONI = new Set(['1', '2', '3', '4', '5', '6', '7', 'L', 'U', 'F']);
const ISO_DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const TIPI = ['sentenza', 'ordinanza', 'ordinanza interlocutoria', 'decreto'] as const;

export const decisionItemContentSchema = z
  .object({
    corte: z.enum(['cassazione', 'corte_costituzionale', ...EU_COURTS, ...ADMIN_COURTS]),
    numero: z.number().int().min(1).max(999_999),
    anno: z.number().int().min(1900),
    archivio: z.enum(['civile', 'penale']).optional(),
    // the Cassazione's codes, or the formation of a court of the Union (checked per court below)
    sezione: z.string().max(20).optional(),
    tipo: z.enum(TIPI).optional(),
    // A real month and day: the citation spells the date, so «2024-13-05» would read differently here and on the web.
    data_deposito: z.string().regex(ISO_DAY).optional(),
    // The courts of the Union: the day the judgment was delivered, and the joined cases.
    data_decisione: z.string().regex(ISO_DAY).optional(),
    cause_riunite: z.array(z.string().regex(EU_CASE)).min(2).max(30).optional(),
    // The administrative courts: a TAR's seat, and the kind of measure (part of the key).
    sede: z.string().max(40).optional(),
    provvedimento: z.string().regex(PROVVEDIMENTO).optional(),
    // room for a judgment of the Union on up to 30 joined cases, named one by one
    etichetta: z.string().trim().min(1).max(600),
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
    const sectionOk = (sezione: string) => (isEuCourt(value.corte) ? EU_SECTION.test(sezione)
      : isAdminCourt(value.corte) ? ADMIN_SECTION.test(sezione) : SEZIONI.has(sezione));
    if (value.sezione !== undefined && !sectionOk(value.sezione)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sezione'], message: 'sezione non valida' });
    }
    if (!isEuCourt(value.corte) && (value.data_decisione !== undefined || value.cause_riunite !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['corte'], message: 'data della decisione e cause riunite solo per le corti UE' });
    }
    if (isAdminCourt(value.corte)) {
      if (value.archivio) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['archivio'], message: 'le corti amministrative non hanno archivio' });
      }
      if (!value.provvedimento) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['provvedimento'], message: 'serve il tipo di provvedimento' });
      }
      if ((value.corte === 'tar') !== (value.sede !== undefined) || (value.sede !== undefined && !isSeat(value.sede))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sede'], message: 'la sede serve solo a un TAR, ed è una delle 29' });
      }
      // `tipo` is the kind's family, or absent: never a sentenza's word on an ordinanza's key
      if (value.tipo !== undefined && value.tipo !== kindFamily(value.provvedimento)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tipo'], message: 'il tipo non è quello del provvedimento' });
      }
      if (value.numero > ADMIN_MAX_NUMERO) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numero'], message: `numero da 1 a ${ADMIN_MAX_NUMERO}` });
      }
      if (value.anno < ADMIN_FIRST_YEAR) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['anno'], message: `anno dal ${ADMIN_FIRST_YEAR}` });
      }
    } else if (value.sede !== undefined || value.provvedimento !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sede'], message: 'sede e tipo di provvedimento solo per le corti amministrative' });
    }
    if (isEuCourt(value.corte)) {
      if (value.archivio || value.data_deposito !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['archivio'], message: 'le corti UE non hanno archivio né deposito' });
      }
      if (value.numero > EU_MAX_NUMERO) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numero'], message: `numero di causa da 1 a ${EU_MAX_NUMERO}` });
      }
      if (value.anno < EU_FIRST_YEAR[value.corte]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['anno'], message: `anno della causa dal ${EU_FIRST_YEAR[value.corte]}` });
      }
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
