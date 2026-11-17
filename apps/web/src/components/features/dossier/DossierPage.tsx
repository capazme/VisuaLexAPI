import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { useTour } from '../../../hooks/useTour';
import { Toast } from '../../ui/Toast';
import { Button } from '../../ui/Button';
import { DossierListView } from './DossierListView';
import { DossierDetailView } from './DossierDetailView';
import { ImportDossierModal } from './ImportDossierModal';
import { TrashPage } from './TrashPage';
import { useTrash } from './useTrash';
import { useDossierRefresh } from './useDossierRefresh';
import { showSectionOfDossier } from '../../../features/sections/useSection';
import { decodeDossierShare, importReport, importToastType, validateImportedDossier, type ImportCheck } from './dossierUtils';

type ToastState = { message: string; type: 'success' | 'error' | 'info' | 'warning' } | null;

export function DossierPage() {
  const { dossiers, importDossier } = useAppStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [importing, setImporting] = useState<ImportCheck | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const { tryStartTour } = useTour();
  // One trash for the page: its count on the list, a dossier's own entries, the «Cestino».
  const trash = useTrash();

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    setToast({ message, type });
  };

  // selectedDossierId lives in the URL so browser back/forward restores the
  // list vs detail view naturally. `?dossier=<id>` opens detail, absent shows list.
  const selectedDossierId = searchParams.get('dossier');
  // What a connected application changed meanwhile shows without a reload; the trash keeps its own
  // read on coming into view, and joins the poll here.
  useDossierRefresh(selectedDossierId, trash.reload);
  const setSelectedDossierId = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('dossier', id);
    else next.delete('dossier');
    setSearchParams(next);
  };

  useEffect(() => {
    tryStartTour('dossier');
  }, [tryStartTour]);

  // Syncs URL param `?import=` into internal state AND clears the external
  // signal in the same transaction (see CLAUDE.md gotcha #11).
  useEffect(() => {
    const importData = searchParams.get('import');
    if (!importData) return;
    try {
      const decoded = decodeDossierShare(decodeURIComponent(importData));
      // A share link is untrusted: its decision items are checked, and what cannot be imported is listed.
      const check = validateImportedDossier(JSON.parse(decoded));
      if (!check) throw new Error('not a dossier');
      setImporting(check);
    } catch (e) {
      console.error('Failed to parse import data:', e);
      setToast({ message: 'Link di importazione non valido', type: 'error' });
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleConfirmImport = async () => {
    if (!importing) return;
    const { dossier, discarded } = importing;
    setImporting(null);
    const outcome = await importDossier(dossier);
    if (!outcome) {
      showToast('Impossibile importare la pratica: errore server', 'error');
      return;
    }
    setSelectedDossierId(outcome.id);
    const lost = outcome.failed + discarded.length;
    showToast(importReport(outcome.imported, lost), importToastType(outcome.imported, lost));
  };

  const selectedDossier = dossiers.find((d) => d.id === selectedDossierId) ?? null;
  // A pratica asked by its address (LC61): until the pratiche are read it is not looked for, and the list (of the kind
  // the last section remembers, the Forum's study ones on a cold boot) is never drawn in its place.
  const reading = useAppStore((s) => s.isLoadingData || (!s.isDataLoaded && !s.dataError));
  const readError = useAppStore((s) => s.dataError);
  // A dossier opened by its address takes the user to its kind's section (sections spec S7).
  const selectedKind = selectedDossier ? (selectedDossier.kind ?? 'lavoro') : null;
  useEffect(() => {
    if (selectedKind) showSectionOfDossier(selectedKind);
  }, [selectedKind]);
  const showTrash = searchParams.get('trash') === '1';
  const setShowTrash = (on: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (on) next.set('trash', '1'); else next.delete('trash');
    setSearchParams(next);
  };

  return (
    <>
      {showTrash ? (
        <TrashPage trash={trash} onBack={() => setShowTrash(false)} showToast={showToast} />
      ) : selectedDossierId && !selectedDossier ? (
        reading ? (
          <p role="status" className="p-6 text-sm text-slate-600 dark:text-slate-400">Apro la pratica…</p>
        ) : (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-[15px] text-slate-700 dark:text-slate-300">
              {readError ? 'Non riesco a leggere le pratiche: riprova tra poco.' : 'Questa pratica non c’è o non è tua.'}
            </p>
            <Button variant="secondary" onClick={() => setSelectedDossierId(null)}>Vai alle pratiche</Button>
          </div>
        )
      ) : selectedDossier ? (
        <DossierDetailView
          dossier={selectedDossier}
          onBack={() => setSelectedDossierId(null)}
          showToast={showToast}
          trash={trash}
        />
      ) : (
        <DossierListView
          onSelect={(id) => setSelectedDossierId(id)}
          showToast={showToast}
          trashCount={trash.entries?.length ?? 0}
          onOpenTrash={() => setShowTrash(true)}
          onTrashChanged={() => void trash.reload()}
        />
      )}

      {importing && (
        <ImportDossierModal
          dossier={importing.dossier}
          discarded={importing.discarded}
          onClose={() => setImporting(null)}
          onConfirm={handleConfirmImport}
        />
      )}

      <Toast
        message={toast?.message ?? ''}
        type={toast?.type ?? 'info'}
        isVisible={toast !== null}
        onClose={() => setToast(null)}
      />
    </>
  );
}
