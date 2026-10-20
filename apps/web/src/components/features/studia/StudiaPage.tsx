import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { useAuth } from '../../../hooks/useAuth';
import { LessonFrame } from './LessonFrame';
import { StudyStrip } from './progress/StudyStrip';
import { useProgress } from './progress/useProgress';
import { FOCUS_RING } from '../../../constants/interactions';

/** What the area tells its views; `validator` is undefined while the account is still loading. */
export interface StudiaOutletContext {
  validator: boolean | undefined;
}

/** The views that show the smaller strip over them: «Oggi» and «Progressi» draw their own, the session is a lesson of its own. */
const underStrip = (pathname: string) => /^\/studia\/(schede|valida)(\/|$)/.test(pathname);

/** The review session is the lesson, a screen of its own (Gymnasium spec §5.4). */
const isLesson = (pathname: string) => /^\/studia\/ripasso\/sessione(\/|$)/.test(pathname);

/**
 * «Oggi» and «Progressi» are one column (Gymnasium spec §5.1, §5.3): on their pages the heading and its rule take the
 * column's width, centred.
 */
const isColumn = (pathname: string) => /^\/studia\/(ripasso|progressi)\/?$/.test(pathname);

/** The streak and the goal over «Le mie schede» and «Da validare» (Gymnasium spec §5.1): the reward stays in sight. */
function AreaStrip() {
  const progress = useProgress(undefined);
  return <StudyStrip dense data={progress.data} loading={progress.status === 'loading' && progress.data === null} onSettingsChanged={progress.reload} />;
}

/**
 * Gymnasium (the code keeps the name `studia`): the area's heading — «Gymnasium: la tua palestra giuridica»; the
 * section switcher keeps the short name — and the view. Its views —
 * Oggi, Progressi, Le mie schede, Da validare for validators — are the sidebar's entries in this section
 * (sections spec S6, Gymnasium spec §4). The layout pads the page and, below `lg`, starts it under its
 * floating menu button. The session has no heading here: it runs in `LessonFrame`, over the shell.
 */
export function StudiaPage() {
  const { isValidator, loading } = useAuth();
  const { pathname } = useLocation();
  const context = { validator: loading ? undefined : isValidator } satisfies StudiaOutletContext;
  if (isLesson(pathname)) {
    return (
      <LessonFrame>
        <Outlet context={context} />
      </LessonFrame>
    );
  }
  return (
    <div className={cn('mx-auto flex h-full w-full flex-col gap-4', isColumn(pathname) ? 'max-w-3xl' : 'max-w-6xl')}>
      <header className="border-b border-slate-200 pb-3 dark:border-slate-800">
        <h1 data-section-title="gymnasium" tabIndex={-1} className={`${FOCUS_RING} rounded-sm font-serif text-2xl font-medium tracking-tight text-slate-900 md:text-3xl dark:text-slate-50`}>Gymnasium: la tua palestra giuridica</h1>
      </header>
      {underStrip(pathname) && <AreaStrip />}
      <Outlet context={context} />
    </div>
  );
}
