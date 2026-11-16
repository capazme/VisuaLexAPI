import { RotateCw } from 'lucide-react';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { Button } from '../../ui/Button';
import type { RowTextState } from './useRowText';

/** In a bound row's text's place while it comes, or after it failed (LC54): said in words, with «Riprova». */
export function RowTextStatus({ state, onRetry }: { state: Exclude<RowTextState, null>; onRetry: () => void }) {
  if (state === 'loading') {
    return <p role="status" className="py-3 text-sm text-slate-600 dark:text-slate-400">Carico il testo…</p>;
  }
  return (
    <div role="alert" className="py-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">Non riesco a leggere il testo.</p>
      <div className="mt-2">
        <Button variant="secondary" size="sm" icon={<RotateCw size={16} />} className={TOUCH_TARGET_RESPONSIVE} onClick={onRetry}>
          Riprova
        </Button>
      </div>
    </div>
  );
}
