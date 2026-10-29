import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { corsiService } from '../../../../services/corsiService';
import type { CorsoInLista } from '../../../../types/corsi';
import { AcceptTextDialog } from '../AcceptTextDialog';
import { MATERIA_LABEL } from '../studiaLabels';
import { BLOCK_HEADING, FOCUS_RING, INK_BUTTON, MUTED_TEXT, TILE, subjectHue } from '../progress/tokens';
import { CourseStateChip } from './CourseChips';
import { CoursesGate } from './CoursesGate';
import { CoursesEmpty } from './CoursesEmpty';
import { ReadFailure } from './ReadFailure';
import { coursePath, competencesLine, nextStepLabel } from './corsiLabels';
import { setCoursesSwitch } from './coursesSwitch';
import { useCourseRead } from './useCourseRead';
import { useDeclaration } from './useDeclaration';

/** «Percorsi» (`/studia/percorsi`, courses spec §6.3), behind the switch. */
export function CoursesView() {
  return (
    <CoursesGate>
      <CoursesList />
    </CoursesGate>
  );
}

function CoursesList() {
  const list = useCourseRead(corsiService.list, 'corsi');
  const declaration = useDeclaration();
  // A 404 on the list is the switch turned off meanwhile: the gate takes the page back to «Oggi».
  const switchedOff = list.status === 'error' && list.notFound;
  useEffect(() => {
    if (switchedOff) setCoursesSwitch(false);
  }, [switchedOff]);

  const courses = list.data;
  const text = declaration.state.status === 'ready' ? declaration.state.text : null;
  const accepted = text?.accettata === true;
  // The dialog opens by itself once, before the first course (§6.3); closed with «Annulla», it waits behind a button.
  const [dialog, setDialog] = useState<'auto' | 'open' | 'closed'>('auto');
  const firstCourse = courses !== null && courses.length === 0;
  const dialogOpen = text !== null && !accepted && (dialog === 'open' || (dialog === 'auto' && firstCourse));

  const accept = async (testoId: string) => {
    if (await declaration.accept(testoId)) setDialog('closed');
  };

  return (
    <div className="grid grid-cols-1 gap-6 pb-8">
      {/* Once the list says whether this is the first course: its words depend on it. */}
      {text && !accepted && courses !== null && (
        <DeclarationNotice firstCourse={firstCourse} onOpen={() => setDialog('open')} />
      )}
      {declaration.state.status === 'error' && (
        <ReadFailure what="la dichiarazione sul materiale di studio" offline={declaration.state.offline} onRetry={declaration.reload} />
      )}

      {list.status === 'error' && !switchedOff && (
        <ReadFailure what="i tuoi percorsi" offline={list.offline} stale={courses !== null} onRetry={list.reload} />
      )}

      {courses === null && list.status === 'loading' && (
        <p role="status" className={cn('text-sm', MUTED_TEXT)}>
          Caricamento dei percorsi…
        </p>
      )}

      {courses !== null && courses.length === 0 && <CoursesEmpty />}

      {courses !== null && courses.length > 0 && (
        <section aria-labelledby="corsi-elenco" className="grid grid-cols-1 gap-3">
          <h2 id="corsi-elenco" className="sr-only">
            I tuoi percorsi
          </h2>
          <ul className="grid grid-cols-1 gap-3">
            {courses.map((course) => (
              <li key={course.id}>
                <CourseRow course={course} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialogOpen && text && (
        <AcceptTextDialog text={text} busy={declaration.busy} onAccept={(id) => void accept(id)} onCancel={() => setDialog('closed')} />
      )}
    </div>
  );
}

/** Before the declaration: what it is for, and the button that opens it. */
function DeclarationNotice({ firstCourse, onOpen }: { firstCourse: boolean; onOpen: () => void }) {
  return (
    <section aria-labelledby="corsi-dichiarazione" className={cn(TILE, 'grid grid-cols-1 gap-3 p-5')}>
      <h2 id="corsi-dichiarazione" className={BLOCK_HEADING}>
        Il tuo materiale di studio
      </h2>
      <p className="max-w-[65ch] text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {firstCourse
          ? 'Prima che il tuo assistente possa creare un percorso, dichiara di avere il diritto di usare il materiale da cui lo crei.'
          : 'La dichiarazione sul materiale di studio è cambiata: accettala di nuovo perché il tuo assistente possa creare altri percorsi.'}
      </p>
      <button type="button" onClick={onOpen} className={cn(INK_BUTTON, 'justify-self-start')}>
        Leggi e accetta
      </button>
    </section>
  );
}

/** One course: title, subject, «3 di 8 competenze», its state and the next step; the whole row opens the course. */
function CourseRow({ course }: { course: CorsoInLista }) {
  return (
    <Link
      to={coursePath(course.id)}
      className={cn(
        TILE,
        'group grid min-h-[44px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 transition-[background-color] hover:bg-slate-50 md:p-5 dark:hover:bg-slate-800/60',
        FOCUS_RING,
      )}
    >
      <span className="grid min-w-0 grid-cols-1 gap-1.5">
        <span className="break-words font-serif text-lg font-medium leading-snug text-slate-900 dark:text-slate-50">{course.titolo}</span>
        <span className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm', MUTED_TEXT)}>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subjectHue(course.materia) }} />
            {MATERIA_LABEL[course.materia]}
          </span>
          <span>{competencesLine(course.competenze)}</span>
          <CourseStateChip stato={course.stato} />
        </span>
        <span className="break-words text-sm text-slate-700 dark:text-slate-300">{nextStepLabel(course)}</span>
      </span>
      <ChevronRight aria-hidden size={18} className="shrink-0 text-slate-400 transition-[translate] group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  );
}
