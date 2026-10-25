import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { atMostUnits } from '../utils/utf16Length';
import { citeStoredItem } from '../norms/decisionCitation';
import { isSwitchOn } from '../assistant/switches';
import { EntryHasNoText, TextUnavailable, readEntryText, type EntryText } from '../assistant/entryText';
import { CONTEXT_MAX, QUOTE_MAX, QUOTE_MIN, locateQuote } from '../assistant/locateQuote';
import { ASSISTANT_NOTE_MAX } from '../assistant/notes';

/**
 * D7b, the connected application's side (spec 2026-10-23 §8.4–8.7): an entry's text, as the dossier's reader
 * reads it, and passages proposed on it. In the delegated table: the text under `dossier:text`, the passages
 * under `dossier:write` and `dossier:text`. Nothing here confirms, edits or removes: the user does, from the
 * web app. Behind the `assistant_passages` switch: off, both answer 404.
 */
const router = Router();
router.use('/dossiers/:id/items/:itemId', authenticate);

/** Pages of the text for the model: about this many characters, cut at a line end. */
export const PAGE_SIZE = 20_000;
export const PASSAGES_PER_CALL = 10;
/** Open proposals on one entry: marks with no note, or a note not validated. */
export const OPEN_PER_ENTRY = 30;

const NO_TEXT = 'Questa voce non ha un testo: è una nota.';
const NOT_YET = 'Il testo non è ancora disponibile, riprova tra poco.';
const NOT_IN_FORCE = 'Questa voce mostra un testo non in vigore: le evidenziazioni non si vedrebbero.';

const COLOURS = { giallo: 'yellow', verde: 'green', rosso: 'red', blu: 'blue' } as const;
const COLOUR_WORDS: Record<string, string> = { yellow: 'giallo', green: 'verde', red: 'rosso', blue: 'blu' };

// Plain text, as notes: new lines and tabs, nothing else below U+0020.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

async function requireSwitch() {
  if (!(await isSwitchOn('assistant_passages'))) throw new AppError(404, 'Non disponibile');
}

async function entryOf(req: Request) {
  const { id, itemId } = req.params;
  const dossier = await prisma.dossier.findFirst({ where: { id, userId: req.user!.id }, select: { id: true } });
  if (!dossier) throw new AppError(404, 'Dossier non trovato');
  const item = await prisma.dossierItem.findFirst({ where: { id: itemId, dossierId: dossier.id } });
  if (!item) throw new AppError(404, 'Voce non trovata');
  if (item.itemType !== 'norm' && item.itemType !== 'sentenza') throw new AppError(400, NO_TEXT);
  return item;
}

async function textOf(item: { itemType: string; content: unknown }): Promise<EntryText> {
  try {
    return await readEntryText(item);
  } catch (error) {
    if (error instanceof EntryHasNoText) throw new AppError(400, NO_TEXT);
    if (error instanceof TextUnavailable) throw new AppError(503, NOT_YET);
    throw error;
  }
}

/** The text in pages of about PAGE_SIZE characters, each cut after a line end when there is one. */
export function pages(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + PAGE_SIZE);
    if (end < text.length) {
      const lineEnd = text.lastIndexOf('\n', end - 1);
      if (lineEnd >= at + PAGE_SIZE / 2) end = lineEnd + 1;
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out.length ? out : [''];
}

const partSchema = z.object({ parte: z.coerce.number().int().min(1).max(1000).default(1) });

router.get('/dossiers/:id/items/:itemId/text', async (req, res) => {
  await requireSwitch();
  const { parte } = partSchema.parse({ parte: req.query.parte ?? req.query.part });
  const item = await entryOf(req);
  const text = await textOf(item);
  const all = pages(text.display);
  if (parte > all.length) throw new AppError(400, `Il testo ha ${all.length} ${all.length === 1 ? 'parte' : 'parti'}.`);
  // Only what the model proposed and the user has not taken up: never the user's own marks, a validated or a
  // flagged note, an edit, a comment, or boundaries the user moved (§8.9).
  const open = await prisma.highlight.findMany({
    where: { userId: req.user!.id, dossierItemId: item.id, createdByClientId: { not: null }, OR: [{ noteState: null }, { noteState: 'proposed' }] },
    orderBy: [{ assistantStartOffset: 'asc' }, { createdAt: 'asc' }],
    select: { assistantText: true, color: true, assistantNote: true },
  });
  res.json({
    voce: { id: item.id, tipo: item.itemType, riferimento: citeStoredItem(item.itemType, item.content) },
    in_vigore: text.inForce,
    parte,
    parti: all.length,
    testo: all[parte - 1],
    proposte: open.map((p) => ({ testo: p.assistantText, colore: COLOUR_WORDS[p.color] ?? p.color, nota: p.assistantNote })),
  });
});

