import { useId } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Expand } from './Expand';
import { IconButton } from './IconButton';
import { buttonClassName } from './buttonStyles';
import { CARD_RADIUS, CONTROL_BORDER } from './controlStyles';

interface PDFViewerProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string | null;
  isLoading: boolean;
  className?: string;
}

/**
 * The act's PDF in the page (LC124, L-73): a space that opens in the reading's flow (`Expand`), not a window over it.
 * Esc inside it closes it and the focus goes back to the command (`Expand`); once the focus is inside the browser's own
 * PDF frame, Esc is the frame's. «Scarica» is always there: Safari and Chrome on Android may not draw a PDF in a frame.
 * It opens at the first page: the web does not know the article's page in Normattiva's PDF.
 */
export function PDFViewer({ isOpen, onClose, pdfUrl, isLoading, className }: PDFViewerProps) {
  const headingId = useId();
  return (
    <Expand open={isOpen} onClose={onClose} role="region" aria-labelledby={headingId} className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}>
      <div className="flex items-center gap-2 border-b border-slate-200 py-1 pl-4 pr-1 dark:border-slate-800">
        <h2 id={headingId} className="mr-auto text-base font-semibold text-slate-900 dark:text-slate-50">PDF della norma</h2>
        {pdfUrl && (
          <a href={pdfUrl} download className={buttonClassName('secondary')}>
            <Download size={16} aria-hidden />
            Scarica
          </a>
        )}
        <IconButton onClick={onClose} aria-label="Chiudi il PDF" icon={<X aria-hidden />} />
      </div>
      <div className="flex h-[70vh] items-center justify-center overflow-hidden rounded-b-[8px]">
        {isLoading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <Loader2 size={16} aria-hidden className="animate-spin" />
            Preparo il PDF…
          </p>
        ) : pdfUrl ? (
          <iframe src={pdfUrl} className="h-full w-full border-0" title="PDF della norma" />
        ) : (
          <p className="text-sm text-red-700 dark:text-red-400">Non riesco a caricare il PDF.</p>
        )}
      </div>
    </Expand>
  );
}
