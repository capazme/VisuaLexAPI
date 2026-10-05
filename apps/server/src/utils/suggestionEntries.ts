/**
 * A dossier entry of a Forum suggestion, made into the dossier item it stands for. The web sends
 * `{articleRef?, note?, sentenzaRef?, status?}` (dossierSuggestionPayload in the web's
 * dossierUtils). Each item stores what its entry carries: before 2026-10 the whole entry was
 * stored, so a taken norm read `{articleRef: …}`. Decision entries are untrusted and pass the
 * dossier item schema (design 2026-10-01 §6).
 */
import type { Prisma } from '@prisma/client';
import { decisionItemContentSchema } from '../schemas/decisionItem';

export interface EntryItem {
  itemType: 'norm' | 'note' | 'sentenza';
  title: string;
  content: Prisma.InputJsonValue;
  position: number;
}

export function dossierItemFromEntry(entry: unknown, position: number): EntryItem | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as { articleRef?: unknown; note?: unknown; sentenzaRef?: unknown; status?: unknown };
  const star = e.status === 'important' ? { _dossierMeta: { important: true } } : {};
  if (e.sentenzaRef !== undefined) {
    const parsed = decisionItemContentSchema.safeParse(e.sentenzaRef);
    if (!parsed.success) return null;
    return { itemType: 'sentenza', title: parsed.data.etichetta, content: { ...parsed.data, ...star }, position };
  }
  if (typeof e.articleRef === 'object' && e.articleRef !== null) {
    const norma = e.articleRef as Record<string, unknown>;
    const title = typeof norma.tipo_atto === 'string' && norma.tipo_atto ? norma.tipo_atto.slice(0, 200) : 'Norma';
    return { itemType: 'norm', title, content: { ...norma, ...star } as Prisma.InputJsonValue, position };
  }
  if (typeof e.note === 'string') return { itemType: 'note', title: 'Nota', content: e.note, position };
  return null;
}
