import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { PageFrame } from '../../layout/PageFrame';
import { LessonFrame } from './LessonFrame';
import { StudyStrip } from './progress/StudyStrip';
import { useProgress } from './progress/useProgress';

/**
 * What the area tells its views. `validator`: what the account says; undefined while it is still loading,
 * null when it could not be read (`/auth/me` failed), so that «not read» is never taken for «not a validator».
 */
export interface StudiaOutletContext {
  validator: boolean | null | undefined;
}

/** The views that show the smaller strip over them: «Oggi» and «Progressi» draw their own, the session is a lesson of its own. */
const underStrip = (pathname: string) => /^\/studia\/(schede|valida)(\/|$)/.test(pathname);

/** The review session is the lesson, a screen of its own (Gymnasium spec §5.4). */
const isLesson = (pathname: string) => /^\/studia\/ripasso\/sessione(\/|$)/.test(pathname);

/** The streak and the goal over «Le mie schede» and «Da validare» (Gymnasium spec §5.1): the reward stays in sight. */
function AreaStrip() {
  const progress = useProgress(undefined);
  return <StudyStrip dense data={progress.data} loading={progress.status === 'loading' && progress.data === null} onSettingsChanged={progress.reload} />;
}

/**
 * Gymnasium (the code keeps the name `studia`): the area's heading — «Gymnasium: la tua palestra giuridica»; the
 * section switcher keeps the short name — and the view. Its views —
 * Oggi, Progressi, Le mie schede, Da validare for validators — are the sidebar's entries in this section
 * (sections spec S6, Gymnasium spec §4). Every view is in the sections' frame (`PageFrame`, G6 and W2): the layout's
 * full width, the heading at its left edge; the layout pads the page and, below `lg`, starts it under its floating
 * menu button. The session has no heading here: it runs in `LessonFrame`, over the shell.
 */
export function StudiaPage() {
  const { isValidator, loading, user } = useAuth();
  const { pathname } = useLocation();
  const context = { validator: loading ? undefined : user ? isValidator : null } satisfies StudiaOutletContext;
  if (isLesson(pathname)) {
    return (
      <LessonFrame>
        <Outlet context={context} />
      </LessonFrame>
    );
  }
  return (
    <PageFrame title="Gymnasium: la tua palestra giuridica" section="gymnasium" className="h-full">
      {underStrip(pathname) && <AreaStrip />}
      <Outlet context={context} />
    </PageFrame>
  );
}
