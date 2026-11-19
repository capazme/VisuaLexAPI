import { diffWords, type Change } from 'diff';

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
  item: SnapshotItem;
  /** A note whose text changed: the words, with what went and what came. */
  words?: Change[];
}

/** The difference in words, not only in colour (LC121). */
export const CHANGE_WORDS: Record<ItemChangeKind, string> = { entrata: 'Entrata', uscita: 'Uscita', cambiata: 'Cambiata' };

/**
 * Two snapshots of a dossier, entry by entry, matched by id. The position is left out: a reorder is not a change of
 * the entry. Entries are listed in the newer snapshot's order, then the ones that went.
 */
export function compareSnapshots(from: SnapshotItem[], to: SnapshotItem[]): ItemChange[] {
  const before = new Map(from.map((item) => [item.id, item]));
  const after = new Set(to.map((item) => item.id));
  const changes: ItemChange[] = [];
  for (const item of to) {
    const old = before.get(item.id);
    if (!old) { changes.push({ kind: 'entrata', item }); continue; }
    if (old.title === item.title && JSON.stringify(old.content) === JSON.stringify(item.content)) continue;
    const words = typeof old.content === 'string' && typeof item.content === 'string' ? diffWords(old.content, item.content) : undefined;
    changes.push({ kind: 'cambiata', item, words });
  }
  for (const item of from) if (!after.has(item.id)) changes.push({ kind: 'uscita', item });
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
