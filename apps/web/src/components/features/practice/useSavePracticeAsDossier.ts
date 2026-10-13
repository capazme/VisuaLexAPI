import { useCallback, useState, useSyncExternalStore } from 'react';
import { appStore } from '../../../store/useAppStore';
import type { ToastProps } from '../../ui/Toast';
import { dossierContainsDecision } from '../dossier/dossierUtils';
import { discardEmptyDossier } from '../dossier/deleteDossierWithUndo';
import { dossierHoldsArticle, practiceDossierItems } from './practiceDossierItems';

export interface SaveNotice {
  message: string;
  type: ToastProps['type'];
}

/** How long a save waits for the server to settle its items before it reports what it sees. */
const SETTLE_TIMEOUT_MS = 60_000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Resolves once none of `tempIds` is pending any more (their add settled, saved or rolled back). */
function settled(tempIds: string[]): Promise<void> {
  const pending = () => tempIds.some((id) => appStore.getState().pendingDossierItemIds[id]);
  if (!pending()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { unsubscribe(); clearTimeout(timer); resolve(); };
    const unsubscribe = appStore.subscribe(() => { if (!pending()) done(); });
    const timer = setTimeout(done, SETTLE_TIMEOUT_MS);
  });
}

// The practices being saved, shared by every place a save starts (the header, the chip): one save
// at a time per practice, or a second click would make a second dossier.
const saving = new Set<string>();
const savingListeners = new Set<() => void>();
const setSaving = (practiceId: string, on: boolean) => {
  if (on) saving.add(practiceId);
  else saving.delete(practiceId);
  savingListeners.forEach((listener) => listener());
};
const subscribeSaving = (listener: () => void) => {
  savingListeners.add(listener);
  return () => { savingListeners.delete(listener); };
};

/** Whether a save of this practice is running, wherever it was started. */
export function usePracticeSaving(practiceId: string): boolean {
  return useSyncExternalStore(subscribeSaving, () => saving.has(practiceId));
}

/**
 * «Salva come dossier» and «Aggiungi a un dossier…» (spec §7). The practice stays as it is.
 *
 * A new dossier (gotcha 17) is created on the server first (`createDossier`: its id, or null with
 * its own sync error), then each item goes through `addToDossier` and the order is written once —
 * the store holds that write until every item has its server id. Nothing is created for a practice
 * with nothing to save. `addToDossier` rolls a refused item back without a word, so the save waits
 * for them to settle and counts what stayed: a dossier left with none of its items is deleted
 * again; one left with some is kept, and the sync error says how many are missing.
 *
 * An existing dossier: what it holds (`dossierHoldsArticle`, `dossierContainsDecision`) is
 * skipped and counted; nothing is reordered. A save of a practice already being saved does nothing.
 */
export function useSavePracticeAsDossier() {
  const [notice, setNotice] = useState<SaveNotice | null>(null);

  const save = useCallback(async (practiceId: string, target: { dossierId: string } | null) => {
    if (saving.has(practiceId)) return;
    setSaving(practiceId, true);
    try {
      await saveOnce(practiceId, target, setNotice);
    } finally {
      setSaving(practiceId, false);
    }
  }, []);

  return {
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    saveAsNew: useCallback((practiceId: string) => save(practiceId, null), [save]),
    addToExisting: useCallback((practiceId: string, dossierId: string) => save(practiceId, { dossierId }), [save]),
  };
}

async function saveOnce(
  practiceId: string,
  target: { dossierId: string } | null,
  setNotice: (notice: SaveNotice | null) => void,
): Promise<void> {
  const practice = appStore.getState().practices.find((p) => p.id === practiceId);
  if (!practice) return;
  const { norms, decisions, unidentified } = practiceDossierItems(practice);
  const unidentifiedText = unidentified > 0
    ? `${plural(unidentified, 'sentenza non identificata non è stata', 'sentenze non identificate non sono state')} salvat${unidentified === 1 ? 'a' : 'e'}`
    : null;

  let dossierId: string;
  let title: string;
  let wantedNorms = norms;
  let wantedDecisions = decisions;
  let already = 0;
  if (target) {
    const dossier = appStore.getState().dossiers.find((d) => d.id === target.dossierId);
    if (!dossier) return;
    dossierId = dossier.id;
    title = dossier.title;
    wantedNorms = norms.filter((n) => !dossierHoldsArticle(dossier, n));
    wantedDecisions = decisions.filter((d) => !dossierContainsDecision(dossier, d));
    already = (norms.length - wantedNorms.length) + (decisions.length - wantedDecisions.length);
  } else {
    title = practice.label;
    dossierId = '';
  }
  const expected = wantedNorms.length + wantedDecisions.length;

  if (expected === 0) {
    const parts = [
      already > 0 ? `${already} già ${already === 1 ? 'presente' : 'presenti'}` : null,
      unidentifiedText,
    ].filter(Boolean);
    const message = target
      ? `Il dossier «${title}» ha già tutto${parts.length ? `: ${parts.join('. ')}` : ''}`
      : `La pratica non ha nulla da salvare${unidentifiedText ? `. ${unidentifiedText}` : '.'}`;
    setNotice({ message, type: 'info' });
    return;
  }

  const store = appStore.getState();
  if (!target) {
    // createDossier shows its own sync error when refused; nothing else was done yet.
    const created = await store.createDossier(title);
    if (!created) return;
    dossierId = created;
  }

  const before = new Set(appStore.getState().dossiers.find((d) => d.id === dossierId)?.items.map((i) => i.id) ?? []);
  for (const n of wantedNorms) appStore.getState().addToDossier(dossierId, n, 'norma');
  for (const d of wantedDecisions) appStore.getState().addToDossier(dossierId, d, 'sentenza');
  const added = (appStore.getState().dossiers.find((d) => d.id === dossierId)?.items ?? []).filter((i) => !before.has(i.id));
  if (!target) appStore.getState().setDossierItemOrder(dossierId, added.map((i) => i.id));

  await settled(added.map((i) => i.id));

  const after = appStore.getState().dossiers.find((d) => d.id === dossierId)?.items.length ?? 0;
  const saved = after - before.size;
  const missing = expected - saved;
  if (missing > 0) {
    if (saved <= 0 && !target) {
      // Nothing made it: no half-made dossier is left behind, nor in the trash (the user deleted nothing).
      void discardEmptyDossier(dossierId);
      appStore.getState().pushSyncError('Impossibile salvare la pratica come dossier: nessun elemento è stato salvato. Riprova.');
    } else {
      appStore.getState().pushSyncError(
        `Dossier «${title}»: ${plural(missing, 'elemento non è stato salvato', 'elementi non sono stati salvati')}. Riprova.`,
      );
      setNotice(saved <= 0
        ? { message: `Nessun elemento è stato salvato nel dossier «${title}»`, type: 'error' }
        : { message: `Salvato solo in parte nel dossier «${title}»`, type: 'warning' });
    }
    return;
  }

  const savedNorms = wantedNorms.length;
  const savedDecisions = wantedDecisions.length;
  const counts = [
    savedNorms > 0 ? plural(savedNorms, 'articolo', 'articoli') : null,
    savedDecisions > 0 ? plural(savedDecisions, 'sentenza', 'sentenze') : null,
  ].filter(Boolean).join(', ');
  const extras = [
    unidentifiedText,
    already > 0 ? `${already} già ${already === 1 ? 'presente' : 'presenti'}` : null,
  ].filter(Boolean);
  setNotice({ message: [`Salvato nel dossier «${title}»: ${counts}`, ...extras].join('. '), type: 'success' });
}
