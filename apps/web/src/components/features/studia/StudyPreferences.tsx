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

/**
 * «Impostazioni dello studio», a small disclosure: the daily goal of new cards (saved with
 * «Salva», so a half-typed number is never sent) and one switch per subject for the community's
 * validated cards (all off at first; each toggle is sent at once).
 */
export function StudyPreferences({ onChanged }: StudyPreferencesProps) {
  const panelId = useId();
  const goalId = useId();
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<PreferenzeStudio | null>(null);
  const [goal, setGoal] = useState('');
  const [goalError, setGoalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Only the goal reports «Salvato», beside its own button: a switch's feedback is the counts changing.
  const [goalSaved, setGoalSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    studiaService.preferences().then(
      (loaded) => {
        if (!live) return;
        setPreferences(loaded);
        setGoal(String(loaded.nuoveAlGiorno));
      },
      () => live && setProblem('Non riesco a leggere le impostazioni. Riprova più tardi.'),
    );
    return () => {
      live = false;
    };
  }, []);

  const save = async (changes: Partial<PreferenzeStudio>) => {
    setProblem(null);
    setSaving(true);
    const isGoal = changes.nuoveAlGiorno !== undefined;
    try {
      const saved = await studiaService.savePreferences(changes);
      setPreferences(saved);
      // A switch must not overwrite a goal being typed.
      if (isGoal) {
        setGoal(String(saved.nuoveAlGiorno));
        setGoalSaved(true);
      }
      onChanged();
    } catch {
      setProblem('Non sono riuscito a salvare. Riprova.');
    } finally {
      setSaving(false);
    }
  };

  const saveGoal = () => {
    const value = parseGoal(goal);
    if (value === null) {
      setGoalError(`Inserisci un numero da ${MIN_PER_DAY} a ${MAX_PER_DAY}.`);
      return;
    }
    setGoalError(null);
    void save({ nuoveAlGiorno: value });
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
            <div>
              <label htmlFor={goalId} className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Nuove schede al giorno
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={goalId}
                  type="number"
                  inputMode="numeric"
                  min={MIN_PER_DAY}
                  max={MAX_PER_DAY}
                  value={goal}
                  onChange={(e) => {
                    setGoal(e.target.value);
                    setGoalError(null);
                    setGoalSaved(false);
                  }}
                  aria-invalid={goalError ? true : undefined}
                  aria-describedby={goalError ? errorId : undefined}
                  className={cn(CONTROL, 'w-24')}
                />
                <button
                  type="button"
                  onClick={saveGoal}
                  disabled={saving}
                  className={cn(CONTROL, 'font-medium hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-slate-700')}
                >
                  Salva
                </button>
                {goalSaved && <span role="status" className="text-sm text-slate-500 dark:text-slate-400">Salvato</span>}
              </div>
              {goalError && (
                <p id={errorId} role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {goalError}
                </p>
              )}
            </div>

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
                          <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all motion-reduce:transition-none', on ? 'left-[1.125rem]' : 'left-0.5')} />
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
