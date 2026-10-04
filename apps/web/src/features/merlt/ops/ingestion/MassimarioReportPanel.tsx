// apps/web/src/features/merlt/ops/ingestion/MassimarioReportPanel.tsx
import type { MassimarioReport, VectorProgress } from './types';

// Italian groups four-digit numbers only when asked to ('always'): 1.190, not 1190. The option
// value is ES2023 Intl; the app's TypeScript lib is ES2022, which types it as a boolean.
const NUMBER = new Intl.NumberFormat('it-IT', { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
const n = (value: number | null | undefined): string => NUMBER.format(value ?? 0);
const pct = (value: number | null): string =>
  value === null ? '—' : `${value.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;

export interface MassimarioReportPanelProps {
  report: MassimarioReport;
  vectors?: VectorProgress;
  /** Promote the batch again to resume vectors that stopped (MERL-T accepts it only then). */
  onResume?: () => void;
  /** A resume request is in flight. */
  resuming?: boolean;
  /** Fetch the batch again: the panel stops polling once a batch is promoted. */
  onRefresh?: () => void;
}

/** MERL-T's STALE_AFTER_S (worker/massimario_tasks.py): a chain silent this long is dead. */
const STALE_AFTER_MS = 3_600_000;

/** Vectors that will not finish on their own, judged as MERL-T's router judges them. */
function vectorsStopped(vectors: VectorProgress): boolean {
  if (vectors.error) return true;
  if (vectors.done >= vectors.total) return false;
  const updated = vectors.updated_at ? Date.parse(vectors.updated_at) : NaN;
  return Number.isNaN(updated) || Date.now() - updated > STALE_AFTER_MS;
}

/** The report of a Massimario batch: what the administrator reads before promoting it. */
export function MassimarioReportPanel({ report, vectors, onResume, resuming, onRefresh }: MassimarioReportPanelProps) {
  const { citazioni, pronunce, norme } = report;
  const stopped = vectors !== undefined && vectorsStopped(vectors);
  const running = vectors !== undefined && !stopped && vectors.done < vectors.total;
  const below = citazioni.copertura_pct !== null && citazioni.copertura_pct < 95;
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-700">
      <h4 className="text-xs font-bold uppercase text-slate-600 dark:text-slate-300">Rapporto del volume</h4>
      <p className="text-slate-700 dark:text-slate-300">{report.volume.titolo}</p>
      <p className={below ? 'text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}>
        Copertura delle citazioni: {pct(citazioni.copertura_pct)} ({n(citazioni.rv_riconosciute)} su{' '}
        {n(citazioni.rv_totali)} Rv.){below && ' — sotto la soglia del 95%'}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600 dark:text-slate-400">
        <dt>Paragrafi</dt><dd>{n(report.paragrafi)} ({n(report.frammenti)} frammenti)</dd>
        <dt>Pronunce</dt><dd>{n(pronunce.totali)} (già nel grafo: {n(pronunce.gia_nel_grafo)}; anno sottinteso: {n(pronunce.anno_implicito)})</dd>
        <dt>Norme citate</dt><dd>{n(norme.riferimenti)} rinvii · {n(norme.articoli)} articoli · {n(norme.atti)} atti</dd>
        <dt>Date completate</dt><dd>{n(norme.date_completate)}</dd>
        <dt>Non risolte</dt><dd>{n(norme.non_risolte)} (partizioni: {n(norme.partizioni)})</dd>
        <dt>Sentenze linkate come leggi</dt><dd>{n(norme.link_a_pronunce)} (escluse dalle norme)</dd>
        <dt>Sezioni fuori capitolo</dt><dd>{n(report.sezioni_fuori_capitolo)}</dd>
      </dl>
      {citazioni.non_riconosciute.length > 0 && (
        <details>
          <summary className="cursor-pointer text-slate-600 dark:text-slate-400">Citazioni non riconosciute (esempi)</summary>
          <ul className="mt-2 space-y-1 font-mono text-xs text-slate-500">
            {citazioni.non_riconosciute.map((sample, i) => <li key={i}>{sample}</li>)}
          </ul>
        </details>
      )}
      {vectors && (
        <p className="text-slate-600 dark:text-slate-400">
          Vettori: {n(vectors.done)} su {n(vectors.total)}
          {running && ' — in corso'}
          {vectors.error && <span className="text-amber-700 dark:text-amber-400"> — errore: {vectors.error}</span>}
        </p>
      )}
      {running && onRefresh && (
        <button type="button" onClick={onRefresh}
          className="min-h-[44px] text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:text-primary-400">
          Aggiorna
        </button>
      )}
      {stopped && onResume && (
        <button type="button" onClick={onResume} disabled={resuming}
          className="min-h-[44px] text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 md:min-h-0 dark:text-primary-400">
          Riprendi i vettori
        </button>
      )}
    </section>
  );
}
