import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, GraduationCap, Lock, Repeat } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { corsiService } from '../../../../services/corsiService';
import type { CorsoPagina, ModuloPagina } from '../../../../types/corsi';
import { MATERIA_LABEL } from '../studiaLabels';
import { FOCUS_RING, INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, ON_INK, TILE } from '../progress/tokens';
import { coursePath, examPath, modulePath } from './corsiLabels';
import { useCoursesSwitch } from './coursesSwitch';
import { useCourseRead } from './useCourseRead';

/** The courses in progress, each with its page: a handful at most (30 a user, server-side). */
async function readTrail(): Promise<CorsoPagina[]> {
  const courses = (await corsiService.list()).filter((c) => c.stato === 'in-corso');
  return Promise.all(courses.map((c) => corsiService.get(c.id)));
}

type NodeKind = 'done' | 'current' | 'todo' | 'locked';

function Node({ kind, icon }: { kind: NodeKind; icon?: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full',
        kind === 'current' && cn(INK_BG, ON_INK),
        kind === 'todo' && cn('border-2 bg-card', INK_BORDER, INK_TEXT),
        kind === 'done' && 'bg-ink-300 text-slate-900 dark:bg-ink-700 dark:text-slate-50',
        kind === 'locked' && 'border-2 border-dashed border-slate-300 bg-card text-slate-500 dark:border-slate-700 dark:text-slate-400',
      )}
    >
      {kind === 'done' ? <Check size={18} strokeWidth={2.5} /> : kind === 'locked' ? <Lock size={18} /> : icon}
    </span>
  );
}

const ROW = 'flex w-full items-center gap-4 rounded-xl py-2 pl-1 pr-2 text-left';
const LINK_ROW = cn(ROW, 'transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/60', FOCUS_RING);

/** One node: a link when it leads somewhere, else a named group that says why not. */
function Stop({ to, name, kind, icon, title, line }: { to: string | null; name: string; kind: NodeKind; icon?: ReactNode; title: string; line: string }) {
  const body = (
    <>
      <Node kind={kind} icon={icon} />
      <span className="min-w-0 flex-1">
        <span className="block font-serif text-lg leading-snug text-slate-900 [overflow-wrap:anywhere] dark:text-slate-50">{title}</span>
        <span className={cn('block text-[13px]', MUTED_TEXT)}>{line}</span>
      </span>
    </>
  );
  return (
    <li className="relative">
      {to ? (
        <Link to={to} aria-label={name} className={LINK_ROW}>
          {body}
        </Link>
      ) : (
        <div role="group" aria-label={name} className={ROW}>
          {body}
        </div>
      )}
    </li>
  );
}

const MODULE_LINE: Record<Exclude<ModuloPagina['stato'], 'ritirato'>, string> = { fatto: 'fatto', 'in-corso': 'in corso', 'da-iniziare': 'da fare' };

function ModuleStop({ courseId, modulo }: { courseId: string; modulo: ModuloPagina & { stato: Exclude<ModuloPagina['stato'], 'ritirato'> } }) {
  const line = MODULE_LINE[modulo.stato] + (modulo.stato === 'fatto' && modulo.quizPercentuale !== null ? ` · quiz al ${modulo.quizPercentuale}%` : '');
  return (
    <Stop
      to={modulePath(courseId, modulo.id)}
      name={`Modulo ${modulo.ordine}: ${modulo.titolo}, ${line}`}
      kind={modulo.stato === 'fatto' ? 'done' : modulo.stato === 'in-corso' ? 'current' : 'todo'}
      icon={<span className="text-sm font-semibold tabular-nums">{modulo.ordine}</span>}
      title={modulo.titolo}
      line={line}
    />
  );
}

function ExamStop({ course }: { course: CorsoPagina }) {
  const { stato, esameId } = course.esame;
  const title = 'Esame del percorso';
  if (stato === 'superato') return <Stop to={null} name={`${title}: superato`} kind="done" title={title} line="Superato" />;
  if (stato === 'assente') return <Stop to={null} name={`${title}, chiuso: l’esame non c’è ancora`} kind="locked" title={title} line="Chiuso: l’esame non c’è ancora" />;
  if (stato === 'bloccato') return <Stop to={null} name={`${title}, chiuso: prima i moduli che contano`} kind="locked" title={title} line="Chiuso: prima i moduli che contano" />;
  // Open, under way or failed: the exam itself while it can be taken, else the course page, which says when a new one opens.
  const takeable = (stato === 'aperto' || stato === 'in-corso') && esameId !== null;
  const line = stato === 'aperto' ? 'Aperto' : stato === 'in-corso' ? 'In corso' : 'Non superato: vedi il percorso';
  return (
    <Stop
      to={takeable ? examPath(course.id, esameId) : coursePath(course.id)}
      name={`${title}: ${line.toLowerCase()}`}
      kind="current"
      icon={<GraduationCap size={20} />}
      title={title}
      line={line}
    />
  );
}

function CourseUnit({ course }: { course: CorsoPagina }) {
  const headingId = `sentiero-corso-${course.id}`;
  const modules = course.moduli
    .filter((m): m is ModuloPagina & { stato: Exclude<ModuloPagina['stato'], 'ritirato'> } => m.stato !== 'ritirato')
    .sort((a, b) => a.ordine - b.ordine);
  const cards = course.schede.dovute + course.schede.verifica;
  return (
    <section aria-labelledby={headingId} className={cn(TILE, 'overflow-hidden')}>
      <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h3 id={headingId} className="text-base font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-slate-50">
          {course.titolo}
        </h3>
        <p className={cn('mt-0.5 text-sm', MUTED_TEXT)}>Percorso · {MATERIA_LABEL[course.materia]}</p>
      </header>
      <ol aria-label={`Il sentiero di ${course.titolo}`} className="relative px-5 py-4">
        <span aria-hidden className="absolute bottom-9 left-[42px] top-9 w-0.5 bg-slate-200 dark:bg-slate-800" />
        {modules.map((modulo) => (
          <ModuleStop key={modulo.id} courseId={course.id} modulo={modulo} />
        ))}
        {cards > 0 ? (
          <Stop
            to={`/learn/ripasso/sessione?corso=${encodeURIComponent(course.id)}`}
            name={`Ripasso del percorso: ${cards} ${cards === 1 ? 'scheda' : 'schede'} da ripassare`}
            kind="current"
            icon={<Repeat size={18} />}
            title="Ripasso del percorso"
            line={`${cards} ${cards === 1 ? 'scheda' : 'schede'} da ripassare`}
          />
        ) : (
          <Stop to={null} name="Ripasso del percorso: niente da ripassare oggi" kind="todo" icon={<Repeat size={18} />} title="Ripasso del percorso" line="Niente da ripassare oggi" />
        )}
        <ExamStop course={course} />
      </ol>
    </section>
  );
}

/**
 * The courses' units on Learn's road (LC62), first on it: each course in progress as its modules in order, its review
 * (the course's due and check cards) and its final exam. A lock only where the server holds one — the exam before the
 * counting modules are done; the modules are not locked against each other, since the server does not order them.
 * Nothing while «Percorsi» is off or unknown, nor while the read travels or fails («Oggi»'s own reads say the errors).
 */
export function CourseTrail() {
  const on = useCoursesSwitch() === 'on';
  const trail = useCourseRead(readTrail, 'corsi-sentiero', on);
  if (!on || trail.data === null || trail.data.length === 0) return null;
  return (
    <>
      {trail.data.map((course) => (
        <CourseUnit key={course.id} course={course} />
      ))}
    </>
  );
}
