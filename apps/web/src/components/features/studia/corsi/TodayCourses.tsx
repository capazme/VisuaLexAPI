import { Link } from 'react-router-dom';
import { ChevronRight, Route } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { corsiService } from '../../../../services/corsiService';
import type { CorsoDiOggi } from '../../../../types/corsi';
import { FOCUS_RING, INK_TEXT, MUTED_TEXT, TILE } from '../progress/tokens';
import { coursePath } from './corsiLabels';
import { useCoursesSwitch } from './coursesSwitch';
import { useCourseRead } from './useCourseRead';

/**
 * «Oggi»'s row of the courses (courses spec §6.2): for each course with something today, «Modulo del giorno: <titolo>
 * · <percorso>»; when the course's due cards are not done, the row offers them first (§5, step 9), and the module after
 * them. Nothing while the switch is off, nor while the read travels or fails (logged: «Oggi»'s own reads carry the
 * page's errors). The module opens the course page until the module session comes (the web's pull request b).
 */
export function TodayCourses() {
  const on = useCoursesSwitch() === 'on';
  const today = useCourseRead(corsiService.today, 'corsi-oggi', on);
  if (!on || today.data === null) return null;
  const rows = today.data.filter((c) => c.modulo !== null || c.schedeDovute > 0);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="oggi-percorsi" className="grid grid-cols-1 gap-2">
      <h2 id="oggi-percorsi" className="sr-only">
        I percorsi di oggi
      </h2>
      <ul className="grid grid-cols-1 gap-2">
        {rows.map((course) => (
          <li key={course.corsoId}>
            <CourseToday course={course} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const ROW = cn(
  TILE,
  'group grid min-h-[44px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-[background-color] hover:bg-slate-50 dark:hover:bg-slate-800/60',
  FOCUS_RING,
);

function CourseToday({ course }: { course: CorsoDiOggi }) {
  const cards = course.schedeDovute;
  const icon = <Route aria-hidden size={18} className={cn('shrink-0', INK_TEXT)} />;
  const chevron = <ChevronRight aria-hidden size={18} className="shrink-0 text-slate-400" />;
  if (cards > 0) {
    return (
      <Link to={`/studia/ripasso/sessione?corso=${encodeURIComponent(course.corsoId)}`} className={ROW}>
        {icon}
        <span className="grid min-w-0 grid-cols-1 gap-0.5">
          <span className="break-words text-sm font-semibold text-slate-900 dark:text-slate-50">
            Ripassa {cards} {cards === 1 ? 'scheda' : 'schede'} di «{course.titolo}»
          </span>
          <span className={cn('break-words text-sm', MUTED_TEXT)}>
            {course.modulo ? `Prima del modulo del giorno: ${course.modulo.titolo}` : 'Le schede del percorso dovute oggi'}
          </span>
        </span>
        {chevron}
      </Link>
    );
  }
  return (
    <Link to={coursePath(course.corsoId)} className={ROW}>
      {icon}
      <span className="min-w-0 break-words text-sm text-slate-900 dark:text-slate-50">
        <span className="font-semibold">Modulo del giorno: {course.modulo!.titolo}</span>
        <span className={MUTED_TEXT}> · {course.titolo}</span>
      </span>
      {chevron}
    </Link>
  );
}
