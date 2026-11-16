import { useState } from 'react';
import { Key, Laptop, Link2, Pause, Play, type LucideIcon } from 'lucide-react';
import { BookMark } from '../../components/ui/BookMark';
import { cn } from '../../lib/utils';

interface Way {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Not in the app yet (D-102 plans it for the desktop app): drawn dashed and said «in arrivo». */
  soon: boolean;
}

/** Only the subscription through MCP works today (this page); the other two are planned, not built. */
const WAYS: Way[] = [
  { id: 'mcp', label: 'Il tuo abbonamento, via MCP', icon: Link2, soon: false },
  { id: 'local', label: 'Un modello sul computer', icon: Laptop, soon: true },
  { id: 'key', label: 'La tua chiave', icon: Key, soon: true },
];

// Where each label sits in the 480x300 drawing, and the line from it to the pill (pill edge last: the pulse flows in).
const LAYOUT: Record<string, { x: number; y: number; w: number; line: string }> = {
  mcp: { x: 130, y: 20, w: 220, line: 'M240 60 V116' },
  local: { x: 20, y: 200, w: 200, line: 'M120 200 L212 148' },
  key: { x: 280, y: 200, w: 180, line: 'M370 200 L268 148' },
};

const summary = `Tre vie per usare l’IA che hai già con LexCraft: ${WAYS.map((w) => `${w.label.toLowerCase()}${w.soon ? ' (in arrivo)' : ''}`).join('; ')}.`;

/**
 * The «three ways» drawing: LexCraft in the middle, one line to each way the user can bring their AI. Ink and stone
 * from the theme, 1 px lines, no glow. From `md` it is the drawing with a slow pulse (a pause button stops it; none
 * under reduced motion); below `md`, a plain vertical list with the same labels.
 */
export function AiWaysDiagram() {
  const [paused, setPaused] = useState(false);
  return (
    // The drawing is the image (its summary the name); the pause button sits beside it, not inside `role="img"`,
    // whose children a screen reader does not reach.
    <figure className="relative rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60">
      <div role="img" aria-label={summary}>
      <svg viewBox="0 0 480 300" className="mx-auto hidden w-full max-w-xl md:block" aria-hidden>
        <circle cx="240" cy="132" r="64" fill="none" className="stroke-slate-300/60 dark:stroke-slate-600/60" strokeWidth="1" />
        <circle cx="240" cy="132" r="120" fill="none" className="stroke-slate-300/60 dark:stroke-slate-600/60" strokeWidth="1" />
        {WAYS.map((way) => (
          <path
            key={way.id}
            d={LAYOUT[way.id].line}
            fill="none"
            strokeWidth="1"
            strokeDasharray={way.soon ? '3 4' : undefined}
            className={way.soon ? 'stroke-slate-300 dark:stroke-slate-600' : 'stroke-slate-500 dark:stroke-slate-400'}
          />
        ))}
        {/* The pulse only on the way that exists. */}
        <path
          d={LAYOUT.mcp.line}
          pathLength="100"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className="vlx-pulse stroke-slate-700 dark:stroke-slate-200"
          style={{ animationPlayState: paused ? 'paused' : 'running' }}
        />
        <rect x="186" y="116" width="108" height="32" rx="16" className="fill-slate-900 dark:fill-slate-50" />
        <g transform="translate(200 122)">
          <BookMark size={20} className="text-white dark:text-slate-900" />
        </g>
        <text x="228" y="137" className="fill-white text-[13px] font-semibold dark:fill-slate-900">
          LexCraft
        </text>
        {WAYS.map((way) => {
          const { x, y, w } = LAYOUT[way.id];
          const Icon = way.icon;
          return (
            <g key={way.id}>
              <rect x={x} y={y} width={w} height="40" rx="8" strokeWidth="1" className="fill-white stroke-slate-300 dark:fill-slate-900 dark:stroke-slate-600" />
              <Icon x={x + 12} y={y + 13} size={14} strokeWidth={1.5} className={way.soon ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200'} />
              <text x={x + 34} y={way.soon ? y + 17 : y + 24} className={cn('text-[12px]', way.soon ? 'fill-slate-500 dark:fill-slate-400' : 'fill-slate-900 dark:fill-slate-50')}>
                {way.label}
              </text>
              {way.soon && (
                <text x={x + 34} y={y + 31} className="fill-slate-500 text-[11px] dark:fill-slate-400">
                  in arrivo
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div aria-hidden className="flex flex-col items-center gap-2 p-4 md:hidden">
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-900 py-1.5 pl-3 pr-4 text-sm font-semibold text-white dark:bg-slate-50 dark:text-slate-900">
          <BookMark size={18} className="text-white dark:text-slate-900" />
          LexCraft
        </span>
        <ul className="w-full space-y-2 border-l border-slate-300 pl-3 dark:border-slate-600">
          {WAYS.map((way) => {
            const Icon = way.icon;
            return (
              <li
                key={way.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm dark:bg-slate-900',
                  way.soon ? 'border-dashed border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400' : 'border-slate-300 text-slate-900 dark:border-slate-600 dark:text-slate-50',
                )}
              >
                <Icon size={16} aria-hidden />
                <span>{way.label}</span>
                {way.soon && <span className="ml-auto text-xs">in arrivo</span>}
              </li>
            );
          })}
        </ul>
      </div>
      </div>

      <button
        type="button"
        aria-pressed={paused}
        aria-label="Ferma l’animazione"
        onClick={() => setPaused((p) => !p)}
        className="absolute bottom-1 right-1 hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 motion-reduce:hidden md:inline-flex dark:text-slate-300 dark:hover:text-white"
      >
        {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
      </button>
    </figure>
  );
}
