import { useState } from 'react';
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
  /** Where a view puts the page's action, beside the title (`PageFrame`'s `action`): «+ Nuova scheda» on «Le mie schede». */
  actionSlot?: HTMLElement | null;
}

/**
 * The view that shows the smaller strip over it: «Da validare». «Oggi» and «Progressi» draw their own, «Le mie schede»
 * none (G8: the streak and the goal were said there a third time), the session is a lesson of its own.
 */
const underStrip = (pathname: string) => /^\/studia\/valida(\/|$)/.test(pathname);

/** The views with an action beside the title, which they draw into the frame's slot. */
const withAction = (pathname: string) => /^\/studia\/schede(\/|$)/.test(pathname);

/** Each view's name, the page's title (L-37): the section's phrase goes over it. */
function pageName(pathname: string): string {
  if (/^\/studia\/progressi(\/|$)/.test(pathname)) return 'Progressi';
  if (/^\/studia\/schede(\/|$)/.test(pathname)) return 'Le mie schede';
  if (/^\/studia\/valida(\/|$)/.test(pathname)) return 'Da validare';
  return 'Oggi';
}

/** The review session is the lesson, a screen of its own (Gymnasium spec §5.4). */
const isLesson = (pathname: string) => /^\/studia\/ripasso\/sessione(\/|$)/.test(pathname);

/** The streak and the goal over «Da validare» (Gymnasium spec §5.1): the reward stays in sight. */
function AreaStrip() {
  const progress = useProgress(undefined);
  return <StudyStrip dense data={progress.data} loading={progress.status === 'loading' && progress.data === null} onSettingsChanged={progress.reload} />;
}

/**
 * Gymnasium (the code keeps the name `studia`): the view's name as the page's title, «Gymnasium · la tua palestra
 * giuridica» small over it (L-37), and the view. Its views —
 * Oggi, Progressi, Le mie schede, Da validare for validators — are the sidebar's entries in this section
 * (sections spec S6, Gymnasium spec §4). Every view is in the sections' frame (`PageFrame`, G6 and W2): the layout's
 * full width, the heading at its left edge; the layout pads the page and, below `lg`, starts it under the phone's
 * bar. The session has no heading here: it runs in `LessonFrame`, over the shell.
 */
export function StudiaPage() {
  const { isValidator, loading, user } = useAuth();
  const { pathname } = useLocation();
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const context = { validator: loading ? undefined : user ? isValidator : null, actionSlot } satisfies StudiaOutletContext;
  if (isLesson(pathname)) {
    return (
      <LessonFrame>
        <Outlet context={context} />
      </LessonFrame>
    );
  }
  return (
    <PageFrame
      title={pageName(pathname)}
      kicker="gymnasium"
      section="gymnasium"
      className="h-full"
      action={withAction(pathname) ? <div ref={setActionSlot} className="contents" /> : undefined}
    >
      {underStrip(pathname) && <AreaStrip />}
      <Outlet context={context} />
    </PageFrame>
  );
}
