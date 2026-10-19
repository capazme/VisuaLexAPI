import { useId, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, RefreshCw, ServerCrash, TriangleAlert } from 'lucide-react';
import type { ServiceHealthReading } from '../../hooks/useServiceHealth';
import type { ServiceHealthState } from '../../services/healthService';
import { cn } from '../../lib/utils';
import { serviceHealthLabel } from '../../utils/serviceHealth';

const SERVICE_STATES: Record<ServiceHealthState, string> = {
  online: 'OK',
  degraded: 'Degradato',
  offline: 'Offline',
  checking: 'Controllo',
};

/**
 * The amber dot on the user button (and on a phone the drawer's) when `serviceHealthNeedsNotice`: amber 600 / dark
 * amber 400, 3:1 on the bar (a graphic, WCAG 1.4.11; `theme.test.ts`), its ring keeping it apart from the avatar;
 * the button's name says it in words.
 */
export function ServiceHealthDot({ className }: { className?: string }) {
  return <span aria-hidden data-service-health-dot className={cn('h-2.5 w-2.5 rounded-full bg-amber-600 ring-2 ring-white dark:bg-amber-400 dark:ring-slate-900', className)} />;
}

/**
 * The user menu's «Stato dei servizi» (it was the pill fixed at the bottom left): an entry with the status icon and
 * phrase that opens, inside the menu, the services with their state and latency and «Ricontrolla». Every row is a
 * `menuitem`, so the menu's arrows reach them; a service row is `aria-disabled`, read and never acted on. The
 * probe is `Layout`'s (`useServiceHealth`, one for both copies of the sidebar), which keeps running with the
 * menu closed; the menu unmounts when it closes, so it opens again folded.
 */
export function ServiceHealthMenuEntry({ health, itemClassName }: { health: ServiceHealthReading; itemClassName: string }) {
  const { snapshot, refresh } = health;
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const isHealthy = snapshot.overall === 'online';
  const Icon = snapshot.overall === 'checking' ? Loader2 : snapshot.overall === 'offline' ? ServerCrash : snapshot.overall === 'degraded' ? TriangleAlert : CheckCircle2;

  return <>
    <button type="button" role="menuitem" tabIndex={-1} aria-expanded={expanded} aria-controls={expanded ? listId : undefined} onClick={() => setExpanded(value => !value)} className={itemClassName}>
      <Icon size={16} aria-hidden className={cn('shrink-0', snapshot.overall === 'checking' && 'motion-safe:animate-spin', isHealthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')} />
      <span className="flex-1 text-left">{serviceHealthLabel(snapshot.overall)}</span>
      <ChevronDown size={14} aria-hidden className={cn('shrink-0 text-slate-500 dark:text-slate-400 motion-safe:transition-transform', expanded && 'rotate-180')} />
    </button>
    {expanded && <div id={listId} role="group" aria-label="Stato dei servizi">
      {snapshot.services.map(service => <div key={service.name} role="menuitem" tabIndex={-1} aria-disabled="true" className="flex min-h-[44px] md:min-h-0 flex-col justify-center py-1.5 pl-11 pr-4 text-xs focus-visible:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700">
        <span className="text-slate-600 dark:text-slate-300">{service.name}</span>
        <span className={cn('font-medium', service.state === 'online' ? 'text-emerald-700 dark:text-emerald-400' : service.state === 'checking' ? 'text-slate-500 dark:text-slate-400' : 'text-amber-700 dark:text-amber-400')}>{SERVICE_STATES[service.state]}{service.latencyMs !== undefined ? ` · ${service.latencyMs} ms` : ''}</span>
      </div>)}
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => void refresh()} className={cn(itemClassName, 'pl-11 text-primary-700 dark:text-primary-300')}><RefreshCw size={14} aria-hidden className="shrink-0" /> Ricontrolla</button>
    </div>}
  </>;
}
