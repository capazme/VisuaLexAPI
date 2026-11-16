import { FolderMinus, FolderPlus, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { appStore, useAppStore } from '../../../store/useAppStore';
import type { Dossier, DossierSentenzaData, NormaVisitata } from '../../../types';
import type { MenuItem } from '../../ui/MenuButton';
import { decisionKey, identityOf } from '../../../utils/decisionLinks';
import type { PracticeAct, PracticeDecision } from '../../../utils/practice';
import { dossierItemOrder, layoutDossier } from '../dossier/dossierLayout';
import { dossierContainsDecision, sentenzaFromDecision } from '../dossier/dossierUtils';
import { removeItemsWithUndo } from '../dossier/removeItemsWithUndo';
import { dossierArticleKey } from './practiceDossierItems';
import { useHostDossier } from './readingHost';

/**
 * «Nel dossier» or not (LC55 c4), read from the dossier itself, never stored on the table: a row added here, removed
 * in «Fonti» or by Claude via MCP says so as soon as the store's dossier changes, and the additive re-sync
 * (`resyncDossierPractice`) never takes a row off the table. An article matches by `dossierArticleKey` (whatever copy it
 * came from), a decision by its identity (`decisionKey`).
 */
export function articleItemIds(dossier: Dossier | undefined, norma: NormaVisitata): string[] {
  if (!dossier) return [];
  const key = dossierArticleKey(norma);
  return dossier.items.filter((i) => i.type === 'norma' && dossierArticleKey(i.data) === key).map((i) => i.id);
}

export function decisionItemIds(dossier: Dossier | undefined, entry: PracticeDecision): string[] {
  if (!dossier || !entry.identified) return [];
  const key = decisionKey(identityOf(entry.reference));
  return dossier.items.filter((i) => i.type === 'sentenza' && decisionKey(i.data) === key).map((i) => i.id);
}

/** What a row of a dossier's «Lettura» says and does about the dossier. */
export interface RowDossier {
  inDossier: boolean;
  /** «Aggiungi al dossier»; absent for what cannot be added (a decision never identified). */
  add?: () => void;
  /** «Togli dal dossier»: to the trash, with «Annulla»; the row stays on the table. */
  remove: () => void;
}

function useRowDossier(find: (d: Dossier | undefined) => string[], add: ((dossierId: string) => void) | undefined, removed: string): RowDossier | undefined {
  const host = useHostDossier();
  const ids = useAppStore(useShallow((s) => (host ? find(s.dossiers.find((d) => d.id === host.id)) : [])));
  if (!host) return undefined;
  return {
    inDossier: ids.length > 0,
    ...(add ? { add: () => add(host.id) } : {}),
    remove: () => removeItemsWithUndo(host.id, ids, removed, host.onTrashChanged),
  };
}

/** An article row in a dossier's «Lettura»; undefined in the Corpus. Added as the reader's popover adds it: its own `norma_data`. */
export function useArticleInDossier(norma: NormaVisitata): RowDossier | undefined {
  return useRowDossier(
    (d) => articleItemIds(d, norma),
    (dossierId) => appStore.getState().addToDossier(dossierId, norma, 'norma'),
    'Articolo tolto dal dossier',
  );
}

/** A decision row in a dossier's «Lettura»; undefined in the Corpus. Added as «Salva come dossier» adds it. */
export function useDecisionInDossier(entry: PracticeDecision): RowDossier | undefined {
  return useRowDossier(
    (d) => decisionItemIds(d, entry),
    entry.identified ? (dossierId) => appStore.getState().addToDossier(dossierId, sentenzaFromDecision(
      identityOf(entry.reference),
      { sezione: entry.sezione ?? entry.reference.sezione, tipo: entry.tipo, data_deposito: entry.depositDate },
    ), 'sentenza') : undefined,
    'Sentenza tolta dal dossier',
  );
}

/** The dossier's items for an act's articles on the table: what «Togli dal dossier» on the act sends to the trash. */
export function useActItemIds(act: PracticeAct): { dossier: ReturnType<typeof useHostDossier>; ids: string[] } {
  const dossier = useHostDossier();
  const ids = useAppStore(useShallow((s) => {
    const held = dossier ? s.dossiers.find((d) => d.id === dossier.id) : undefined;
    return held ? act.articles.flatMap((a) => articleItemIds(held, a.norma_data)) : [];
  }));
  return { dossier, ids };
}

/** A row's «⋯» in a dossier's «Lettura», every command with its name: a row of the dossier leaves it (never just the
 *  table, or the re-sync would bring it back); a row on the table only can join it or leave the table. */
export function rowDossierItems(row: RowDossier, removeFromTable: () => void): MenuItem[] {
  if (row.inDossier) return [{ label: 'Togli dal dossier', icon: FolderMinus, danger: true, onSelect: row.remove }];
  return [
    ...(row.add ? [{ label: 'Aggiungi al dossier', icon: FolderPlus, onSelect: row.add }] : []),
    { label: 'Togli dal tavolo', icon: X, danger: true, onSelect: removeFromTable },
  ];
}

/**
 * After an act of the table is dragged (`movedKey`, its act key): the dossier takes that one move, on its own order, as
 * «Fonti» writes it — the act goes after the nearest dossier act before it on the table, or first. Never the table's
 * whole order: the re-sync does not reorder the table, so a reorder made in «Fonti» or by Claude would be overwritten.
 * An act with nothing in the dossier writes nothing.
 */
export function writeActOrder(dossierId: string, practiceId: string, movedKey: string): void {
  const s = appStore.getState();
  const dossier = s.dossiers.find((d) => d.id === dossierId);
  const table = s.practices.find((p) => p.id === practiceId);
  if (!dossier || !table) return;
  const layout = layoutDossier(dossier.items);
  const keys = layout.acts.map((a) => a.key);
  if (!keys.includes(movedKey)) return;
  const onTable = table.acts.map((a) => a.key);
  const after = onTable.slice(0, onTable.indexOf(movedKey)).reverse().find((k) => k !== movedKey && keys.includes(k));
  const rest = keys.filter((k) => k !== movedKey);
  const at = after === undefined ? 0 : rest.indexOf(after) + 1;
  const next = [...rest.slice(0, at), movedKey, ...rest.slice(at)];
  if (next.join('\n') === keys.join('\n')) return;
  s.setDossierItemOrder(dossierId, dossierItemOrder(dossier.items, layout, next));
}

/**
 * «Aggiungi a questo dossier»: the reader's dossier command in a dossier's «Lettura» (LC55), the popover's add on this
 * dossier without asking which, with the popover's toasts.
 */
export function addToThisDossier(
  dossierId: string,
  item: { norma: NormaVisitata } | { sentenza: DossierSentenzaData },
  toast: (message: string, type: 'success' | 'info') => void,
  added = 'Aggiunto',
): void {
  const s = appStore.getState();
  const dossier = s.dossiers.find((d) => d.id === dossierId);
  if (!dossier) return;
  const held = 'norma' in item ? articleItemIds(dossier, item.norma).length > 0 : dossierContainsDecision(dossier, item.sentenza);
  if (held) {
    toast(`Già presente in «${dossier.title}»`, 'info');
    return;
  }
  if ('norma' in item) s.addToDossier(dossierId, item.norma, 'norma');
  else s.addToDossier(dossierId, item.sentenza, 'sentenza');
  toast(`${added} a «${dossier.title}»`, 'success');
}