const contextSchema = z.string().max(CONTEXT_MAX).optional();
const passagesSchema = z
  .object({
    passaggi: z
      .array(
        z
          .object({
            testo: z.string().min(QUOTE_MIN).max(QUOTE_MAX),
            colore: z.enum(['giallo', 'verde', 'rosso', 'blu']).default('giallo'),
            nota: z
              .string()
              .trim()
              .min(1)
              .refine(...atMostUnits(ASSISTANT_NOTE_MAX))
              .refine((text) => !CONTROL.test(text), 'Caratteri di controllo non ammessi.')
              .optional(),
            prima: contextSchema,
            dopo: contextSchema,
          })
          .strict(),
      )
      .min(1)
      .max(PASSAGES_PER_CALL),
  })
  .strict();

type Outcome = { esito: 'proposto'; id: string; colore: string; nota: boolean } | { esito: 'rifiutato'; motivo: string };

const REFUSED = {
  too_short: 'troppo corto',
  not_found: 'non trovato alla lettera nel testo',
  duplicate: 'già proposto in questo punto',
  full: 'limite di proposte aperte su questa voce raggiunto',
};

router.post('/dossiers/:id/items/:itemId/passages', async (req, res) => {
  await requireSwitch();
  const { passaggi } = passagesSchema.parse(req.body);
  // A proposal is the assistant's by definition: the user's session highlights by itself.
  if (!req.delegation) throw new AppError(403, 'Solo un’applicazione collegata propone passaggi.');
  const item = await entryOf(req);
  const text = await textOf(item);
  // A 400, not a 409: nothing changed under the call, and asking again would not help (P13).
  if (!text.inForce) throw new AppError(400, NOT_IN_FORCE);
  const { clientId, clientName } = req.delegation;

  const outcomes = await prisma.$transaction(async (tx) => {
    // The dossier's lock, as the trash takes it: two calls cannot pass the limit together, and no row is
    // written while the entry goes to the trash (which then finds it gone, or waits and takes it along).
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM dossiers WHERE id = ${item.dossierId} AND user_id = ${req.user!.id} FOR UPDATE`;
    if (locked.length === 0 || (await tx.dossierItem.count({ where: { id: item.id, dossierId: item.dossierId } })) === 0) {
      throw new AppError(404, 'Voce non trovata');
    }
    // The entry's own marks only: the user's highlights are never consulted, so the answer never tells the
    // model what the user marked (§8.9).
    const existing = await tx.highlight.findMany({
      where: { userId: req.user!.id, dossierItemId: item.id, createdByClientId: { not: null } },
      select: { startOffset: true, text: true, noteState: true },
    });
    const taken = new Set(existing.map((h) => `${h.startOffset}:${h.text}`));
    let open = existing.filter((h) => h.noteState !== 'validated').length;
    const result: Outcome[] = [];
    for (const passage of passaggi) {
      const located = locateQuote(text.projection, passage);
      if (!located.found) {
        result.push({
          esito: 'rifiutato',
          motivo: located.reason === 'ambiguous' ? `compare ${located.count} volte: aggiungi "prima" o "dopo"` : REFUSED[located.reason],
        });
        continue;
      }
      const spot = `${located.start}:${located.text}`;
      if (taken.has(spot)) {
        result.push({ esito: 'rifiutato', motivo: REFUSED.duplicate });
        continue;
      }
      if (open >= OPEN_PER_ENTRY) {
        result.push({ esito: 'rifiutato', motivo: REFUSED.full });
        continue;
      }
      const color = COLOURS[passage.colore];
      const row = await tx.highlight.create({
        data: {
          userId: req.user!.id,
          normaKey: text.wireKey,
          // The projection's own slice, never the model's quote (root rule 23).
          text: located.text,
          color,
          startOffset: located.start,
          endOffset: located.start + located.text.length,
          note: passage.nota ?? null,
          createdByClientId: clientId,
          createdByClientName: clientName,
          dossierItemId: item.id,
          assistantText: located.text,
          assistantStartOffset: located.start,
          assistantNote: passage.nota ?? null,
          noteState: passage.nota ? 'proposed' : null,
        },
        select: { id: true },
      });
      taken.add(spot);
      open += 1;
      result.push({ esito: 'proposto', id: row.id, colore: passage.colore, nota: Boolean(passage.nota) });
    }
    return result;
  });

  // Refused passages cost nothing: two points and one of the day's passages each, given back.
  const refused = outcomes.filter((o) => o.esito === 'rifiutato').length;
  res.locals.delegatedRefund = refused * 2;
  res.locals.delegatedCounterRefund = refused;
  res.json({ voce: { id: item.id, riferimento: citeStoredItem(item.itemType, item.content) }, passaggi: outcomes });
});

export default router;
