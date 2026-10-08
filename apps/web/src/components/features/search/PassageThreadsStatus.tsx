/**
 * What the reader sees when the passage discussions behind the signs are loading or failed to
 * load. Shown by the reading surface while its panel is closed (the panel says it itself).
 */
export function PassageThreadsStatus({ error, loading, onRetry }: { error: boolean; loading: boolean; onRetry: () => void }) {
  return (
    <>
      {error && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          <span>Impossibile caricare le discussioni sui passaggi. I segni potrebbero non mostrarle.</span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            Riprova
          </button>
        </div>
      )}
      {loading && (
        <p role="status" className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Aggiornamento discussioni sui passaggi…
        </p>
      )}
    </>
  );
}
