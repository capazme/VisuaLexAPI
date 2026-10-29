import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { useAppStore } from '../../../../store/useAppStore';
import type { CitazioneLezione } from '../../../../types/corsi';
import { Sheet } from '../../../ui/Sheet';
import { DossierDecisionReader } from '../../dossier/DossierDecisionReader';
import { DossierItemReader } from '../../dossier/DossierItemReader';
import { searchParamsFromNorma } from '../../dossier/dossierUtils';
import { FOCUS_RING, MUTED_TEXT } from '../progress/tokens';
import { citationLabel, decisionOfCitation, normaOfCitation } from './lessonCitations';

interface CitationPanelProps {
  citation: CitazioneLezione;
  desktop: boolean;
  onClose: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * A norm or a decision the lesson cites, read beside the text as a card's anchor is in the review (courses spec §6.5): on
 * a computer a column of its own that scrolls apart, on a phone a sheet. A norm is read by the dossier's article reader,
 * a decision by its own reader; neither is the course dossier's entry, which may be gone: the lesson keeps its copy.
 */
export function CitationPanel({ citation, desktop, onClose, showToast }: CitationPanelProps) {
  const navigate = useNavigate();
  const triggerSearch = useAppStore((s) => s.triggerSearch);
  const norma = useMemo(() => normaOfCitation(citation), [citation]);
  const decision = useMemo(() => decisionOfCitation(citation), [citation]);
  const label = citationLabel(citation);

  let body;
  if (norma) {
    // In the phone's sheet no gear to Impostazioni: the sheet keeps the focus, a dialog over it would fight it.
    body = (
      <DossierItemReader
        norma={norma}
        onOpenOnDashboard={() => {
          navigate('/');
          triggerSearch(searchParamsFromNorma(norma));
        }}
        showToast={showToast}
        meaningsGear={desktop}
      />
    );
  } else if (decision) {
    body = <DossierDecisionReader identity={decision} />;
  } else {
    body = <p className={cn('text-sm', MUTED_TEXT)}>Questa citazione non si può aprire: il riferimento salvato nel percorso è incompleto.</p>;
  }

  if (!desktop) {
    return (
      <Sheet title={label} onClose={onClose} closeOnEscape>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
      </Sheet>
    );
  }
  return (
    <aside
      aria-label={label}
      className="w-[min(28rem,45%)] min-w-0 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi la citazione"
          className={cn(
            'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
            FOCUS_RING,
          )}
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      {body}
    </aside>
  );
}
