import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { atMostUnits } from '../utils/utf16Length';
import { citeStoredItem } from '../norms/decisionCitation';
import { isSwitchOn } from '../assistant/switches';
import { EntryHasNoText, EntryUnreadable, SourceHasNoText, TextUnavailable, readEntryText, type EntryText } from '../assistant/entryText';
import { CONTEXT_MAX, QUOTE_MAX, QUOTE_MIN, locateQuote } from '../assistant/locateQuote';

/**
 * The connected application's side of an entry's text (D7b, spec 2026-10-23 §8.4–8.7) and of the glosses on its
 * passages (D8): the text as the dossier's reader reads it, and glosses proposed on it, which the user validates,
 * edits, moves or removes from the web app. In the delegated table: the text under `dossier:text`, the glosses
 * under `dossier:write` and `dossier:text`. The text is behind no switch: it is how an application quotes an entry
 * verbatim (G-372), whatever it then writes. The glosses are behind `assistant_glosses` and `assistant_passages` (the
 * web app's side, where the user validates them): either off, that route answers 404.
 * Coloured passages are no longer proposed (D8, the owners on 29 October 2026): that route answers 410, and the
 * proposals already saved stay as they are, on the web app's side (`assistantProposals.ts`).
 */
const router = Router();
router.use('/dossiers/:id/items/:itemId', authenticate);

/** Pages of the text for the model: about this many characters, cut at a line end. */
export const PAGE_SIZE = 20_000;
export const GLOSSES_PER_CALL = 10;
/** A gloss's note, as the model writes it (the user may edit it up to ASSISTANT_NOTE_MAX). */
export const GLOSS_NOTE_MAX = 1500;
/** Open proposals on one entry, glosses and saved marks together: a mark with no note, or a note not validated. */
export const OPEN_PER_ENTRY = 30;

const NO_TEXT = 'Questa voce non ha un testo: è una nota.';
const NOT_YET = 'Il testo non è ancora disponibile, riprova tra poco.';
const NOT_IN_FORCE = 'Questa voce mostra un testo non in vigore: le glosse non si vedrebbero.';
/** The notice agreed for mcp-legal-it 3.0.x (G-386). */
export const UPDATE_NOTES_UNREAD = 'note di aggiornamento non lette: verificare su Normattiva';
export const NO_MORE_PASSAGES =
  'Le evidenziazioni proposte dall’IA non ci sono più: evidenziare è un gesto dell’utente. Un passaggio si spiega con una glossa, dove è attiva.';

