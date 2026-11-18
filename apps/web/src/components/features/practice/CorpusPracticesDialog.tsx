import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { appStore, useAppStore } from '../../../store/useAppStore';
import type { Dossier } from '../../../types';
import { decisionKey } from '../../../utils/decisionLinks';
import { corpusPractices, practiceCountLine, practiceCounts, type Practice } from '../../../utils/practice';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { notify } from '../../ui/notifications/notifications';
import { dossierArticleKey, practiceDossierItems } from './practiceDossierItems';
import { savePracticeAsDossier } from './useSavePracticeAsDossier';

/**
 * LC60 (spec «Ricerca e Dossier», §5): the Corpus's practices a browser kept become pratiche, once, by the user's
 * choice. Shown when the store says some wait (`corpusPracticesPending`) and the pratiche were read from the server:
 * a collection with nothing to save, or holding exactly the articles and decisions of a pratica the user has, goes
 * without asking; the others are listed, all ticked. A save moves each ticked one to a new pratica (as «Salva come
 * dossier» did) and takes it off the browser; once all are saved, the rest goes too. A save that fails takes nothing
 * else away and the riquadro stays; a retry adds to the pratica a first try made instead of making a second one.
 */

/** What a collection holds, as a pratica holds it: its article and decision keys. `null` when it has nothing to save. */
function contentKeys(practice: Practice): Set<string> | null {
  const { norms, decisions } = practiceDossierItems(practice);
  if (norms.length + decisions.length === 0) return null;
  return new Set([...norms.map((n) => `n:${dossierArticleKey(n)}`), ...decisions.map((d) => `s:${decisionKey(d)}`)]);
}

/** A pratica's article and decision keys, as the server confirmed them: an item still on its way may yet be refused. */
function dossierKeys(dossier: Dossier, pending: Record<string, true>): Set<string> {
  return new Set(dossier.items.filter((i) => !pending[i.id]).flatMap((i) => {
    if (i.type === 'norma') return [`n:${dossierArticleKey(i.data)}`];
    if (i.type === 'sentenza') return [`s:${decisionKey(i.data)}`];
    return [];
  }));
}

const sameKeys = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

/** The collections the riquadro offers; the others (nothing to save, or a pratica's twin) can go without asking. */
function offeredCollections(practices: Practice[], dossiers: Dossier[], pending: Record<string, true>): { offered: Practice[]; silent: string[] } {
  const known = dossiers.map((d) => dossierKeys(d, pending));
  const offered: Practice[] = [];
  const silent: string[] = [];
  for (const practice of practices) {
    const keys = contentKeys(practice);
    const unidentified = practiceDossierItems(practice).unidentified;
    if (keys === null || (unidentified === 0 && known.some((k) => sameKeys(keys, k)))) silent.push(practice.id);
    else offered.push(practice);
  }
  return { offered, silent };
}

/** The pratica a first, partial try made for a collection: a retry adds to it. Kept for the session. */
const madeFor = new Map<string, string>();

