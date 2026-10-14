import type { DossierKind } from '../../../types';
import { cn } from '../../../lib/utils';
import { DOSSIER_KINDS } from './dossierKinds';

interface Props {
  value: DossierKind;
  onChange: (kind: DossierKind) => void;
  disabled?: boolean;
}

/** A radio group of the two kinds, 44 px targets on a phone. */
export function DossierKindChoice({ value, onChange, disabled }: Props) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Tipo di dossier</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {DOSSIER_KINDS.map(({ kind, label, hint, icon: Icon }) => (
          <label
            key={kind}
            className={cn(
              'flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500',
              value === kind
                ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30'
                : 'border-slate-300 hover:border-slate-400 dark:border-slate-600 dark:hover:border-slate-500',
            )}
          >
            <input
              type="radio"
              name="dossier-kind"
              value={kind}
              checked={value === kind}
              onChange={() => onChange(kind)}
              className="sr-only"
            />
            <Icon size={18} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
            <span>
              <span className="block font-medium text-slate-900 dark:text-white">{label}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
