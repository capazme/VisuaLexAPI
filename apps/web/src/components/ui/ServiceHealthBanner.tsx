import { useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, RefreshCw, ServerCrash, TriangleAlert } from 'lucide-react';
import { useServiceHealth } from '../../hooks/useServiceHealth';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';

/** `className` lets a page hide the pill where it would cover its own controls (a bar pinned to the bottom on a phone). */
export function ServiceHealthBanner({ className }: { className?: string }) {
  const { snapshot, refresh } = useServiceHealth();
  const [expanded, setExpanded] = useState(false);
  const isHealthy = snapshot.overall === 'online';
  const Icon = snapshot.overall === 'checking' ? Loader2 : snapshot.overall === 'offline' ? ServerCrash : snapshot.overall === 'degraded' ? TriangleAlert : CheckCircle2;
  const label = snapshot.overall === 'online' ? 'Servizi operativi' : snapshot.overall === 'degraded' ? 'Alcune fonti non disponibili' : snapshot.overall === 'offline' ? 'Servizio non raggiungibile' : 'Controllo servizi…';

  return <div className={cn('fixed bottom-3 left-3 lg:left-24 max-w-sm', Z_INDEX.floating, ' rounded-2xl border bg-white shadow-md dark:bg-slate-900', isHealthy ? 'border-slate-200 dark:border-slate-700' : 'border-amber-300 dark:border-amber-800/60', className)}>
    <button type="button" onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-2 rounded-2xl px-3.5 py-2 text-left text-xs font-medium text-slate-600 dark:text-slate-300"><Icon size={15} className={cn(snapshot.overall === 'checking' && 'animate-spin', isHealthy ? 'text-emerald-500' : 'text-amber-500')} /><span>{label}</span><ChevronDown size={14} className={cn('ml-auto text-slate-400 transition-transform', expanded && 'rotate-180')} /></button>
    {expanded && <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800"><div className="space-y-1.5">{snapshot.services.map(service => <div key={service.name} className="flex items-center justify-between gap-4 text-xs"><span className="text-slate-500 dark:text-slate-400">{service.name}</span><span className={cn('font-medium', service.state === 'online' ? 'text-emerald-600' : service.state === 'checking' ? 'text-slate-400' : 'text-amber-600')}>{service.state === 'online' ? 'OK' : service.state === 'degraded' ? 'Degradato' : service.state === 'offline' ? 'Offline' : 'Controllo'}{service.latencyMs !== undefined ? ` · ${service.latencyMs} ms` : ''}</span></div>)}</div><button type="button" onClick={() => void refresh()} className="mt-2 inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"><RefreshCw size={12} /> Ricontrolla</button></div>}
  </div>;
}
