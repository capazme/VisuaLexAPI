import { useState } from 'react';
import { BrainCircuit, Download, FileText, SlidersHorizontal, Trash2, UserX } from 'lucide-react';
import { WireConfirm } from '../../../components/ui/wireConfirm/WireConfirm';
import { Modal } from '../../../components/ui/Modal';
import { TextParagraphs } from '../../../components/features/studia/TextParagraphs';
import { deleteMerltData, exportMerltData } from '../../../services/merltService';
import { saveBlob } from '../../../utils/saveBlob';
import { cn } from '../../../lib/utils';
import { isMerltEnabled } from '../featureFlag';
import { useConsentIfProvided } from '../consent/useConsent';
import { ConsentDialog } from '../consent/ConsentDialog';
import { RevokeConsentDialog } from '../consent/RevokeConsentDialog';
import { LEVEL_LABEL } from '../consent/levels';

/**
 * Impostazioni › Dati MERL-T: the consent and the person's rights over what MERL-T collected —
 * change the level, read the notice, download a copy, erase it, revoke (spec
 * docs/superpowers/specs/2026-10-13-merlt-data-protection-design.md). Shown only where MERL-T is on.
 */

const ROW =
  'w-full inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 disabled:opacity-50 md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

export function MerltDataSection() {
  const context = useConsentIfProvided();
  const [changeOpen, setChangeOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  // The button the erasure's confirmation is drawn from (K1b).
  const [eraseFrom, setEraseFrom] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!isMerltEnabled() || !context) return null;
  const { status, level, needsAnswer, notice, consent } = context;

  const statusLine =
    status !== 'ready'
      ? status === 'error'
        ? 'Non riesco a leggere la tua scelta: riprova più tardi.'
        : 'Caricamento…'
      : needsAnswer
        ? 'In pausa: l’informativa è cambiata e aspetta la tua risposta. Finché non rispondi, MERL-T non raccoglie nulla.'
        : level === 'none'
          ? 'Nessuna raccolta: MERL-T non riceve nulla della tua attività.'
          : `Raccolta: ${LEVEL_LABEL[level]}.`;

  const handleExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await exportMerltData();
      saveBlob(blob, `visualex-dati-merlt-${new Date().toISOString().slice(0, 10)}.json`);
      setMessage('Copia dei dati MERL-T scaricata.');
    } catch {
      setMessage('MERL-T non è raggiungibile in questo momento: riprova più tardi.');
    } finally {
      setBusy(false);
    }
  };

  /** The erasure; the button says «Eliminati» with its tick once MERL-T confirmed it. */
  const handleErase = async (): Promise<string | null> => {
    setEraseOpen(false);
    setBusy(true);
    setMessage(null);
    try {
      const { completed } = await deleteMerltData();
      setMessage(
        completed
          ? 'Dati MERL-T eliminati.'
          : 'Eliminazione avviata: MERL-T non ha ancora confermato, si completa da sola appena risponde.',
      );
      return completed ? 'Eliminati' : null;
    } catch {
      setMessage('L’eliminazione non è riuscita: riprova.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-1.5">
        <BrainCircuit size={12} aria-hidden /> Dati MERL-T
      </label>
      <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-xs text-slate-500">
          MERL-T impara da come usi VisuaLex solo se acconsenti. Qui puoi cambiare scelta, leggere l’informativa,
          scaricare o eliminare i dati raccolti.
        </p>
        <p data-testid="merlt-consent-status" className="text-sm text-slate-700 dark:text-slate-200">
          {statusLine}
        </p>
        {status === 'ready' && notice && consent && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => { setMessage(null); setChangeOpen(true); }}
              className={cn(ROW, 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700')}
            >
              <SlidersHorizontal size={16} aria-hidden /> Cambia scelta
            </button>
            <button
              type="button"
              onClick={() => setNoticeOpen(true)}
              className={cn(ROW, 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700')}
            >
              <FileText size={16} aria-hidden /> Leggi l’informativa
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={busy}
              className={cn(ROW, 'bg-blue-50 text-blue-700 hover:bg-blue-100 sm:col-span-2 dark:bg-blue-950/30 dark:text-blue-300')}
            >
              <Download size={16} aria-hidden /> Scarica i miei dati
            </button>
            <button
              type="button"
              onClick={(event) => { setMessage(null); setEraseFrom(event.currentTarget); setEraseOpen(true); }}
              disabled={busy}
              className={cn(ROW, 'bg-red-50 text-red-700 hover:bg-red-100 sm:col-span-2 dark:bg-red-950/30 dark:text-red-300')}
            >
              <Trash2 size={16} aria-hidden /> Elimina i miei dati MERL-T
            </button>
            {consent.storedLevel !== 'none' && (
              <button
                type="button"
                onClick={() => { setMessage(null); setRevokeOpen(true); }}
                disabled={busy}
                className={cn(ROW, 'bg-red-50 text-red-700 hover:bg-red-100 sm:col-span-2 dark:bg-red-950/30 dark:text-red-300')}
              >
                <UserX size={16} aria-hidden /> Revoca il consenso
              </button>
            )}
          </div>
        )}
        {message && (
          <p role="status" className="text-xs text-slate-500">
            {message}
          </p>
        )}
      </div>

      <ConsentDialog open={changeOpen} onClose={() => setChangeOpen(false)} />
      <RevokeConsentDialog open={revokeOpen} onClose={() => setRevokeOpen(false)} onDone={setMessage} />
      {/* Cannot be undone: drawn from its button (K1b). */}
      <WireConfirm
        open={eraseOpen}
        variant="danger"
        title="Eliminare i tuoi dati MERL-T?"
        message="Eliminiamo tutto quello che MERL-T ha raccolto su di te. I contributi già approvati dalla comunità restano, senza più alcun legame con te. La tua scelta sul consenso resta com’è: per fermare la raccolta, revocalo."
        confirmLabel="Elimina i dati"
        onConfirm={handleErase}
        onCancel={() => setEraseOpen(false)}
        origin={eraseFrom}
      />
      {notice && (
        <Modal isOpen={noticeOpen} onClose={() => setNoticeOpen(false)} title={notice.titolo} size="lg">
          <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <p className="text-xs font-bold uppercase text-slate-500">Versione {notice.versione}</p>
            <TextParagraphs body={notice.corpo} />
          </div>
        </Modal>
      )}
    </div>
  );
}
