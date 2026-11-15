import { FlaskConical } from 'lucide-react';

/** Every Labs address with MERL-T off on this server (`VITE_FEATURE_MERLT`): one page, the hub's words (#462). */
export function LabsOff() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
      <FlaskConical size={40} aria-hidden className="mb-3 text-slate-500 dark:text-slate-400" />
      <p className="text-slate-600 dark:text-slate-300">Gli strumenti di Labs non sono accesi su questo server. Ricerca, Work, Learn e Forum funzionano come sempre.</p>
    </div>
  );
}
