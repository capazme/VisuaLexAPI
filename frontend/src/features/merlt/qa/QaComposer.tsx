import { useState } from 'react';
import { Send } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/Button';
import type { QaMode } from './types';

/**
 * Q&A input: a question textarea + convergent/divergent mode toggle.
 * Cmd/Ctrl+Enter submits. Empty/whitespace is ignored; clears on submit.
 */
export interface QaComposerProps {
  onSubmit: (query: string, mode: QaMode) => void;
  disabled: boolean;
}

export function QaComposer({ onSubmit, disabled }: QaComposerProps) {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<QaMode>('convergent');

  const submit = (): void => {
    const q = value.trim();
    if (!q || disabled) return;
    onSubmit(q, mode);
    setValue('');
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder="Poni una domanda giuridica… (es. «requisiti della risoluzione per inadempimento, art. 1453 c.c.»)"
        className="w-full resize-none rounded-lg border-0 bg-transparent p-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-white"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <div
          role="radiogroup"
          aria-label="Modalità di risposta"
          className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs dark:border-slate-700"
        >
          {(['convergent', 'divergent'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-3 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                mode === m
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {m === 'convergent' ? 'Sintesi' : 'Tesi a confronto'}
            </button>
          ))}
        </div>
        <Button onClick={submit} disabled={disabled || !value.trim()} size="sm">
          <Send size={15} className="mr-1.5" /> Chiedi
        </Button>
      </div>
    </div>
  );
}
