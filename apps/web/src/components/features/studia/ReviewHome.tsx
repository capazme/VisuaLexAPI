import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { studiaService } from '../../../services/studiaService';
import type { Materia } from '../../../types/studia';
import { Button } from '../../ui/Button';
import { MATERIA_LABEL } from './studiaLabels';
import { StudyPreferences } from './StudyPreferences';

const CONTROL =
  'min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 md:min-h-0 md:py-1.5 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

interface Counts {
  dovute: number;
  nuove: number;
}

/**
 * «Ripasso», before the session: what is on today (due and new cards), narrowed to one subject if
 * the user wants, then «Inizia il ripasso». The study settings sit below. The counts come with the
 * session's cards, which this view does not use: the session reads them again when it starts.
 */
export function ReviewHome() {
  const navigate = useNavigate();
  const [materia, setMateria] = useState<Materia | undefined>(undefined);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped when a setting changed what is on today.
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let live = true;
    studiaService.session(materia).then(
      (session) => {
        if (!live) return;
        setCounts(session.conteggi);
        setFailed(false);
      },
      () => {
        if (!live) return;
        setCounts(null);
        setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [materia, reads]);

  const nothing = counts !== null && counts.dovute === 0 && counts.nuove === 0;
  const start = () => navigate(materia ? `/studia/ripasso/sessione?materia=${materia}` : '/studia/ripasso/sessione');

  return (
    <section className="max-w-xl space-y-6">
      <h2 className="sr-only">Ripasso</h2>

      <div className="space-y-4">
        <p className="font-serif text-xl leading-[1.7] text-slate-900 dark:text-slate-50" aria-live="polite">
          {counts ? `Oggi: ${counts.dovute} da ripassare · ${counts.nuove} nuove` : failed ? '' : 'Carico le schede di oggi…'}
        </p>
        {failed && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Non riesco a leggere le schede di oggi.{' '}
            <button type="button" onClick={() => setReads((n) => n + 1)} className="min-h-[44px] rounded px-1 font-medium underline md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              Riprova
            </button>
          </p>
        )}
        {nothing && <p className="text-sm text-slate-600 dark:text-slate-300">Per oggi hai finito. Le prossime schede tornano domani.</p>}

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Materia"
            value={materia ?? ''}
            onChange={(e) => {
              // The counts on screen answer the subject that was chosen before.
              setCounts(null);
              setFailed(false);
              setMateria((e.target.value || undefined) as Materia | undefined);
            }}
            className={cn(CONTROL, 'min-w-0')}
          >
            <option value="">Tutte le materie</option>
            {(Object.entries(MATERIA_LABEL) as Array<[Materia, string]>).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <Button onClick={start} disabled={counts === null || nothing} className="min-h-[44px] md:min-h-0">
            Inizia il ripasso
          </Button>
        </div>
      </div>

      <StudyPreferences onChanged={() => setReads((n) => n + 1)} />
    </section>
  );
}
