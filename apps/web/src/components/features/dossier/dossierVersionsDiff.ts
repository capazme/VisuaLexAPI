import { diffWords, type Change } from 'diff';
import type { DossierItem } from '../../../types';
import type { DossierItemApi } from '../../../services/dossierService';
import { shortNorm } from '../../../utils/sources/normLabels';
import { decisionCitationOf, dossierItemFromApi } from './dossierUtils';

/** An entry as a snapshot stores it: the server's row, not the web's `{ type, data }` (`createDossierSnapshot`). */
export interface SnapshotItem {
  id: string;
  itemType: string;
  title: string;
  content: unknown;
  position: number;
}

export type ItemChangeKind = 'entrata' | 'uscita' | 'cambiata';

export interface ItemChange {
  kind: ItemChangeKind;
  id: string;
  /** As the rest of the web names it: «art. 1218 c.c.» for a norm (the row's title is only the act). */
  label: string;
  /** A note that came or went: its text, since every note is titled «Nota». */
  text?: string;
  /** A note whose text changed: the words, with what went and what came. */
  words?: Change[];
}

// The snapshot keeps the server's row: read it as the store does (the star's envelope off, old shapes unwrapped).
const asItem = (row: SnapshotItem): DossierItem =>
  dossierItemFromApi({ id: row.id, item_type: row.itemType, content: row.content, created_at: '' } as DossierItemApi);

function labelOf(item: DossierItem): string {
  if (item.type === 'norma') return shortNorm(item.data);
  if (item.type === 'sentenza') return decisionCitationOf(item.data);
  return 'Nota';
}

/** The difference in words, not only in colour (LC121). */
export const CHANGE_WORDS: Record<ItemChangeKind, string> = { entrata: 'Entrata', uscita: 'Uscita', cambiata: 'Cambiata' };

/**
 * Two snapshots of a dossier, entry by entry, matched by id. The position is left out: a reorder is not a change of
 * the entry. Entries are listed in the newer snapshot's order, then the ones that went.
 */
export function compareSnapshots(from: SnapshotItem[], to: SnapshotItem[]): ItemChange[] {
  const before = new Map(from.map((row) => [row.id, asItem(row)]));
  const after = new Set(to.map((row) => row.id));
  const changes: ItemChange[] = [];
  const told = (kind: ItemChangeKind, item: DossierItem): ItemChange =>
    ({ kind, id: item.id, label: labelOf(item), ...(item.type === 'note' ? { text: item.data } : {}) });
  for (const row of to) {
    const item = asItem(row);
    const old = before.get(row.id);
    if (!old) { changes.push(told('entrata', item)); continue; }
    // The data only: a star (the envelope's `important`) is not a change of the entry.
    if (old.type === item.type && JSON.stringify(old.data) === JSON.stringify(item.data)) continue;
    const words = old.type === 'note' && item.type === 'note' ? diffWords(old.data, item.data) : undefined;
    changes.push({ kind: 'cambiata', id: item.id, label: labelOf(item), words });
  }
  for (const [id, item] of before) if (!after.has(id)) changes.push(told('uscita', item));
  return changes;
}

/** «2 entrate, 1 cambiata»; «Nessuna differenza» when the two match. */
export function changesLine(changes: ItemChange[]): string {
  const plural: Record<ItemChangeKind, [string, string]> = { entrata: ['entrata', 'entrate'], uscita: ['uscita', 'uscite'], cambiata: ['cambiata', 'cambiate'] };
  const parts = (['entrata', 'uscita', 'cambiata'] as const)
    .map((kind) => [kind, changes.filter((c) => c.kind === kind).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${plural[kind][n === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(', ') : 'Nessuna differenza';
}
