import { useState } from 'react';
import { Send } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/Button';
import type { QaMode } from './types';

/**
 * Q&A input: a question textarea + convergent/divergent mode toggle.
 * Cmd/Ctrl+Enter submits. Empty/whitespace is ignored; clears on submit.
 *
 * `prefill` seeds the textarea from an external source (the "Chiedi su questo
 * articolo" in-article entry, via QAPage's location.state read). It is a
 * `{ text, token }` pair so a new prefill — even with the same text — re-seeds
 * the field; the seeding is derived during render via a prev-input tracker
 * (react-hooks/set-state-in-effect), never an in-effect setState.
 */
export interface QaComposerProps {
  onSubmit: (query: string, mode: QaMode) => void;
  disabled: boolean;
  prefill?: { text: string; token: number };
}

export function QaComposer({ onSubmit, disabled, prefill }: QaComposerProps) {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<QaMode>('convergent');
  const [prefillToken, setPrefillToken] = useState<number | undefined>(undefined);

  // Seed the field when a new prefill arrives. Derived during render (gotcha #11).
  if (prefill && prefill.token !== prefillToken) {
    setPrefillToken(prefill.token);
    setValue(prefill.text);
  }

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
