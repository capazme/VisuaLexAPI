import { useId, useState, type ChangeEvent } from 'react';
import { Expand } from '../../ui/Expand';
import { taskService } from '../../../services/taskService';
import { cn } from '../../../lib/utils';
import { INK_BUTTON, QUIET_BUTTON } from '../studia/progress/tokens';
import { FIELD_HINT, FIELD_LABEL } from './plannerStyles';
import { failureMessage, plannerStore } from './plannerStore';
import { NotTodoistCsvError, planTodoistImport, runTodoistImport, type ImportNote, type ImportPlan } from './todoistCsv';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What has been created from one file, by its row: kept while the page is open, so a retry or the same file chosen again does not duplicate. */
interface Progress {
  signature: string;
  created: Map<number, string>;
}

type Outcome = { kind: 'done'; added: number } | { kind: 'failed'; message: string };

function NoteList({ heading, notes }: { heading: string; notes: ImportNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{heading} ({notes.length})</p>
      <ul className="mt-1 space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
        {notes.map((note, i) => (
          <li key={i} className="[overflow-wrap:anywhere]">
            {note.title} — «{note.phrase}»
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * «Importa da Todoist (CSV)» (LC80): a space in the flow of «Compiti» (`Expand`, L-73), not a dialog. The file is read
 * in the browser and never sent: a preview says what will be born and what was not understood, then «Importa N
 * compiti» creates them one at a time with the tasks' own API. A failure halfway says how many went in, and «Riprova»
 * goes on from there. The state lives here, outside the space, so closing and opening it again duplicates nothing.
 */
export function TodoistImport({ id, open, onClose, dossierId, today }: { id: string; open: boolean; onClose: () => void; dossierId: string; today: string }) {
  const inputId = useId();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setOutcome(null);
    setPlan(null);
    setFileError(null);
    if (!file) return;
    try {
      const next = planTodoistImport(await file.text(), today);
      const signature = `${file.name}:${file.size}:${file.lastModified}`;
      if (progress?.signature !== signature) setProgress({ signature, created: new Map() });
      setPlan(next);
    } catch (error) {
      setFileError(error instanceof NotTodoistCsvError ? error.message : 'Non riesco a leggere il file. Scegli il CSV esportato da Todoist.');
    }
  };

  const created = progress?.created;
  const done = plan && created ? plan.tasks.filter((t) => created.has(t.row)).length : 0;
  const left = plan ? plan.tasks.length - done : 0;

  const start = async () => {
    if (!plan || !progress || running) return;
    setRunning(true);
    setOutcome(null);
    // The runner writes each row into this map as it is created; a new map in state draws the counts.
    const rows = new Map(progress.created);
    const { added, error } = await runTodoistImport(plan, dossierId, rows, taskService.create);
    setProgress({ signature: progress.signature, created: rows });
    setRunning(false);
    if (added > 0) plannerStore.getState().changed();
    const total = plan.tasks.filter((t) => rows.has(t.row)).length;
    setOutcome(error ? { kind: 'failed', message: failureMessage(error, 'La connessione si è interrotta.') } : { kind: 'done', added: total });
  };

  return (
    <Expand id={id} open={open} onClose={onClose} className="rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="space-y-3 p-3">
        <div className="space-y-1">
          <label htmlFor={inputId} className={FIELD_LABEL}>Importa da Todoist (CSV)</label>
          <p className={FIELD_HINT}>Il file resta nel browser: arrivano solo i compiti, come se li scrivessi tu.</p>
          <input
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void chooseFile(event)}
            disabled={running}
            className="block min-h-[44px] w-full max-w-full text-sm text-slate-700 file:mr-3 file:min-h-[44px] file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-700 dark:text-slate-300 dark:file:border-slate-600 dark:file:bg-slate-900 dark:file:text-slate-200"
          />
        </div>
        {fileError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{fileError}</p>}

        {plan && (
          <div className="space-y-3">
            {plan.tasks.length === 0 ? (
              <p className="text-sm text-slate-700 dark:text-slate-300">Il file non contiene compiti.</p>
            ) : (
              <p className="text-sm text-slate-800 dark:text-slate-200">
                Nasceranno {plural(plan.tasks.length, 'compito', 'compiti')}
                {plan.subtasks > 0 && <>, di cui {plural(plan.subtasks, 'sottocompito', 'sottocompiti')}</>}
                {plan.labels.length > 0 ? <>, con {plural(plan.labels.length, 'etichetta', 'etichette')} dalle sezioni: {plan.labels.join(', ')}.</> : '.'}
              </p>
            )}
            <NoteList heading="Date non capite: restano nella descrizione" notes={plan.unreadDates} />
            <NoteList heading="Ripetizioni che diventano compiti non ricorrenti" notes={plan.nonRecurring} />
            {plan.trimmed > 0 && (
              <p className={FIELD_HINT}>{plural(plan.trimmed, 'compito ha', 'compiti hanno')} un titolo o una descrizione troppo lunghi: vengono accorciati.</p>
            )}

            <div role="status" aria-live="polite" className="text-sm">
              {outcome?.kind === 'done' && (
                <p className="text-emerald-800 dark:text-emerald-300">
                  Import completato: {plural(outcome.added, 'compito entrato', 'compiti entrati')} nella pratica.
                  {plan.unreadDates.length + plan.nonRecurring.length > 0 && ' Le date e le ripetizioni non capite sono nelle descrizioni.'}
                </p>
              )}
              {outcome?.kind === 'failed' && (
                <p className="text-red-700 dark:text-red-300">
                  Import interrotto: {plural(done, 'compito entrato', 'compiti entrati')} su {plan.tasks.length}. {outcome.message} Riprova: quelli già entrati non vengono creati di nuovo.
                </p>
              )}
              {running && <p className="text-slate-700 dark:text-slate-300">Importo i compiti…</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {left > 0 && (
                <button type="button" onClick={() => void start()} disabled={running} className={INK_BUTTON}>
                  {outcome?.kind === 'failed' ? `Riprova: ${plural(left, 'compito', 'compiti')} da importare` : `Importa ${plural(left, 'compito', 'compiti')}`}
                </button>
              )}
              <button type="button" onClick={onClose} disabled={running} className={cn(QUIET_BUTTON, 'mx-0')}>
                Chiudi
              </button>
            </div>
          </div>
        )}
        {!plan && (
          <button type="button" onClick={onClose} className={cn(QUIET_BUTTON, 'mx-0')}>
            Chiudi
          </button>
        )}
      </div>
    </Expand>
  );
}
