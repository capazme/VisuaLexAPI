import { Outlet } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';

/** What the area tells its views; `validator` is undefined while the account is still loading. */
export interface StudiaOutletContext {
  validator: boolean | undefined;
}

/**
 * VisuaLex Gymnasium (the code keeps the name `studia`): the area's heading and the view. Its views —
 * Ripasso, Le mie schede, Da validare for validators — are the sidebar's entries in this section
 * (sections spec S6). The layout pads the page and, below `lg`, starts it under its floating menu button.
 */
export function StudiaPage() {
  const { isValidator, loading } = useAuth();
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
      <header className="border-b border-slate-200 pb-3 dark:border-slate-800">
        <h1 className="font-serif text-3xl font-medium tracking-tight text-slate-900 dark:text-slate-50">VisuaLex Gymnasium</h1>
      </header>
      <Outlet context={{ validator: loading ? undefined : isValidator } satisfies StudiaOutletContext} />
    </div>
  );
}
