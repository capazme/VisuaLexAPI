import type { ElementType, ReactNode } from 'react';
import { cn } from '../../../lib/utils';

/**
 * Shared shell for every hub-dashboard card (Slice 3, §3.3). Extracted from
 * MerltHubPage so each card component lives in its own file and shares the
 * chrome + status-pill vocabulary (fail-soft is a per-card obligation, D3).
 */

export interface HubCardProps {
  testId: string;
  icon: ElementType;
  title: string;
  /** Optional pill rendered top-right (availability / gated state). */
  pill?: ReactNode;
  children: ReactNode;
}

export function HubCard({ testId, icon: Icon, title, pill, children }: HubCardProps) {
  return (
    <section
      data-testid={testId}
      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
          <Icon size={18} className="text-primary-500" />
          {title}
        </h2>
        {pill}
      </div>
      {children}
    </section>
  );
}

export type PillTone = 'error' | 'gated' | 'ok' | 'muted';

const PILL_TONES: Record<PillTone, string> = {
  error: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  gated: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  muted: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

/** Small status pill for the card header (e.g. "non raggiungibile"). */
export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      data-testid="hub-pill"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        PILL_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
