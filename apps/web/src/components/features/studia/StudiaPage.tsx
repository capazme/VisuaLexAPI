import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { useAuth } from '../../../hooks/useAuth';

// The views of the area; «Ripasso» joins this list with its PR.
const MY_CARDS = { to: 'schede', label: 'Le mie schede' };
// Only for the people the administrator named validators; the server checks it again on every call.
const TO_VALIDATE = { to: 'valida', label: 'Da validare' };

/**
 * VisuaLex Studia: the area's heading, the links to its views, and the view itself. The layout
 * already pads the page; below `lg` its fixed menu button sits over the top-left corner, so the
 * heading starts to its right. «Da validare» is offered to validators only.
 */
/** What the area tells its views; `validator` is undefined while the account is still loading. */
export interface StudiaOutletContext {
  validator: boolean | undefined;
}

export function StudiaPage() {
  const { isValidator, loading } = useAuth();
  const views = isValidator ? [MY_CARDS, TO_VALIDATE] : [MY_CARDS];
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
      <header className="border-b border-slate-200 pb-3 dark:border-slate-800">
        <h1 className="pl-12 text-xl font-bold text-slate-900 lg:pl-0 md:text-2xl dark:text-white">VisuaLex Studia</h1>
        <nav aria-label="Studia" className="mt-3 flex gap-1">
          {views.map((view) => (
            <NavLink
              key={view.to}
              to={view.to}
              className={({ isActive }) =>
                cn(
                  'inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:py-1.5',
                  isActive
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )
              }
            >
              {view.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet context={{ validator: loading ? undefined : isValidator } satisfies StudiaOutletContext} />
    </div>
  );
}
