import { useEffect, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { studiaService } from '../../../services/studiaService';
import type { Materia, PreferenzeStudio } from '../../../types/studia';
import { MATERIA_LABEL } from './studiaLabels';

export interface StudyPreferencesProps {
  /** Called after a change reached the server: the counts of the day may have moved. */
  onChanged: () => void;
}

const MIN_PER_DAY = 1;
const MAX_PER_DAY = 200;
const CONTROL =
  'min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 md:min-h-0 md:py-1.5 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/** A whole number in the allowed range, or null. */
function parseGoal(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '' || !/^\d{1,4}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= MIN_PER_DAY && value <= MAX_PER_DAY ? value : null;
}

type GoalKey = 'nuoveAlGiorno' | 'ripassiAlGiorno';

interface GoalFieldProps {
  label: string;
  hint?: string;
  /** The value in force, as last saved. */
  value: number;
  saving: boolean;
  /** Resolves to the saved value, or null when the save failed. */
  onSave: (value: number) => Promise<number | null>;
}

/** One daily number, saved with its own «Salva», so a half-typed number is never sent; «Salvato» beside it. */
function GoalField({ label, hint, value, saving, onSave }: GoalFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    const parsed = parseGoal(text);
    if (parsed === null) {
      setError(`Inserisci un numero da ${MIN_PER_DAY} a ${MAX_PER_DAY}.`);
      return;
    }
    setError(null);
    const result = await onSave(parsed);
    if (result !== null) {
      setText(String(result));
      setSaved(true);
    }
  };

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mb-1 text-sm text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={MIN_PER_DAY}
          max={MAX_PER_DAY}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            setSaved(false);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL, 'w-24')}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          aria-label={`Salva: ${label.toLowerCase()}`}
          className={cn(CONTROL, 'font-medium hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-slate-700')}
        >
          Salva
        </button>
        {saved && <span role="status" className="text-sm text-slate-500 dark:text-slate-400">Salvato</span>}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * «Impostazioni dello studio», a small disclosure: the review goal that keeps the streak and the
 * daily number of new cards (each saved with its own «Salva») and one switch per subject for the
 * community's validated cards (all off at first; each toggle is sent at once).
 */
export function StudyPreferences({ onChanged }: StudyPreferencesProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<PreferenzeStudio | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    studiaService.preferences().then(
      (loaded) => live && setPreferences(loaded),
      () => live && setProblem('Non riesco a leggere le impostazioni. Riprova più tardi.'),
    );
    return () => {
      live = false;
    };
  }, []);

  const save = async (changes: Partial<PreferenzeStudio>): Promise<PreferenzeStudio | null> => {
    setProblem(null);
    setSaving(true);
    try {
      const saved = await studiaService.savePreferences(changes);
      setPreferences(saved);
      onChanged();
      return saved;
    } catch {
      setProblem('Non sono riuscito a salvare. Riprova.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveGoal = (key: GoalKey) => async (value: number) => {
    const saved = await save({ [key]: value });
    return saved ? saved[key] : null;
  };

  const toggle = (materia: Materia) => {
    if (!preferences) return;
    const on = preferences.materieComunita.includes(materia);
    const next = on ? preferences.materieComunita.filter((m) => m !== materia) : [...preferences.materieComunita, materia];
    void save({ materieComunita: next });
  };

  return (
    <section className="border-t border-slate-200 pt-3 dark:border-slate-800">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-[44px] w-full items-center gap-2 rounded-md text-left text-sm font-medium text-slate-700 md:min-h-0 md:py-1.5 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-slate-400 transition-transform motion-reduce:transition-none', !open && '-rotate-90')} />
          Impostazioni dello studio
        </button>
      </h2>
      <div id={panelId} hidden={!open} className="space-y-5 pt-2">
        {problem && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {problem}
          </p>
        )}
        {preferences && (
          <>
            <GoalField
              label="Ripassi al giorno"
              hint="Quanti ripassi tengono viva la serie. Vale anche finire le schede del giorno."
              value={preferences.ripassiAlGiorno}
              saving={saving}
              onSave={saveGoal('ripassiAlGiorno')}
            />
            <GoalField label="Nuove schede al giorno" value={preferences.nuoveAlGiorno} saving={saving} onSave={saveGoal('nuoveAlGiorno')} />

            <fieldset>
              <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">Schede della comunità</legend>
              <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">Schede validate dalla comunità, per materia</p>
              <ul>
                {(Object.entries(MATERIA_LABEL) as Array<[Materia, string]>).map(([materia, label]) => {
                  const on = preferences.materieComunita.includes(materia);
                  return (
                    <li key={materia}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        disabled={saving}
                        onClick={() => toggle(materia)}
                        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md px-1 text-left text-sm text-slate-800 md:min-h-0 md:py-1.5 disabled:opacity-60 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        {label}
                        <span
                          aria-hidden
                          className={cn('relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors motion-reduce:transition-none', on ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600')}
                        >
                          <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform motion-reduce:transition-none', on && 'translate-x-4')} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          </>
        )}
      </div>
    </section>
  );
}
