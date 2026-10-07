/**
 * A dossier entry of a Forum suggestion, made into the dossier item it stands for. The web sends
 * `{articleRef?, note?, sentenzaRef?, status?}` (dossierSuggestionPayload in the web's
 * dossierUtils). Each item stores what its entry carries: before 2026-10 the whole entry was
 * stored, so a taken norm read `{articleRef: …}`.
 *
 * A proposal is someone else's data, and what a taken entry becomes is cited to its new owner —
 * on the web, in the MCP reads and in the MCP deletion dialog. So every entry is rebuilt from
 * closed values when the proposal is stored and again when it is taken: a norm through
 * `rebuildNormEntry` (a known act type, fixed patterns), a decision through the dossier item
 * schema with its label recomputed (D9). A refusal names the entry, the field and why, in Italian.
 */
import type { Prisma } from '@prisma/client';
import { rebuildDecisionEntry } from '../schemas/decisionItem';
import { rebuildNormEntry } from '../schemas/normEntry';

/** A note in a proposal: as long as a note the notes route takes. */
const MAX_NOTE = 4000;

export interface EntryItem {
  itemType: 'norm' | 'note' | 'sentenza';
  title: string;
  content: Prisma.InputJsonValue;
  position: number;
}

/** An entry as a proposal stores it, rebuilt. */
export type RebuiltEntry =
  | { articleRef: Prisma.InputJsonObject; status?: 'important' }
  | { sentenzaRef: Prisma.InputJsonObject; status?: 'important' }
  | { note: string; status?: 'important' };

export type EntryCheck = { ok: true; entry: RebuiltEntry } | { ok: false; reason: string };

export function rebuildDossierEntry(raw: unknown): EntryCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'Voce non leggibile' };
  const e = raw as { articleRef?: unknown; note?: unknown; sentenzaRef?: unknown; status?: unknown };
  const star = e.status === 'important' ? { status: 'important' as const } : {};
  if (e.sentenzaRef !== undefined && e.sentenzaRef !== null) {
    // The label is recomputed here as on every write (D9): a proposal's copy is the proposer's.
    const rebuilt = rebuildDecisionEntry(e.sentenzaRef);
    if (!rebuilt.ok) return rebuilt;
    const decision = rebuilt.entry;
    return { ok: true, entry: { sentenzaRef: decision as Prisma.InputJsonObject, ...star } };
  }
  if (e.articleRef !== undefined && e.articleRef !== null) {
    const norm = rebuildNormEntry(e.articleRef);
    if (!norm.ok) return { ok: false, reason: norm.reason };
    return { ok: true, entry: { articleRef: norm.entry as unknown as Prisma.InputJsonObject, ...star } };
  }
  if (typeof e.note === 'string') {
    if (e.note.length > MAX_NOTE) return { ok: false, reason: `Nota troppo lunga (al massimo ${MAX_NOTE} caratteri)` };
    return { ok: true, entry: { note: e.note, ...star } };
  }
  return { ok: false, reason: 'Voce senza norma, sentenza o nota' };
}

/**
 * A dossier proposal's payload with every entry rebuilt, or the first refusal: «Voce 3: Tipo di
 * atto non riconosciuto (…)». Title, description and tags pass as the proposal's own fields.
 */
export function rebuildDossierPayload(payload: unknown): { ok: true; payload: Prisma.InputJsonObject } | { ok: false; reason: string } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return { ok: false, reason: 'Proposta di dossier non leggibile' };
  const p = payload as Record<string, unknown>;
  const raw: unknown[] = Array.isArray(p.entries) ? p.entries : [];
  const entries: RebuiltEntry[] = [];
  for (const [index, item] of raw.entries()) {
    const checked = rebuildDossierEntry(item);
    if (!checked.ok) return { ok: false, reason: `Voce ${index + 1}: ${checked.reason}` };
    entries.push(checked.entry);
  }
  return { ok: true, payload: { ...(p as Prisma.InputJsonObject), entries: entries as unknown as Prisma.InputJsonArray } };
}

/** The dossier item a (rebuilt) entry becomes when the proposal is taken. */
export function dossierItemFromEntry(raw: unknown, position: number): { ok: true; item: EntryItem } | { ok: false; reason: string } {
  const checked = rebuildDossierEntry(raw);
  if (!checked.ok) return checked;
  const entry = checked.entry;
  const star = entry.status === 'important' ? { _dossierMeta: { important: true } } : {};
  if ('sentenzaRef' in entry) {
    const decision = entry.sentenzaRef as { etichetta: string };
    return { ok: true, item: { itemType: 'sentenza', title: decision.etichetta, content: { ...entry.sentenzaRef, ...star }, position } };
  }
  if ('articleRef' in entry) {
    const norm = entry.articleRef as { tipo_atto: string };
    return { ok: true, item: { itemType: 'norm', title: norm.tipo_atto.slice(0, 200), content: { ...entry.articleRef, ...star }, position } };
  }
  return { ok: true, item: { itemType: 'note', title: 'Nota', content: entry.note, position } };
}
