/**
 * DecisionPreviewPopup - the hover popup on a decision a text cites (design 2026-10-13 D5): its heading
 * and first lines, or what the source says. The frame is the norm popup's. `DecisionPreviewContent` is
 * its body, shared with the preview a list opens (`DecisionPreviewDialog`).
 */

import { useCallback } from 'react';
import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import type { DecisionReference, FetchDecisionAnswer } from '../../types/decisions';
import { previewLines } from '../../utils/decisionPreview';
import { formatDecisionHeading, formatDecisionShort, notFoundMessage } from '../../utils/decisionLinks';
import { PreviewFrame } from './PreviewFrame';

interface DecisionPreviewPopupProps {
  isVisible: boolean;
  isLoading: boolean;
  error: string | null;
  reference: DecisionReference | null;
  answer: FetchDecisionAnswer | null;
  position: { top: number; left: number };
  onClose: () => void;
  onOpenDecision: (reference: DecisionReference) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

function Body({ reference, answer }: { reference: DecisionReference; answer: FetchDecisionAnswer }) {
  switch (answer.esito) {
    case 'trovata': {
      const lines = previewLines(answer.testo);
      return (
        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{formatDecisionHeading(answer.identita, answer.attributi)}</div>
          <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line max-h-[220px] overflow-y-auto custom-scrollbar">
            {lines ?? <span className="text-slate-400 italic">Testo non disponibile</span>}
          </div>
        </div>
      );
    }
    case 'ambigua':
      return (
        <div className="text-sm text-slate-700 dark:text-slate-300">
          Con questi estremi esistono {answer.candidati.length} decisioni: aprila per scegliere quella citata.
        </div>
      );
    case 'non_trovata':
      return <div className="text-sm text-slate-600 dark:text-slate-400">{notFoundMessage(answer, reference)}</div>;
    case 'fonte_non_raggiungibile':
      return <div className="text-sm text-slate-600 dark:text-slate-400">La fonte non è raggiungibile in questo momento.</div>;
    default:
      return <div className="text-sm text-slate-600 dark:text-slate-400">Impossibile leggere la decisione.</div>;
  }
}

export function DecisionPreviewPopup({
  isVisible, isLoading, error, reference, answer, position, onClose, onOpenDecision, onMouseEnter, onMouseLeave,
}: DecisionPreviewPopupProps) {
  const handleOpen = useCallback(() => {
    if (!reference) return;
    onOpenDecision(reference);
    onClose();
  }, [reference, onOpenDecision, onClose]);

  return (
    <PreviewFrame
      visible={isVisible && Boolean(reference)}
      position={position}
      title={reference ? formatDecisionShort(reference) : null}
      onClose={onClose}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      footer={
        <button
          onClick={handleOpen}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-700 text-white"
        >
          <ExternalLink size={14} />
          Apri accanto
        </button>
      }
    >
      <DecisionPreviewContent isLoading={isLoading} error={error} reference={reference} answer={answer} />
    </PreviewFrame>
  );
}

/** What a preview says while it loads, when the request failed, or the answer (`Body`). */
export function DecisionPreviewContent({ isLoading, error, reference, answer }: {
  isLoading: boolean;
  error: string | null;
  reference: DecisionReference | null;
  answer: FetchDecisionAnswer | null;
}) {
  return (
    <>
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-500 dark:text-slate-400">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Caricamento...</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 py-6 text-red-500 dark:text-red-400 justify-center">
          <AlertCircle size={18} />
          <span className="text-sm">{error}</span>
        </div>
      )}
      {!isLoading && !error && reference && answer && <Body reference={reference} answer={answer} />}
    </>
  );
}
