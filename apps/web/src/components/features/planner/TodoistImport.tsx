import { useId, useState, type ChangeEvent } from 'react';
import { Expand } from '../../ui/Expand';
import { taskService } from '../../../services/taskService';
import { Button } from '../../ui/Button';
import { CARD_RADIUS, CONTROL_BORDER, FIELD_HELP, FIELD_LABEL } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';
import { failureMessage, plannerStore } from './plannerStore';
import { useAppStore } from '../../../store/useAppStore';
import { NotTodoistCsvError, planTodoistImport, runTodoistImport, type ImportNote, type ImportPlan } from './todoistCsv';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What has been created from one file in this dossier, by its row: a retry or the same file chosen again does not duplicate. */
interface Progress {
  key: string;
  created: Map<number, string>;
  /** The day an earlier import of this file in this dossier ended well. */
  importedAt: string | null;
}

/**
 * The tab's memory of the imports, so a reload after «connessione interrotta» resumes: one entry per dossier and file
 * (its size and date, never its name), with only the ids of the rows created and of their tasks, never their text.
 * An import that ends well leaves only its day. One key of the session's own (`sessionEnd.ts`), removed at sign-out.
 */
const IMPORT_KEY = 'visualex.opus.todoist-import';
type Stored = Record<string, { rows?: [number, string][]; importedAt?: string }>;

function readStored(): Stored {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(IMPORT_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Stored) : {};
  } catch {
    return {};
  }
}

function writeStored(key: string, entry: Stored[string]) {
  try {
    sessionStorage.setItem(IMPORT_KEY, JSON.stringify({ ...readStored(), [key]: entry }));
  } catch {
    // Memory only.
  }
}

function storedProgress(key: string): Progress {
  const entry = readStored()[key];
  const rows = Array.isArray(entry?.rows) ? entry.rows.filter((e): e is [number, string] => Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'string') : [];
  return { key, created: new Map(rows), importedAt: typeof entry?.importedAt === 'string' ? entry.importedAt : null };
}

const longDay = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });

type Outcome = { kind: 'done'; added: number } | { kind: 'failed'; message: string };

