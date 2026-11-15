import { Link } from 'react-router-dom';
import { cn } from '../../../../lib/utils';
import { corsiService } from '../../../../services/corsiService';
import { BLOCK_HEADING, INK_BUTTON, MUTED_TEXT, TILE } from '../progress/tokens';
import { examPath } from './corsiLabels';
import { useCoursesSwitch } from './coursesSwitch';
import { useCourseRead } from './useCourseRead';

/**
 * «Oggi»'s «Simulazione d'esame» (LC9): one line per course whose next step is the final exam, as the list says it
 * (`GET /lingo/corsi`, `prossimo.tipo === 'esame'`: every counting module done, an exam not handed in — open or under
 * way), with «Inizia la prova» to the exam. `GET /oggi` does not carry the exam. Nothing while the switch is off, nor
 * while the read travels or fails.
 */
export function TodayExam() {
  const on = useCoursesSwitch() === 'on';
  const courses = useCourseRead(corsiService.list, 'corsi', on);
  if (!on || courses.data === null) return null;
  const exams = courses.data.flatMap((c) => (c.prossimo?.tipo === 'esame' ? [{ corso: c, esameId: c.prossimo.id }] : []));
  if (exams.length === 0) return null;
  return (
    <section aria-labelledby="oggi-esame" className={cn(TILE, 'grid grid-cols-1 gap-3 p-4 md:p-5')}>
      <h2 id="oggi-esame" className={BLOCK_HEADING}>
        Simulazione d’esame
      </h2>
      <ul className="grid grid-cols-1 gap-3">
        {exams.map(({ corso, esameId }) => (
          <li key={corso.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="grid min-w-0 flex-1 basis-56 grid-cols-1 gap-0.5">
              <span className="break-words text-sm font-semibold text-slate-900 dark:text-slate-50">{corso.titolo}</span>
              <span className={cn('break-words text-sm', MUTED_TEXT)}>Hai finito i moduli: l’esame finale ti aspetta.</span>
            </span>
            <Link to={examPath(corso.id, esameId)} aria-label={`Inizia la prova di «${corso.titolo}»`} className={INK_BUTTON}>
              Inizia la prova
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
