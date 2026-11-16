import { useId, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { taskService } from '../../services/taskService';
import { cn } from '../../lib/utils';
import { BLOCK_HEADING, FOCUS_RING, TILE } from '../../components/features/studia/progress/tokens';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { FIELD, FIELD_LABEL } from '../../components/features/planner/plannerStyles';
import { failureMessage, plannerStore } from '../../components/features/planner/plannerStore';
import { computeDeadline, DEADLINE_OPTIONS, formatLong, formatPlain, type DeadlineKind } from './computeDeadline';

/**
 * «Termini» on a work dossier's page: the deadline of an appeal from its notification, with the calculation, and a
 * button that puts it in the dossier's tasks as a task due that day. It writes through the planner's own service.
 */
export function DeadlineCard({ dossierId }: { dossierId: string }) {
  const id = useId();
  const [kind, setKind] = useState<DeadlineKind>('appello');
  const [start, setStart] = useState('');
  const [excluded, setExcluded] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // The deadline the task was made for: any change of the inputs makes the button available again.
  const [added, setAdded] = useState<string | null>(null);

  const option = DEADLINE_OPTIONS.find((o) => o.kind === kind)!;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && start >= '1990-01-01' && start <= '2100-12-31';
  const result = useMemo(() => (valid ? computeDeadline({ kind, start, excludedFromSuspension: excluded }) : null), [valid, kind, start, excluded]);
  const key = result ? `${kind}|${start}|${excluded}` : null;
  const isAdded = key !== null && added === key;

  const addToAgenda = async () => {
    if (!result || !key || saving) return;
    setSaving(true);
    const { changed, notify } = plannerStore.getState();
    try {
      await taskService.create({
        title: `${result.actLabel} entro il ${formatPlain(result.deadline)}`,
        description: `${result.basis} · ${result.article}\n\n${result.steps.join('\n')}\n\nCalcolo indicativo: verifica sempre il termine.`,
        dueDate: result.deadline,
        dossierId,
        origin: 'lavoro',
      });
      setAdded(key);
      changed();
    } catch (error) {
      notify(failureMessage(error, 'Non riesco ad aggiungere il termine all’agenda. Riprova.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className={cn(TILE, 'mb-6 min-w-0 space-y-4 p-3 md:p-4')}>
      <h3 id={`${id}-heading`} className={BLOCK_HEADING}>Termini</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-kind`} className={FIELD_LABEL}>Impugnazione</label>
          <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as DeadlineKind)} className={FIELD}>
            {DEADLINE_OPTIONS.map((o) => (
              <option key={o.kind} value={o.kind}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-start`} className={FIELD_LABEL}>{option.dateLabel}</label>
          <input id={`${id}-start`} type="date" value={start} onChange={(e) => setStart(e.target.value)} className={FIELD} />
        </div>
      </div>
      <label className={cn('flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg py-2 text-sm text-slate-800 dark:text-slate-200', FOCUS_RING, 'focus-within:ring-2')}>
        <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary-900" />
        <span>Materia esclusa dalla sospensione feriale (lavoro e previdenza, cause urgenti ex art. 92 ord. giud.)</span>
      </label>

      {result === null ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Scegli la data per vedere la scadenza.</p>
      ) : (
        <div aria-live="polite" className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="font-serif text-2xl font-medium tracking-tight text-slate-900 [overflow-wrap:anywhere] dark:text-slate-50">
              {result.actLabel} entro {formatLong(result.deadline)}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{result.basis} · {result.article}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-expanded={open} aria-controls={`${id}-steps`} onClick={() => setOpen((v) => !v)} className={buttonClassName('secondary', 'md')}>
              {open ? 'Nascondi il calcolo' : 'Mostra il calcolo'}
            </button>
            {isAdded ? (
              <p role="status" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-green-700 dark:text-green-400">
                <Check size={16} aria-hidden /> In agenda
              </p>
            ) : (
              <button type="button" onClick={addToAgenda} disabled={saving} className={buttonClassName('primary', 'md')}>
                Aggiungi all’agenda
              </button>
            )}
          </div>
          {open && (
            <ol id={`${id}-steps`} className="list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
              {result.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Calcolo indicativo: verifica sempre il termine. Non tiene conto del santo patrono del luogo: controllalo tu.
          </p>
        </div>
      )}
    </section>
  );
}
