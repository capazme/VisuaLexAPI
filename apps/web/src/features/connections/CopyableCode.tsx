import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';

type CopyState = 'idle' | 'copied' | 'failed';

export interface CopyableCodeProps {
  /** The exact text copied, shown as it is. */
  code: string;
  /** What the text is, for the button's accessible name («Copia il comando per Claude Code»). */
  label: string;
  /** A one-line command or a multi-line file. */
  block?: boolean;
}

/**
 * A command or a configuration snippet with its «Copia» button. The text on screen is the text copied,
 * character for character. A refused clipboard (an insecure page, a denied permission) says so and leaves
 * the text selectable by hand.
 */
export function CopyableCode({ code, label, block = false }: CopyableCodeProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
      timer.current = window.setTimeout(() => setState('idle'), 2500);
    } catch (error: unknown) {
      // Stays until the next try: the reader needs time to select the text by hand.
      console.warn('[CopyableCode] clipboard refused', error);
      setState('failed');
    }
  };

  return (
    <div>
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
        <code
          className={cn(
            'min-w-0 flex-1 self-center font-mono text-xs text-slate-800 dark:text-slate-100',
            block ? 'whitespace-pre overflow-x-auto' : 'break-all',
          )}
        >
          {code}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copia ${label}`}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-md bg-white px-2 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:py-1 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700"
        >
          {state === 'copied' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {state === 'copied' ? 'Copiato' : 'Copia'}
        </button>
      </div>
      <p role="status" className={cn('mt-1 text-xs', state === 'failed' ? 'text-red-600 dark:text-red-400' : 'sr-only')}>
        {state === 'copied' ? 'Copiato negli appunti' : state === 'failed' ? 'Copia non riuscita: seleziona il testo e copialo a mano.' : ''}
      </p>
    </div>
  );
}
