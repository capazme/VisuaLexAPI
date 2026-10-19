import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { StudyStrip } from './progress/StudyStrip';
import { useProgress } from './progress/useProgress';

/** What the area tells its views; `validator` is undefined while the account is still loading. */
export interface StudiaOutletContext {
  validator: boolean | undefined;
}

/** The views that show the smaller strip over them: «Oggi» draws its own, the session is a lesson of its own (G2). */
const underStrip = (pathname: string) => /^\/studia\/(schede|valida)(\/|$)/.test(pathname);

/** The streak and the goal over «Le mie schede» and «Da validare» (Gymnasium spec §5.1): the reward stays in sight. */
function AreaStrip() {
  const progress = useProgress(undefined);
  return <StudyStrip dense data={progress.data} loading={progress.status === 'loading' && progress.data === null} onSettingsChanged={progress.reload} />;
}

/**
 * VisuaLex Gymnasium (the code keeps the name `studia`): the area's heading and the view. Its views —
 * Oggi, Le mie schede, Da validare for validators — are the sidebar's entries in this section
 * (sections spec S6, Gymnasium spec §4). The layout pads the page and, below `lg`, starts it under its
 * floating menu button.
 */
export function StudiaPage() {
  const { isValidator, loading } = useAuth();
  const { pathname } = useLocation();
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
      <header className="border-b border-slate-200 pb-3 dark:border-slate-800">
        <h1 className="font-serif text-3xl font-medium tracking-tight text-slate-900 dark:text-slate-50">VisuaLex Gymnasium</h1>
      </header>
      {underStrip(pathname) && <AreaStrip />}
      <Outlet context={{ validator: loading ? undefined : isValidator } satisfies StudiaOutletContext} />
    </div>
  );
}
