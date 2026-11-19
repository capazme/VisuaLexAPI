import { useId, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Expand } from '../../ui/Expand';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import type { SentenzaItem } from './dossierLayout';
import { decisionCitationOf } from './dossierUtils';

/** What the reader chose on the export screen. */
export interface DossierPdfOptions {
  /** «Solo le parti evidenziate e annotate» instead of the full texts. */
  excerpts: boolean;
  /** The decisions to print, as item ids. */
  decisionIds: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The dossier's decisions, in stored order; the «Sentenze» section is drawn only when there are some. */
  decisions: SentenzaItem[];
  /** Set while the PDF is being prepared. */
  progress: { done: number; total: number } | null;
  onExport: (options: DossierPdfOptions) => void;
  className?: string;
}

const RADIO = 'h-4 w-4 shrink-0 accent-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const OPTION = `flex items-start gap-2 rounded text-sm text-slate-700 dark:text-slate-300 ${TOUCH_TARGET_RESPONSIVE}`;

/**
 * «Esporta → PDF»: what to print (the full texts or only the marked passages) and which decisions
 * go in. It only asks; `DossierDetailView` loads the texts and writes the file. In the page (LC125, L-73): a space
 * under the header's «Esporta» (`Expand`); the focus on the space, Esc closes it and gives the focus back.
 */
export function DossierPdfDialog({ isOpen, onClose, decisions, progress, onExport, className }: Props) {
  const [excerpts, setExcerpts] = useState(false);
  // What the reader un-ticked: a decision added meanwhile starts ticked, one removed just vanishes.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const headingId = useId();
  const busy = progress !== null;
  const chosen = decisions.filter((d) => !left.has(d.id));

  const toggle = (id: string, on: boolean) => setLeft((prev) => {
    const next = new Set(prev);
    if (on) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <Expand
      open={isOpen}
      // The file is on its way: closing now would hide the progress and the toast of a PDF still being made.
      onClose={busy ? undefined : onClose}
      role="region"
      aria-labelledby={headingId}
      className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}
    >
      <div className="space-y-5 p-4 md:p-5">
        <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-slate-50">Esporta in PDF</h2>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Cosa stampare</legend>
          <label className={OPTION}>
            <input
              type="radio"
              name="dossier-pdf-scope"
              className={`${RADIO} mt-0.5`}
              checked={!excerpts}
              disabled={busy}
              onChange={() => setExcerpts(false)}
            />
            Testo completo
          </label>
          <label className={OPTION}>
            <input
              type="radio"
              name="dossier-pdf-scope"
              className={`${RADIO} mt-0.5`}
              checked={excerpts}
              disabled={busy}
              onChange={() => setExcerpts(true)}
            />
            Solo le parti evidenziate e annotate
          </label>
          {excerpts && (
            <p className="pl-6 text-xs text-slate-600 dark:text-slate-400">
              Per ogni articolo e sentenza: i passi che hai evidenziato o a cui hai agganciato una nota, con le note, e […] dove il testo è omesso.
            </p>
          )}
        </fieldset>

        {decisions.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Sentenze</legend>
            <div className="flex items-center gap-4">
              <Button type="button" variant="link" disabled={busy} onClick={() => setLeft(new Set())}>Tutte</Button>
              <Button type="button" variant="link" disabled={busy} onClick={() => setLeft(new Set(decisions.map((d) => d.id)))}>Nessuna</Button>
            </div>
            <ul className="space-y-1">
              {decisions.map((item) => (
                <li key={item.id}>
                  <label className={`${OPTION} items-center`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      checked={!left.has(item.id)}
                      disabled={busy}
                      onChange={(e) => toggle(item.id, e.target.checked)}
                    />
                    <span className="min-w-0">{decisionCitationOf(item.data)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
          {progress ? `Preparo il PDF…${progress.total > 0 ? ` ${progress.done} di ${progress.total}` : ''}` : ''}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Annulla
          </Button>
          <Button
            variant="primary"
            icon={<Download size={16} aria-hidden />}
            disabled={busy}
            onClick={() => onExport({ excerpts, decisionIds: chosen.map((d) => d.id) })}
          >
            Scarica PDF
          </Button>
        </div>
      </div>
    </Expand>
  );
}