// Plain text, as notes: new lines and tabs, nothing else below U+0020.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// Both switches: a gloss written while the web app's side is off is one the user could neither see nor remove.
async function requireSwitches() {
  const [glosses, review] = await Promise.all([isSwitchOn('assistant_glosses'), isSwitchOn('assistant_passages')]);
  if (!glosses || !review) throw new AppError(404, 'Non disponibile');
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
    if (error instanceof EntryUnreadable) throw new AppError(400, 'I dati di questa norma nel dossier sono incompleti: aggiungila di nuovo.');
    if (error instanceof SourceHasNoText) throw new AppError(400, 'La fonte non ha il testo di questa voce: controlla la norma o la sentenza nel dossier.');
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

/** `note_aggiornamento` when there are notes the text does not hold, and `avviso_note` when some could not be read. */
function updateNotesAnswer(notes: EntryText['updateNotes']) {
  if (!notes) return {};
  return {
    ...(notes.notes?.length && !notes.inText ? { note_aggiornamento: notes.notes } : {}),
    ...(notes.unread ? { avviso_note: UPDATE_NOTES_UNREAD } : {}),
  };
}

const partSchema = z.object({ parte: z.coerce.number().int().min(1).max(1000).default(1) });

router.get('/dossiers/:id/items/:itemId/text', async (req, res) => {
  // For a connected application only: the web reads the text through the Python API, under its own quota.
  if (!req.delegation) throw new AppError(403, 'Solo un’applicazione collegata legge il testo da qui.');
  const { parte } = partSchema.parse({ parte: req.query.parte ?? req.query.part });
  const item = await entryOf(req);
  const text = await textOf(item);
  const all = pages(text.display);
  if (parte > all.length) throw new AppError(400, `Il testo ha ${all.length} ${all.length === 1 ? 'parte' : 'parti'}.`);
  // Only the glosses this application proposed and the user has not taken up: never another application's, the
  // user's own marks, a saved coloured proposal, a validated or a flagged note, an edit, a comment, or boundaries
  // the user moved (§8.9).
  const open = await prisma.highlight.findMany({
    where: { userId: req.user!.id, dossierItemId: item.id, createdByClientId: req.delegation.clientId, kind: 'gloss', noteState: 'proposed' },
    orderBy: [{ assistantStartOffset: 'asc' }, { createdAt: 'asc' }],
    select: { assistantText: true, assistantNote: true },
  });
  res.json({
    voce: { id: item.id, tipo: item.itemType, riferimento: citeStoredItem(item.itemType, item.content) },
    in_vigore: text.inForce,
    parte,
    parti: all.length,
    testo: all[parte - 1],
    // The update notes are not the text (G-386): beside it, on every page, unless the text already holds them.
    ...updateNotesAnswer(text.updateNotes),
    // One part of a split article (G-387): said on every page, so the model does not take it for the whole.
    ...(text.partialNotice ? { avviso_testo_parziale: text.partialNotice } : {}),
    glosse: open.map((g) => ({ testo: g.assistantText, nota: g.assistantNote })),
  });
});

// Gone (D8): said in words to an application that still proposes coloured passages. Nothing is read or stored.
router.post('/dossiers/:id/items/:itemId/passages', () => {
  throw new AppError(410, NO_MORE_PASSAGES);
});

const contextSchema = z.string().max(CONTEXT_MAX).optional();
const glossesSchema = z
  .object({
    glosse: z
      .array(
        z
          .object({
            testo: z.string().min(QUOTE_MIN).max(QUOTE_MAX),
            nota: z
              .string()
              .trim()
              .min(1)
              .refine(...atMostUnits(GLOSS_NOTE_MAX))
              .refine((text) => !CONTROL.test(text), 'Caratteri di controllo non ammessi.'),
            prima: contextSchema,
            dopo: contextSchema,
          })
          .strict(),
      )
      .min(1)
      .max(GLOSSES_PER_CALL),
  })
  .strict();

type Outcome = { esito: 'proposta'; id: string } | { esito: 'rifiutata'; motivo: string };

const REFUSED = {
  too_short: 'troppo corto',
  not_found: 'non trovato alla lettera nel testo',
  duplicate: 'già glossato in questo punto',
  full: 'limite di proposte aperte su questa voce raggiunto',
};

router.post('/dossiers/:id/items/:itemId/glosses', async (req, res) => {
  await requireSwitches();
  const { glosse } = glossesSchema.parse(req.body);
  // A gloss here is the assistant's by definition, validated by the user in the web app.
  if (!req.delegation) throw new AppError(403, 'Solo un’applicazione collegata propone glosse.');
  const item = await entryOf(req);
  const text = await textOf(item);
  // A 400, not a 409: nothing changed under the call, and asking again would not help (P13).
  if (!text.inForce) throw new AppError(400, NOT_IN_FORCE);
  const { clientId, clientName } = req.delegation;

  const outcomes = await prisma.$transaction(async (tx) => {
    // The dossier's lock, as the trash takes it: two calls cannot pass the limit together, and no row is
    // written while the entry goes to the trash (which then finds it gone, or waits and takes it along).
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM dossiers WHERE id = ${item.dossierId} AND user_id = ${req.user!.id} FOR UPDATE`;
    const now = locked.length === 0 ? null : await tx.dossierItem.findFirst({ where: { id: item.id, dossierId: item.dossierId }, select: { content: true } });
    if (!now) throw new AppError(404, 'Voce non trovata');
    // The entry changed while its text was read (another version, say): the offsets would point into the old text.
    if (JSON.stringify(now.content) !== JSON.stringify(item.content)) throw new AppError(409, 'La voce è cambiata mentre ne leggevo il testo.');
    // The entry's assistant rows only: the user's highlights are never consulted, so the answer never tells the
    // model what the user marked (§8.9).
    const existing = await tx.highlight.findMany({
      where: { userId: req.user!.id, dossierItemId: item.id, createdByClientId: { not: null } },
      select: { kind: true, createdByClientId: true, assistantStartOffset: true, assistantText: true, noteState: true },
    });
    // A gloss repeats only this application's own gloss, where the model put it, never where the user moved it: the
    // answer must not tell a move, nor what another application glossed. A saved coloured proposal on the same words
    // is another thing, and stays beside it.
    const taken = new Set(
      existing.filter((h) => h.kind === 'gloss' && h.createdByClientId === clientId).map((h) => `${h.assistantStartOffset}:${h.assistantText}`),
    );
    let open = existing.filter((h) => h.noteState !== 'validated').length;
    const result: Outcome[] = [];
    for (const gloss of glosse) {
      const located = locateQuote(text.projection, gloss);
      if (!located.found) {
        result.push({
          esito: 'rifiutata',
          motivo: located.reason === 'ambiguous' ? `compare ${located.count} volte: aggiungi "prima" o "dopo"` : REFUSED[located.reason],
        });
        continue;
      }
      const spot = `${located.start}:${located.text}`;
      if (taken.has(spot)) {
        result.push({ esito: 'rifiutata', motivo: REFUSED.duplicate });
        continue;
      }
      if (open >= OPEN_PER_ENTRY) {
        result.push({ esito: 'rifiutata', motivo: REFUSED.full });
        continue;
      }
      const row = await tx.highlight.create({
        data: {
          userId: req.user!.id,
          normaKey: text.wireKey,
          kind: 'gloss',
          // A gloss has no colour: the coloured mark is the user's gesture.
          color: null,
          // The projection's own slice, never the model's quote (root rule 23).
          text: located.text,
          startOffset: located.start,
          endOffset: located.start + located.text.length,
          note: gloss.nota,
          createdByClientId: clientId,
          createdByClientName: clientName,
          dossierItemId: item.id,
          assistantText: located.text,
          assistantStartOffset: located.start,
          assistantNote: gloss.nota,
          noteState: 'proposed',
        },
        select: { id: true },
      });
      taken.add(spot);
      open += 1;
      result.push({ esito: 'proposta', id: row.id });
    }
    return result;
  });

  // Refused glosses cost nothing: two points and one of the day's passages each, given back.
  const refused = outcomes.filter((o) => o.esito === 'rifiutata').length;
  res.locals.delegatedRefund = refused * 2;
  res.locals.delegatedCounterRefund = refused;
  res.json({ voce: { id: item.id, riferimento: citeStoredItem(item.itemType, item.content) }, glosse: outcomes });
});

export default router;
