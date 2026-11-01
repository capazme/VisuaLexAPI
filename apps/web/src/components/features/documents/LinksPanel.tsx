/**
 * «Prepara i link», «Copia con i link», «Scarica una copia con i link» (spec 2026-10-31-document-hyperlinks §4.2,
 * §5.2, §6.7, §8, §9; L5). Draws what the page holds: the state of the preparation, the summary by reason, the
 * report after a download. The page does the asking, the copying and the writing.
 */
import { useState } from 'react';
import { Check, ClipboardCopy, Download, Eye, Link2, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '../../ui/Button';
import { FOCUS_RING, TRANSITION } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import type { LinkSummary, NoLinkReason } from './documentLinks';
import { NO_LINK_WORDS } from './documentReview';

/** One citation left without a link, as the summary and the report list it. */
export interface UnlinkedRow {
  index: number;
  label: string;
  reason: string;
}

/** What the copy of the Word file did (§6.7 point 3). */
export type DownloadReport =
  | { ok: true; fileName: string; linked: number; /** Of `linked`, those in the footnotes and endnotes. */ inNotes: number; skipped: UnlinkedRow[] }
  | { ok: false; error: string };

export interface LinksPanelProps {
  /** «Riconosci solo nel browser» is on: no link can be asked (§8). */
  localOnly: boolean;
  onLeaveLocal: () => void;
  phase: 'idle' | 'preparing' | 'ready';
  /** Ready, and asking again («Riprova», the norms new since). */
  refreshing: boolean;
  summary: LinkSummary | null;
  /** The rows without a link, by reason, in the order of the text. */
  unlinked: ReadonlyArray<{ reason: NoLinkReason; rows: UnlinkedRow[] }>;
  /** Rows waiting for «Conferma». */
  toConfirm: number;
  reviewing: boolean;
  onReview: (on: boolean) => void;
  onConfirmAll: () => void;
  onPrepare: () => void;
  onCopy: () => void;
  copying: boolean;
  /** The document is a DOCX: «Scarica una copia con i link». */
  docx: boolean;
  onDownload: () => void;
  downloading: boolean;
  report: DownloadReport | null;
  onSelect: (index: number) => void;
}

const LINE = 'text-sm leading-6 text-slate-700 dark:text-slate-300';
const HINT = 'text-[13px] leading-snug text-slate-600 dark:text-slate-400';

/** The PDF line (§9), under «Copia con i link» and in the report. */
export const PDF_LINE = 'Per depositare un PDF con i link attivi, esporta il PDF da Word («Salva con nome» › PDF), non stamparlo in PDF: la stampa toglie i link.';
/** What a request for links sends (§8, G-401), said before the first one. */
export const LINKS_SEND_LINE = 'Per i link, a VisuaLex arriva l’elenco delle norme citate (per esempio «art. 2043 c.c.»), non il testo del documento.';

function RowButtons({ rows, onSelect }: { rows: readonly UnlinkedRow[]; onSelect: (index: number) => void }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-1.5">
      {rows.map((row) => (
        <li key={row.index}>
          <button
            type="button"
            onClick={() => onSelect(row.index)}
            className={cn('inline-flex min-h-[44px] items-center rounded-md border border-slate-200 px-2.5 text-[13px] text-slate-700 hover:bg-slate-50 md:min-h-8 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800', TRANSITION, FOCUS_RING)}
          >
            {row.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function LinksPanel(props: LinksPanelProps) {
  const { localOnly, onLeaveLocal, phase, refreshing, summary, unlinked, toConfirm, reviewing, onReview, onConfirmAll, onPrepare, onCopy, copying, docx, onDownload, downloading, report, onSelect } = props;
  const [why, setWhy] = useState(false);

  return (
    <section aria-labelledby="doc-links" className="rounded-[10px] border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <h2 id="doc-links" className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
        <Link2 aria-hidden size={16} className="text-slate-500 dark:text-slate-400" />
        Link alle fonti
      </h2>

      {localOnly ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className={cn(LINE, 'min-w-0 flex-1 basis-64')}>Per inserire i link VisuaLex deve ricevere le norme citate (non il testo). Con «Riconosci solo nel browser» non riceve nulla.</p>
          <Button variant="secondary" onClick={onLeaveLocal} className="md:min-h-11">Riconosci con VisuaLex questo documento</Button>
        </div>
      ) : phase !== 'ready' ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className={cn(LINE, 'min-w-0 flex-1 basis-64')}>
            <ShieldCheck aria-hidden size={14} className="mr-1 inline align-[-2px] text-emerald-700 dark:text-emerald-400" />
            {LINKS_SEND_LINE}
          </p>
          <Button variant="primary" icon={<Link2 size={15} />} loading={phase === 'preparing'} onClick={onPrepare} className="md:min-h-11">
            {phase === 'preparing' ? 'Preparo i link…' : 'Prepara i link'}
          </Button>
        </div>
      ) : summary && (
        <div className="mt-2 flex flex-col gap-3">
          <p className={LINE}>
            <span className="font-medium text-slate-900 dark:text-slate-50">
              {summary.linked} {summary.linked === 1 ? 'citazione avrà il link' : 'citazioni avranno il link'}
            </span>
            {summary.notLinked > 0 && (
              <>
                {' · '}{summary.notLinked} no:{' '}
                <button type="button" aria-expanded={why} aria-controls="doc-links-why" onClick={() => setWhy((v) => !v)} className={cn('inline-flex min-h-[44px] items-center font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800 md:min-h-0 dark:text-primary-300', FOCUS_RING)}>
                  {why ? 'nascondi perché' : 'vedi perché'}
                </button>
              </>
            )}
          </p>
          {why && summary.notLinked > 0 && (
            <ul id="doc-links-why" className="flex flex-col gap-2">
              {unlinked.map((group) => (
                <li key={group.reason}>
                  <p className={HINT}><span className="font-medium text-slate-800 dark:text-slate-200">{group.rows.length}</span> {NO_LINK_WORDS[group.reason]}</p>
                  <RowButtons rows={group.rows} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}

          {toConfirm > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-950/40">
              <p className={cn(LINE, 'min-w-0 flex-1 basis-56')}>
                {toConfirm === 1 ? '1 citazione non avrà il link finché non la confermi' : `${toConfirm} citazioni non avranno il link finché non le confermi`}
                <span className="block text-[13px] text-slate-600 dark:text-slate-400">Prese dal contesto o applicate a più citazioni: guarda che l’atto sia quello giusto.</span>
              </p>
              <Button variant="secondary" icon={<Eye size={15} />} aria-pressed={reviewing} onClick={() => onReview(!reviewing)} className="md:min-h-11">
                {reviewing ? 'Mostra tutte' : 'Rivedile'}
              </Button>
              <Button variant="secondary" icon={<Check size={15} />} onClick={onConfirmAll} className="md:min-h-11">Conferma tutte ({toConfirm})</Button>
            </div>
          )}

          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <Button variant="primary" icon={<ClipboardCopy size={15} />} loading={copying} disabled={summary.linked === 0} onClick={onCopy} className="md:min-h-11">
              Copia con i link
            </Button>
            {docx && (
              <div className="flex flex-col">
                <Button variant="secondary" icon={<Download size={15} />} loading={downloading} disabled={summary.linked === 0} onClick={onDownload} className="md:min-h-11">
                  Scarica una copia con i link
                </Button>
                <span className={cn(HINT, 'pt-1')}>Il file originale non viene modificato.</span>
              </div>
            )}
            {summary.canRetry && (
              <Button variant="ghost" icon={<RotateCcw size={15} />} loading={refreshing} onClick={onPrepare} className="md:min-h-11">
                {summary.byReason.source_unavailable ? 'Riprova' : 'Prepara i link mancanti'}
              </Button>
            )}
          </div>
          <p className={HINT}>
            In Word incolla con «Unisci formattazione»: i link restano e il carattere è quello del tuo atto. {PDF_LINE}
          </p>
          <p className={HINT}>Il link apre il testo vigente oggi su Normattiva; un atto dell’Unione apre la sua pagina su EUR-Lex.</p>
        </div>
      )}

      {report && (
        <div role="status" className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          {report.ok ? (
            <>
              <p className={LINE}>
                <span className="font-medium text-slate-900 dark:text-slate-50">Copia scaricata: {report.linked} {report.linked === 1 ? 'link inserito' : 'link inseriti'}</span>
                {report.inNotes > 0 && ` (${report.linked - report.inNotes} nel testo, ${report.inNotes} nelle note)`}
                {' '}in «{report.fileName}».
              </p>
              {report.skipped.length > 0 && (
                <div className="mt-1">
                  <p className={HINT}>Senza link nella copia:</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {report.skipped.map((row) => (
                      <li key={row.index} className={HINT}>
                        <button type="button" onClick={() => onSelect(row.index)} className={cn('inline-flex min-h-[44px] items-center font-medium text-slate-800 underline underline-offset-2 md:min-h-0 dark:text-slate-200', FOCUS_RING)}>{row.label}</button>
                        {' '}— {row.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className={cn(HINT, 'mt-2')}>{PDF_LINE}</p>
            </>
          ) : (
            <p className="text-sm text-red-700 dark:text-red-300">{report.error}</p>
          )}
        </div>
      )}
    </section>
  );
}
