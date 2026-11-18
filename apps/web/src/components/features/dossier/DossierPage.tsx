import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { useTour } from '../../../hooks/useTour';
import { Toast } from '../../ui/Toast';
import { Button } from '../../ui/Button';
import { Arrive } from '../../ui/Arrive';
import { Skeleton } from '../../ui/Skeleton';
import { ViewSlide } from '../../layout/ViewSlide';
import { DossierListView } from './DossierListView';
import { DossierDetailView } from './DossierDetailView';
import { ImportDossierModal } from './ImportDossierModal';
import { TrashPage } from './TrashPage';
import { useTrash } from './useTrash';
import { useDossierRefresh } from './useDossierRefresh';
import { showSectionOfDossier } from '../../../features/sections/useSection';
import { decodeDossierShare, importReport, importToastType, validateImportedDossier, type ImportCheck } from './dossierUtils';

type ToastState = { message: string; type: 'success' | 'error' | 'info' | 'warning' } | null;

/** The page's three views, in the order they slide: the list, a dossier opened from it, the trash. */
const VIEWS = ['list', 'detail', 'trash'];

/** A dossier asked by its address, while the dossiers are read: its title and first rows held in place. */
function DossierOpening() {
  return (
    <div className="grid gap-4 p-6">
      <p role="status" className="sr-only">Apro la pratica…</p>
      <Skeleton className="h-9 w-2/3 max-w-md" />
      <Skeleton variant="text" className="w-1/3 max-w-xs" />
      <div className="grid gap-2 pt-2">
        {[0, 1, 2].map((n) => <Skeleton key={n} className="h-14" />)}
      </div>
    </div>
  );
}

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
  const fetchUserData = useAppStore((s) => s.fetchUserData);
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
      {/* The list, a dossier and the trash slide one into the other (LC98); a dossier asked by its address comes in once
          the dossiers are read. */}
      <ViewSlide view={showTrash ? 'trash' : selectedDossierId ? 'detail' : 'list'} order={VIEWS}>
        {showTrash ? (
          <TrashPage trash={trash} onBack={() => setShowTrash(false)} showToast={showToast} />
        ) : selectedDossier || (reading && (selectedDossierId || readError)) ? (
          <Arrive loading={!selectedDossier} placeholder={<DossierOpening />}>
            {selectedDossier && (
              <DossierDetailView
                dossier={selectedDossier}
                onBack={() => setSelectedDossierId(null)}
                showToast={showToast}
                trash={trash}
              />
            )}
          </Arrive>
        ) : selectedDossierId || readError ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-[15px] text-slate-700 dark:text-slate-300">
              {readError ? 'Non riesco a leggere le pratiche: riprova tra poco.' : 'Questa pratica non c’è o non è tua.'}
            </p>
            <div className="flex gap-2">
              {readError && <Button onClick={() => void fetchUserData()}>Riprova</Button>}
              {selectedDossierId && <Button variant="secondary" onClick={() => setSelectedDossierId(null)}>Vai alle pratiche</Button>}
            </div>
          </div>
        ) : (
          <DossierListView
            onSelect={(id) => setSelectedDossierId(id)}
            showToast={showToast}
            trashCount={trash.entries?.length ?? 0}
            onOpenTrash={() => setShowTrash(true)}
            onTrashChanged={() => void trash.reload()}
          />
        )}
      </ViewSlide>

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