export function CorpusPracticesDialog() {
  const pending = useAppStore((s) => s.corpusPracticesPending);
  const loaded = useAppStore((s) => s.dossiersLoaded);
  const practices = useAppStore(useShallow((s) => (s.corpusPracticesPending ? corpusPractices(s.practices) : [])));
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState<'discard' | 'save' | null>(null);
  const [confirmFrom, setConfirmFrom] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const navigate = useNavigate();

  const offered = useMemo(
    () => (pending && loaded ? offeredCollections(practices, appStore.getState().dossiers, appStore.getState().pendingDossierItemIds).offered : []),
    [pending, loaded, practices],
  );

  // The collections nobody needs to be asked about go at once; with none left to offer, the browser keeps none.
  useEffect(() => {
    if (!pending || !loaded || busy) return;
    const { offered: left, silent } = offeredCollections(corpusPractices(appStore.getState().practices), appStore.getState().dossiers, appStore.getState().pendingDossierItemIds);
    for (const id of silent) appStore.getState().closePractice(id);
    if (left.length === 0) appStore.getState().endCorpusPractices();
  }, [pending, loaded, practices, busy]);

  if (!pending || !loaded || offered.length === 0) return null;

  const ticked = offered.filter((p) => !unticked.has(p.id));
  const toggle = (id: string) => setUnticked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const save = async () => {
    setConfirming(null);
    setBusy(true);
    setFailed(false);
    let allSaved = true;
    const saved: string[] = [];
    for (const practice of ticked) {
      const earlier = madeFor.get(practice.id);
      const target = earlier && appStore.getState().dossiers.some((d) => d.id === earlier) ? { dossierId: earlier } : null;
      const outcome = await savePracticeAsDossier(practice.id, target);
      // The save stops waiting after a while: an item the server has not confirmed yet may still be refused, and the
      // collection is the only copy, so it leaves the browser only once every item is confirmed.
      const { dossiers, pendingDossierItemIds } = appStore.getState();
      const unconfirmed = dossiers.find((d) => d.id === outcome.dossierId)?.items.some((i) => pendingDossierItemIds[i.id]) ?? false;
      if (outcome.ok && !unconfirmed) {
        madeFor.delete(practice.id);
        saved.push(practice.label);
        appStore.getState().closePractice(practice.id);
      } else {
        if (outcome.dossierId) madeFor.set(practice.id, outcome.dossierId);
        allSaved = false;
      }
    }
    setBusy(false);
    // What worked is said (LC61, Papiniano's test of #539), with the way to it.
    if (saved.length > 0) {
      notify({
        type: 'success',
        message: saved.length === 1 ? `Salvata in Pratiche: «${saved[0]}».` : `${saved.length} raccolte salvate in Pratiche.`,
        duration: 6000,
        action: { label: 'Apri Pratiche', onClick: () => navigate('/pratiche') },
      });
    }
    if (allSaved) appStore.getState().endCorpusPractices();
    else setFailed(true);
  };
  const discard = () => {
    setConfirming(null);
    appStore.getState().endCorpusPractices();
  };

  const n = offered.length;
  return (
    <>
      <Modal
        isOpen
        onClose={() => {}}
        closeOnBackdrop={false}
        closeOnEscape={false}
        showCloseButton={false}
        size="md"
        title="Le raccolte della Ricerca diventano pratiche"
        description={`Nella Ricerca avevi ${n} ${n === 1 ? 'raccolta' : 'raccolte'} di norme e sentenze. Le salviamo come pratiche, così le ritrovi in Pratiche.`}
        footer={
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={(event) => { setConfirmFrom(event.currentTarget); setConfirming('discard'); }}>
              Non salvare
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || ticked.length === 0}
              onClick={(event) => {
                if (ticked.length < offered.length) {
                  setConfirmFrom(event.currentTarget);
                  setConfirming('save');
                } else void save();
              }}
            >
              Salva come pratiche
            </Button>
          </>
        }
      >
        <ul className="space-y-1">
          {offered.map((practice) => (
            <li key={practice.id}>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={!unticked.has(practice.id)}
                  disabled={busy}
                  onChange={() => toggle(practice.id)}
                />
                <span className="min-w-0 text-sm text-slate-800 dark:text-slate-100">
                  «{practice.label}»
                  {/* No «atto» here (LC61): in Pratiche «Atti» are the lawyer's own; the articles and decisions say it. */}
                  <span className="text-slate-600 dark:text-slate-400"> · {practiceCountLine({ ...practiceCounts(practice), acts: 0 })}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {failed && (
          <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
            Non sono riuscito a salvare tutto: quelle ancora in elenco restano qui. Riprova.
          </p>
        )}
      </Modal>
      <ConfirmDialog
        open={confirming !== null}
        origin={confirmFrom}
        variant="danger"
        title={confirming === 'discard' ? 'Non salvare le raccolte?' : 'Salvare solo quelle spuntate?'}
        message={confirming === 'discard' ? 'Le raccolte non si potranno recuperare.' : 'Le raccolte non spuntate non si potranno recuperare.'}
        confirmLabel={confirming === 'discard' ? 'Non salvarle' : 'Salva le spuntate'}
        cancelLabel="Torna indietro"
        focusCancel
        onCancel={() => setConfirming(null)}
        onConfirm={() => (confirming === 'discard' ? discard() : void save())}
      />
    </>
  );
}
