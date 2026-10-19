/**
 * The entries of a dossier published to the Forum, rebuilt from closed values: norms through
 * `schemas/normEntry.ts`, decisions through `schemas/decisionItem.ts` (the label recomputed),
 * notes as plain text of at most the length a note in a dossier may have. Whoever takes the
 * dossier has those entries cited to them — on the web, in the MCP reads and in the MCP deletion
 * dialog — so no text the publisher wrote may reach a citation (owner's decisions, 6 and 7
 * October 2026). `utils/publishedContent.ts` decides what a refusal does: on a publication or an
 * update it refuses the operation with an Italian message naming the dossier, the entry and why;
 * on a read it leaves the entry out.
 */
import { MAX_NOTE_LENGTH } from '../controllers/dossierController';
import { rebuildDecisionEntry } from '../schemas/decisionItem';
import { rebuildNormEntry } from '../schemas/normEntry';

type Entry = { id?: unknown; type?: unknown; addedAt?: unknown; data?: unknown; status?: unknown; aboutItemId?: unknown };

/** An entry rebuilt, its id still the one it came with (the caller renumbers it), or why it is refused. */
export type EntryCheck =
  | { ok: true; item: { id?: string; type: 'norma' | 'sentenza' | 'note'; addedAt?: string; status?: 'important'; aboutItemId?: string; data: unknown } }
  | { ok: false; reason: string };

/** The item around its rebuilt data, from closed values too: its id and date when they are strings,
 *  the star (the web's `status: 'important'`, or one that travelled inside the data), a note's
 *  entry when it names one, and nothing else. */
function envelope(item: Entry, type: 'norma' | 'sentenza' | 'note', data: unknown): EntryCheck {
  const meta = typeof item.data === 'object' && item.data !== null ? (item.data as { _dossierMeta?: { important?: unknown } })._dossierMeta : undefined;
  const starred = item.status === 'important' || meta?.important === true;
  return {
    ok: true,
    item: {
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      type,
      ...(typeof item.addedAt === 'string' && item.addedAt.length <= 40 ? { addedAt: item.addedAt } : {}),
      ...(starred ? { status: 'important' as const } : {}),
      ...(type === 'note' && typeof item.aboutItemId === 'string' ? { aboutItemId: item.aboutItemId } : {}),
      data,
    },
  };
}

export function rebuildEntry(entry: unknown): EntryCheck {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return { ok: false, reason: 'voce non leggibile' };
  const item = entry as Entry;
  if (item.type === 'norma') {
    const norm = rebuildNormEntry(item.data);
    return norm.ok ? envelope(item, 'norma', norm.entry) : { ok: false, reason: norm.reason };
  }
  if (item.type === 'sentenza') {
    const decision = rebuildDecisionEntry(item.data);
    return decision.ok ? envelope(item, 'sentenza', decision.entry) : { ok: false, reason: decision.reason };
  }
  if (item.type === 'note') {
    if (typeof item.data !== 'string' || item.data.length > MAX_NOTE_LENGTH || item.data.includes('\u0000')) {
      return { ok: false, reason: `nota non valida (testo di al massimo ${MAX_NOTE_LENGTH} caratteri)` };
    }
    return envelope(item, 'note', item.data);
  }
  return { ok: false, reason: 'tipo di voce sconosciuto' };
}
