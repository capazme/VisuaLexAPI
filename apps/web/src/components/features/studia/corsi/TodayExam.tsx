import { Link } from 'react-router-dom';
import { buttonClassName } from '../../../ui/buttonStyles';
import { cn } from '../../../../lib/utils';
import { corsiService } from '../../../../services/corsiService';
import { BLOCK_HEADING, MUTED_TEXT, TILE } from '../progress/tokens';
import { examPath } from './corsiLabels';
import { useCoursesSwitch } from './coursesSwitch';
import { useCourseRead } from './useCourseRead';

/**
 * «Oggi»'s «Simulazione d'esame» (LC9): one line per course whose next step is the final exam, as the list says it
 * (`GET /lingo/corsi`, `prossimo.tipo === 'esame'`: every counting module done, an exam not handed in — open or under
 * way), with «Inizia la prova» to the exam, or «Riprendi la prova» once started (the list does not say it: the course
 * page's exam state does, LC12). `GET /oggi` does not carry the exam. Nothing while the switch is off, nor while the
 * read travels or fails.
 */
export function TodayExam() {
  const on = useCoursesSwitch() === 'on';
  const read = useCourseRead(readExams, 'corsi-esami', on);
  if (!on || read.data === null || read.data.length === 0) return null;
  const exams = read.data;
  return (
    <section aria-labelledby="oggi-esame" className={cn(TILE, 'grid grid-cols-1 gap-3 p-4 md:p-5')}>
      <h2 id="oggi-esame" className={BLOCK_HEADING}>
        Simulazione d’esame
      </h2>
      <ul className="grid grid-cols-1 gap-3">
        {exams.map(({ corso, esameId, started }) => (
          <li key={corso.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="grid min-w-0 flex-1 basis-56 grid-cols-1 gap-0.5">
              <span className="break-words text-sm font-semibold text-slate-900 dark:text-slate-50">{corso.titolo}</span>
              <span className={cn('break-words text-sm', MUTED_TEXT)}>Hai finito i moduli: l’esame finale ti aspetta.</span>
            </span>
            <Link to={examPath(corso.id, esameId)} aria-label={`${label(started)} di «${corso.titolo}»`} className={buttonClassName('primary', 'lg')}>
              {label(started)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const label = (started: boolean) => (started ? 'Riprendi la prova' : 'Inizia la prova');

/** The courses whose next step is the exam, each with whether its attempt was started; a course page that fails says «not». */
async function readExams() {
  const courses = await corsiService.list();
  const exams = courses.flatMap((c) => (c.prossimo?.tipo === 'esame' ? [{ corso: c, esameId: c.prossimo.id }] : []));
  return Promise.all(
    exams.map(async (exam) => {
      try {
        const { esame } = await corsiService.get(exam.corso.id);
        return { ...exam, started: esame.esameId === exam.esameId && esame.stato === 'in-corso' };
      } catch {
        return { ...exam, started: false };
      }
    }),
  );
}
