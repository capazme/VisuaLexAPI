import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Download, FileText } from 'lucide-react';
import { Button } from '../../ui/Button';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { useAppStore } from '../../../store/useAppStore';
import { fetchOriginalPdf } from '../../../services/decisionPdfService';
import type { DecisionIdentity, FoundDecision } from '../../../types/decisions';
import { todayInRome } from '../../../utils/dateUtils';
import { decisionKey } from '../../../utils/decisionLinks';
import { hasDecisionText } from '../../../utils/decisionText';
import { decisionPdfModel, writeDecisionPdf } from './decisionPdf';

// A decision's anchors are stored under its key with no article (as the reading surface does).
const NO_ARTICLE = '';

const REVOKE_AFTER_MS = 1000;

/** Saves a blob through a temporary link, then lets the object URL go. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Not at once: a browser that has not started the download yet would find the URL gone.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/**
 * The decision's two downloads, among its actions: a PDF of ours (optionally with the reader's
 * highlights and notes) and, for the Cassazione, the court's own PDF through our route.
 */
export function DecisionDownloads({ answer, identity }: { answer: FoundDecision; identity: DecisionIdentity }) {
  const { annotations, highlights, loadAnnotationsForArticle, loadHighlightsForArticle } = useAppStore(useShallow((s) => ({
    annotations: s.annotations,
    highlights: s.highlights,
    loadAnnotationsForArticle: s.loadAnnotationsForArticle,
    loadHighlightsForArticle: s.loadHighlightsForArticle,
  })));
  const key = decisionKey(identity);
  const [withMarks, setWithMarks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The reading surface loads them; a host without it would otherwise export nothing.
  useEffect(() => {
    if (!withMarks) return;
    loadHighlightsForArticle(key, NO_ARTICLE);
    loadAnnotationsForArticle(key, NO_ARTICLE);
  }, [withMarks, key, loadHighlightsForArticle, loadAnnotationsForArticle]);

  const mine = useMemo(() => ({
    highlights: highlights.filter((h) => h.normaKey === key && h.articleId === NO_ARTICLE),
    notes: annotations.filter((a) => a.normaKey === key && a.articleId === NO_ARTICLE),
  }), [annotations, highlights, key]);

  const downloadOurs = () => {
    setMessage(null);
    try {
      const model = decisionPdfModel(answer, { consultedOn: todayInRome(), annotations: withMarks ? mine : undefined });
      writeDecisionPdf(model).save(model.fileName);
    } catch (error) {
      console.error('the decision PDF could not be written', error);
      setMessage('Download non riuscito: riprova.');
    }
  };

  const downloadOriginal = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fetchOriginalPdf(identity);
      if (result instanceof Blob) {
        saveBlob(result, `${decisionPdfModel(answer, { consultedOn: todayInRome() }).fileName}`);
      } else {
        setMessage(result.esito === 'non_disponibile'
          ? 'Il PDF originale non è disponibile per questa decisione.'
          : 'Download non riuscito: riprova.');
      }
    } catch (error) {
      console.error('the original PDF could not be downloaded', error);
      setMessage('Download non riuscito: riprova.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* A decision found without its text has nothing to print: its PDF would be a heading. */}
      {hasDecisionText(answer.testo) && (
        <>
          <Button variant="secondary" size="sm" icon={<Download size={16} />} className={TOUCH_TARGET_RESPONSIVE} onClick={downloadOurs}>
            Scarica PDF
          </Button>
          <label className={`inline-flex items-center gap-2 px-1 text-sm text-slate-700 dark:text-slate-300 ${TOUCH_TARGET_RESPONSIVE}`}>
            <input type="checkbox" checked={withMarks} onChange={(e) => setWithMarks(e.target.checked)} />
            Con le mie evidenziazioni e note
          </label>
        </>
      )}
      {identity.corte === 'cassazione' && (
        <Button variant="secondary" size="sm" icon={<FileText size={16} />} className={TOUCH_TARGET_RESPONSIVE} disabled={busy} onClick={() => { void downloadOriginal(); }}>
          PDF originale della Corte
        </Button>
      )}
      {message && <p role="alert" className="w-full text-sm text-amber-800 dark:text-amber-200">{message}</p>}
    </>
  );
}