function NoteList({ heading, notes }: { heading: string; notes: ImportNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{heading} ({notes.length})</p>
      <ul className="mt-1 space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
        {notes.map((note, i) => (
          <li key={i} className="[overflow-wrap:anywhere]">
            {note.title} — «{note.phrase}»{note.why && `: ${note.why}`}
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
 * goes on from there. The state lives here, outside the space (and in the tab's storage), so closing and opening it
 * again, or reloading the page, duplicates nothing. Mounted per dossier (`key`): nothing carries over to another one.
 */
export function TodoistImport({ id, open, onClose, dossierId, today }: { id: string; open: boolean; onClose: () => void; dossierId: string; today: string }) {
  const inputId = useId();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  // The dossier's kind is the imported tasks' origin (LC130): a dossier di studio's go to Learn's list.
  const kind = useAppStore((s) => s.dossiers.find((d) => d.id === dossierId)?.kind);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setOutcome(null);
    setPlan(null);
    setFileError(null);
    if (!file) return;
    try {
      const next = planTodoistImport(await file.text(), today);
      const key = `${dossierId}:${file.size}:${file.lastModified}`;
      if (progress?.key !== key) setProgress(storedProgress(key));
      setPlan(next);
    } catch (error) {
      setFileError(error instanceof NotTodoistCsvError ? error.message : 'Non riesco a leggere il file. Scegli il CSV esportato da Todoist.');
    }
  };

  // Todoist's syntax read out of the titles, said in the preview.
  const t = plan?.fromTitles;
  const fromTitles = t
    ? [
        t.labels > 0 && `${plural(t.labels, '«@…» diventa un\'etichetta', '«@…» diventano etichette')} (${plan!.titleLabels.join(', ')})`,
        t.deadlines > 0 && `${plural(t.deadlines, '«{…}» diventa il termine finale', '«{…}» diventano termini finali')}`,
        t.durations > 0 && `${plural(t.durations, 'durata «!…» va', 'durate «!…» vanno')} nella descrizione`,
        t.links > 0 && `${plural(t.links, 'link resta', 'link restano')} come testo, con l'indirizzo nella descrizione`,
      ].filter((part): part is string => typeof part === 'string')
    : [];
  const created = progress?.created;
  const done = plan && created ? plan.tasks.filter((t) => created.has(t.row)).length : 0;
  const left = plan ? plan.tasks.length - done : 0;

  const start = async () => {
    if (!plan || !progress || running) return;
    setRunning(true);
    setOutcome(null);
    // The runner writes each row into this map as it is created; a new map in state draws the counts.
    const rows = new Map(progress.created);
    const { added, error } = await runTodoistImport(plan, dossierId, rows, (input) => taskService.create(kind ? { ...input, origin: kind } : input), () => writeStored(progress.key, { rows: [...rows] }));
    // Done: the ids go, the day stays (to say the file was imported); the map in memory keeps this view from importing it again.
    const importedAt = error ? progress.importedAt : new Date().toISOString();
    if (!error) writeStored(progress.key, { importedAt: importedAt! });
    setProgress({ key: progress.key, created: rows, importedAt });
    setRunning(false);
    if (added > 0) plannerStore.getState().changed();
    const total = plan.tasks.filter((t) => rows.has(t.row)).length;
    setOutcome(error ? { kind: 'failed', message: failureMessage(error, 'La connessione si è interrotta.') } : { kind: 'done', added: total });
  };

  return (
    <Expand id={id} open={open} onClose={onClose} className={cn(CARD_RADIUS, CONTROL_BORDER)}>
      <div className="space-y-3 p-3">
        <div className="space-y-1">
          <label htmlFor={inputId} className={FIELD_LABEL}>Importa da Todoist (CSV)</label>
          <p className={FIELD_HELP}>
            Il file resta nel browser: arrivano solo i compiti, come se li scrivessi tu. Assegnatario, promemoria, durata e autore non si importano.
          </p>
          <input
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void chooseFile(event)}
            disabled={running}
            className="block min-h-[44px] w-full max-w-full text-sm text-slate-700 file:mr-3 file:min-h-[44px] file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-700 dark:text-slate-300 dark:file:border-slate-600 dark:file:bg-slate-900 dark:file:text-slate-200"
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
            {fromTitles.length > 0 && (
              <p className="text-sm text-slate-700 dark:text-slate-300">Dai titoli: {fromTitles.join('; ')}.</p>
            )}
            <NoteList heading="Date non capite: restano nella descrizione" notes={plan.unreadDates} />
            <NoteList heading="Ripetizioni che diventano compiti non ricorrenti" notes={plan.nonRecurring} />
            {plan.trimmed > 0 && (
              <p className={FIELD_HELP}>{plural(plan.trimmed, 'compito ha', 'compiti hanno')} un titolo o una descrizione troppo lunghi: vengono accorciati.</p>
            )}

            {progress?.importedAt && !outcome && (
              <p className="text-sm text-amber-900 dark:text-amber-200">
                Questo file è già stato importato in questa pratica il {longDay(progress.importedAt)}
                {left > 0 && ': importarlo di nuovo crea i compiti una seconda volta'}.
              </p>
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
                <Button type="button" onClick={() => void start()} disabled={running}>
                  {outcome?.kind === 'failed' ? `Riprova: ${plural(left, 'compito', 'compiti')} da importare` : `Importa ${plural(left, 'compito', 'compiti')}`}
                </Button>
              )}
              <Button type="button" variant="link" onClick={onClose} disabled={running}>
                Chiudi
              </Button>
            </div>
          </div>
        )}
        {!plan && (
          <Button type="button" variant="link" onClick={onClose}>
            Chiudi
          </Button>
        )}
      </div>
    </Expand>
  );
}
