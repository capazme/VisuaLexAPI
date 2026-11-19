import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';
import { ReaderSpace } from '../features/search/ReaderSpace';

interface CopyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCopy: (options: CopyOptions) => void;
  hasNotes: boolean;
  hasHighlights: boolean;
  canCopyNorma?: boolean;
}

export interface CopyOptions {
  includeText: boolean;
  includeCitation: boolean;
  includeNotes: boolean;
  includeHighlights: boolean;
  scope: 'article' | 'norma';
}

export function CopyModal({
  isOpen,
  onClose,
  onCopy,
  hasNotes,
  hasHighlights,
  canCopyNorma = false,
}: CopyModalProps) {
  const [options, setOptions] = useState<CopyOptions>({
    includeText: true,
    includeCitation: true,
    includeNotes: false,
    includeHighlights: false,
    scope: 'article',
  });

  const handleCopy = () => {
    onCopy(options);
    onClose();
  };

  const disabled =
    !options.includeText &&
    !options.includeCitation &&
    !options.includeNotes &&
    !options.includeHighlights;

  // In the page under the toolbar since LC139 (L-73; it was a window): Esc and «Chiudi» close it, the focus back on «⋯».
  return (
    <ReaderSpace open={isOpen} onClose={onClose} title="Copia contenuto" icon={<Copy size={16} aria-hidden className="shrink-0" />} className="max-w-md">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase mb-3">Contenuto</p>
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-[8px] p-1 space-y-1">
            <CheckboxRow
              checked={options.includeText}
              onChange={(v) => setOptions({ ...options, includeText: v })}
              label="Testo articolo"
              description="Include il testo completo dell'articolo"
            />
            <CheckboxRow
              checked={options.includeCitation}
              onChange={(v) => setOptions({ ...options, includeCitation: v })}
              label="Citazione"
              description="Riferimento normativo formale"
            />
            <CheckboxRow
              checked={options.includeNotes}
              onChange={(v) => setOptions({ ...options, includeNotes: v })}
              disabled={!hasNotes}
              label={
                <>
                  Note personali {!hasNotes && <span className="text-slate-400">(nessuna)</span>}
                </>
              }
              description="Include le tue annotazioni"
            />
            <CheckboxRow
              checked={options.includeHighlights}
              onChange={(v) => setOptions({ ...options, includeHighlights: v })}
              disabled={!hasHighlights}
              label={
                <>
                  Evidenziazioni {!hasHighlights && <span className="text-slate-400">(nessuna)</span>}
                </>
              }
              description="Include le parti evidenziate"
            />
          </div>
        </div>

        {canCopyNorma && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase mb-3">Ambito</p>
            <div className="bg-primary-50 dark:bg-primary-900/20 rounded-[8px] p-1 space-y-1">
              <RadioRow
                name="scope"
                checked={options.scope === 'article'}
                onChange={() => setOptions({ ...options, scope: 'article' })}
                label="Solo questo articolo"
              />
              <RadioRow
                name="scope"
                checked={options.scope === 'norma'}
                onChange={() => setOptions({ ...options, scope: 'norma' })}
                label="Tutti gli articoli della norma"
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>Annulla</Button>
          <Button variant="primary" onClick={handleCopy} disabled={disabled}>
            <Copy size={16} aria-hidden />
            Copia
          </Button>
        </div>
      </div>
    </ReaderSpace>
  );
}

interface CheckboxRowProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: React.ReactNode;
  description: string;
}

function CheckboxRow({ checked, onChange, disabled = false, label, description }: CheckboxRowProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 p-3 rounded-md transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white dark:hover:bg-slate-800'
      )}
    >
      <div className="relative flex items-center justify-center mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />
        <div
          className={cn(
            'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
            checked
              ? 'bg-primary-600 border-primary-600 dark:bg-toga-400 dark:border-toga-400'
              : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
          )}
        >
          {checked && <Check size={14} className="text-white dark:text-ink-950" />}
        </div>
      </div>
      <div className="flex-1">
        <span className="font-medium text-slate-900 dark:text-white text-sm">{label}</span>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
    </label>
  );
}

interface RadioRowProps {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}

function RadioRow({ name, checked, onChange, label }: RadioRowProps) {
  return (
    <label className="flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors hover:bg-white dark:hover:bg-primary-900/30">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <div
        className={cn(
          'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
          checked ? 'border-primary-600 dark:border-primary-400' : 'border-slate-300 dark:border-slate-600'
        )}
      >
        {checked && <div className="w-2.5 h-2.5 bg-primary-600 dark:bg-primary-400 rounded-full" />}
      </div>
      <span className="text-sm font-medium text-slate-900 dark:text-white">{label}</span>
    </label>
  );
}
