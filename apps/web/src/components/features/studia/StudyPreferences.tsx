import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Collapsible } from '../../ui/Collapsible';
import { studiaService } from '../../../services/studiaService';
import type { Materia, PreferenzeStudio } from '../../../types/studia';
import { MATERIA_LABEL } from './studiaLabels';

export interface StudyPreferencesProps {
  /** Called after a change reached the server: the counts of the day may have moved. */
  onChanged: () => void;
  /** Drawn open, with no disclosure of its own: the panel the gear opens in «Oggi»'s band, or the strip's sheet (Gymnasium spec §4). */
  open?: boolean;
  /** Each new value opens the community's subjects (a mission's «Accendi le schede della comunità» led here); 0 asks nothing. */
  communityRequest?: number;
  /** The switches' list: one column, or two where the panel is wide. */
  listClassName?: string;
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
  /** Resolves to the saved value, or null when the save failed. */
  onSave: (value: number) => Promise<number | null>;
}

/**
 * One daily number, saved when the field is left or Enter is pressed (G6: no «Salva» of its own), so a half-typed number
 * is never sent; an unchanged one is not sent at all; «Salvato» beside it.
 */
function GoalField({ label, hint, value, onSave }: GoalFieldProps) {
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
    if (parsed === value) return;
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
          onBlur={() => void submit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL, 'w-24')}
        />
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
 * daily number of new cards (each saved as its field is left) and, one level down and closed at first, one switch per
 * subject for the community's validated cards (all off at first; each toggle is sent at once). The saves go one after
 * the other, so a switch pressed right after a number is neither lost nor overwritten by the number's answer.
 */
export function StudyPreferences({ onChanged, open: alwaysOpen = false, communityRequest = 0, listClassName }: StudyPreferencesProps) {
  const panelId = useId();
  const communityId = useId();
  const [disclosed, setOpen] = useState(false);
  const open = alwaysOpen || disclosed;
  const [community, setCommunity] = useState(communityRequest > 0);
  const communityButton = useRef<HTMLButtonElement>(null);
  // A new request opens the subjects, whatever the reader left them as (state adjusted while rendering, not in an effect).
  const [answered, setAnswered] = useState(communityRequest);
  if (communityRequest !== answered) {
    setAnswered(communityRequest);
    if (communityRequest > 0) setCommunity(true);
  }
  const [preferences, setPreferences] = useState<PreferenzeStudio | null>(null);
  // A switch is held only while a switch's own save travels: its next state is computed from what is on screen.
  const [switching, setSwitching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

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

  const send = async (changes: Partial<PreferenzeStudio>): Promise<PreferenzeStudio | null> => {
    setProblem(null);
    try {
      const saved = await studiaService.savePreferences(changes);
      setPreferences(saved);
      onChanged();
      return saved;
    } catch {
      setProblem('Non sono riuscito a salvare. Riprova.');
      return null;
    }
  };
  // One after the other: each answer is the whole of the settings, so the last one sent is the last one drawn.
  const save = (changes: Partial<PreferenzeStudio>): Promise<PreferenzeStudio | null> => {
    const run = queue.current.then(() => send(changes));
    queue.current = run;
    return run;
  };

  const saveGoal = (key: GoalKey) => async (value: number) => {
    const saved = await save({ [key]: value });
    return saved ? saved[key] : null;
  };

  const toggle = (materia: Materia) => {
    if (!preferences) return;
    const on = preferences.materieComunita.includes(materia);
    const next = on ? preferences.materieComunita.filter((m) => m !== materia) : [...preferences.materieComunita, materia];
    setSwitching(true);
    void save({ materieComunita: next }).finally(() => setSwitching(false));
  };
  const subjects = Object.entries(MATERIA_LABEL) as Array<[Materia, string]>;

  return (
    <section className={cn(!alwaysOpen && 'border-t border-slate-200 pt-3 dark:border-slate-800')}>
      {!alwaysOpen && (
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
      )}
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
              onSave={saveGoal('ripassiAlGiorno')}
            />
            <GoalField label="Nuove schede al giorno" value={preferences.nuoveAlGiorno} onSave={saveGoal('nuoveAlGiorno')} />

            {/* One level down, closed at first (G6): the first level stays short, the card no longer runs past the missions. */}
            <div>
              <button
                ref={communityButton}
                type="button"
                aria-expanded={community}
                aria-controls={communityId}
                onClick={() => setCommunity((v) => !v)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-md text-left text-sm font-medium text-slate-700 md:min-h-0 md:py-1.5 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-slate-400 transition-transform motion-reduce:transition-none', !community && '-rotate-90')} />
                {`Schede della comunità · ${preferences.materieComunita.length} di ${subjects.length}`}
              </button>
              {/* A panel in place too (U1b), one level down. */}
              <Collapsible id={communityId} open={community} onClose={() => setCommunity(false)} triggerRef={communityButton}>
                <fieldset className="pt-1">
                  <legend className="sr-only">Schede della comunità</legend>
                  <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">Schede validate dalla comunità, per materia</p>
                  <ul className={cn('grid gap-x-6', listClassName)}>
                    {subjects.map(([materia, label]) => {
                      const on = preferences.materieComunita.includes(materia);
                      return (
                        <li key={materia}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            disabled={switching}
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
              </Collapsible>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
