import { FolderMinus, FolderPlus, Star, X } from 'lucide-react';
import { useContext, useMemo } from 'react';
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
import { ReadingHostContext, useHostDossier } from './readingHost';
import { citedArticleOf } from '../dossier/citedNorm';
import type { CitedNorms } from '../decisions/DecisionReadingSurface';

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
  /** The dossier entry read in the row (LC58): what an application proposed on it (D7b), its notes. */
  itemId?: string;
  /** Starred in the dossier («importante», as «Fonti»'s star). */
  important: boolean;
  /** «Aggiungi al dossier»; absent for what cannot be added (a decision never identified). */
  add?: () => void;
  /** «Togli dal dossier»: to the trash, with «Annulla»; the row stays on the table. */
  remove: () => void;
  /** «Segna come importante» / «Rimuovi da importanti», on the entry read. */
  toggleImportant: () => void;
}

function useRowDossier(find: (d: Dossier | undefined) => string[], add: ((dossierId: string) => void) | undefined, removed: string, added: string): RowDossier | undefined {
  const host = useHostDossier();
  const ids = useAppStore(useShallow((s) => (host ? find(s.dossiers.find((d) => d.id === host.id)) : [])));
  const important = useAppStore((s) => ids.length > 0 && host !== undefined
    && s.dossiers.find((d) => d.id === host.id)?.items.find((i) => i.id === ids[0])?.status === 'important');
  if (!host) return undefined;
  return {
    inDossier: ids.length > 0,
    ...(ids.length > 0 ? { itemId: ids[0] } : {}),
    important,
    ...(add ? { add: () => { add(host.id); host.showToast?.(added, 'success'); } } : {}),
    remove: () => removeItemsWithUndo(host.id, ids, removed, host.onTrashChanged),
    toggleImportant: () => appStore.getState().updateDossierItemStatus(host.id, ids[0], important ? 'unread' : 'important'),
  };
}

/** An article row in a dossier's «Lettura»; undefined in the Corpus. Added as the reader's popover adds it: its own `norma_data`. */
export function useArticleInDossier(norma: NormaVisitata): RowDossier | undefined {
  return useRowDossier(
    (d) => articleItemIds(d, norma),
    (dossierId) => appStore.getState().addToDossier(dossierId, norma, 'norma'),
    'Articolo tolto dalla pratica',
    'Aggiunto alla pratica',
  );
}

/** A decision of the table as a dossier keeps it, as «Salva come dossier» adds it; undefined while never identified. */
export function decisionEntrySentenza(entry: PracticeDecision): DossierSentenzaData | undefined {
  return entry.identified ? sentenzaFromDecision(
    identityOf(entry.reference),
    { sezione: entry.sezione ?? entry.reference.sezione, tipo: entry.tipo, data_deposito: entry.depositDate },
  ) : undefined;
}

/** A decision row in a dossier's «Lettura»; undefined in the Corpus. Added as «Salva come dossier» adds it. */
export function useDecisionInDossier(entry: PracticeDecision): RowDossier | undefined {
  return useRowDossier(
    (d) => decisionItemIds(d, entry),
    entry.identified ? (dossierId) => appStore.getState().addToDossier(dossierId, decisionEntrySentenza(entry)!, 'sentenza') : undefined,
    'Sentenza tolta dalla pratica',
    'Aggiunta alla pratica',
  );
}

/**
 * The dossier entry a window or the phone's reader reads (LC58): an article's or a decision's, or undefined (the Corpus,
 * a text only on the table). The rows have it from their `RowDossier`.
 */
export function useDossierItemId(practiceId: string, read: { norma: NormaVisitata } | { decisionId: string } | undefined): string | undefined {
  const host = useHostDossier();
  return useAppStore((s) => {
    const dossier = host && read ? s.dossiers.find((d) => d.id === host.id) : undefined;
    if (!dossier || !read) return undefined;
    if ('norma' in read) return articleItemIds(dossier, read.norma)[0];
    const entry = s.practices.find((p) => p.id === practiceId)?.decisions.find((d) => d.id === read.decisionId);
    return entry ? decisionItemIds(dossier, entry)[0] : undefined;
  });
}

/**
 * The norms a decision cites, in a dossier's «Lettura» (D7d, LC58), as the dossier's own reader has them: the preview
 * says whether the dossier holds the norm, and a click puts it on the table, revealed or beside the window it came from
 * (`besideId`), never in the dossier: one the dossier does not hold reads «Non nel dossier». Undefined in the Corpus.
 */
export function useTableCitedNorms(besideId: string): CitedNorms | undefined {
  const host = useContext(ReadingHostContext);
  const dossierId = host?.dossier?.id;
  const items = useAppStore((s) => (dossierId ? s.dossiers.find((d) => d.id === dossierId)?.items : undefined));
  return useMemo(() => (host && items ? {
    holds: (citation) => citedArticleOf(items, citation) !== null,
    open: (citation) => host.search({
      act_type: citation.act_type, act_number: citation.act_number || '', date: citation.date || '', article: citation.article,
      version: 'vigente', besideId,
    }),
    elsewhere: 'Apri nella Lettura',
  } : undefined), [host, items, besideId]);
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

/** A row's «⋯» in a dossier's «Lettura», every command with its name: a row of the dossier takes the star or leaves it
 *  (never just the table, or the re-sync would bring it back); a row on the table only can join it or leave the table. */
export function rowDossierItems(row: RowDossier, removeFromTable: () => void): MenuItem[] {
  if (row.inDossier) {
    return [
      { label: row.important ? 'Rimuovi da importanti' : 'Segna come importante', icon: Star, onSelect: row.toggleImportant },
      { label: 'Togli dalla pratica', icon: FolderMinus, danger: true, separatorBefore: true, onSelect: row.remove },
    ];
  }
  return [
    ...(row.add ? [{ label: 'Aggiungi alla pratica', icon: FolderPlus, onSelect: row.add }] : []),
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
