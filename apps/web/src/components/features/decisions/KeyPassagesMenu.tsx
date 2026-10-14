import { useState } from 'react';
import { Eye, EyeOff, ListChecks } from 'lucide-react';
import { MenuButton, type MenuItem } from '../../ui/MenuButton';
import { Sheet } from '../../ui/Sheet';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { keyPassageEntryLabels, type KeyPassage } from '../../../utils/decisionKeyPassages';
import { toolbarToggleClass } from '../search/toolbarToggle';

export interface KeyPassagesMenuProps {
  passages: readonly KeyPassage[];
  /** The projection the passages are ranges of: an entry quotes its passage's first words. */
  plain: string;
  shown: boolean;
  onToggleShown: () => void;
  /** Take the reader to passage `index` (and offer what can be done with it). */
  onGoTo: (index: number) => void;
}

const LEGEND = 'Evidenziati automaticamente: non sono le tue evidenziazioni.';
const SHEET_ENTRY =
  'flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800';

/**
 * «Passaggi chiave (n)» in the decision's toolbar (spec 2026-10-13-decision-key-passages-design,
 * «What the reader sees» 2): the legend, one entry per passage that takes the reader to it, and the
 * switch, remembered in the browser's settings. Drawn only when the decision has passages. On the
 * desktop a menu (`MenuButton`); on a phone, where the bar wraps and a list beside its button would
 * leave the screen, a bottom sheet (`ui/Sheet`).
 */
export function KeyPassagesMenu({ passages, plain, shown, onToggleShown, onGoTo }: KeyPassagesMenuProps) {
  const desktop = useIsDesktop();
  const [sheetOpen, setSheetOpen] = useState(false);
  if (passages.length === 0) return null;
  const labels = keyPassageEntryLabels(passages, plain);
  const name = `Passaggi chiave (${passages.length}), evidenziati automaticamente`;
  const trigger = (
    <>
      <ListChecks size={18} aria-hidden />
      <span className="text-xs font-medium tabular-nums">{passages.length}</span>
    </>
  );

  if (!desktop) {
    // after the sheet has closed and given the focus back to its button, which would otherwise stop
    // the scroll to the passage halfway
    const choose = (act: () => void) => {
      setSheetOpen(false);
      window.setTimeout(act, 0);
    };
    return (
      <>
        <button
          type="button"
          aria-label={name}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
          className={toolbarToggleClass(shown, 'gap-2')}
        >
          {trigger}
        </button>
        {sheetOpen && (
          <Sheet title="Passaggi chiave" onClose={() => setSheetOpen(false)} closeOnEscape closeOnBackdrop>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
              <p className="px-3 pb-2 text-xs text-slate-500 dark:text-slate-400">{LEGEND}</p>
              {labels.map((label, index) => (
                <button key={label} type="button" disabled={!shown} className={SHEET_ENTRY} onClick={() => choose(() => onGoTo(index))}>
                  {label}
                </button>
              ))}
              <div className="my-1 border-t border-slate-200 dark:border-slate-700" aria-hidden />
              <button type="button" className={SHEET_ENTRY} onClick={() => choose(onToggleShown)}>
                {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                {shown ? 'Nascondi i passaggi chiave' : 'Mostra i passaggi chiave'}
              </button>
            </div>
          </Sheet>
        )}
      </>
    );
  }

  const items: MenuItem[] = [
    ...labels.map((label, index) => ({ label, onSelect: () => onGoTo(index), disabled: !shown })),
    {
      label: shown ? 'Nascondi i passaggi chiave' : 'Mostra i passaggi chiave',
      icon: shown ? EyeOff : Eye,
      onSelect: onToggleShown,
      separatorBefore: true,
    },
  ];
  return (
    <MenuButton
      label={name}
      heading={LEGEND}
      items={items}
      menuClassName="w-80 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto"
      triggerClassName={toolbarToggleClass(shown)}
    >
      {trigger}
    </MenuButton>
  );
}
