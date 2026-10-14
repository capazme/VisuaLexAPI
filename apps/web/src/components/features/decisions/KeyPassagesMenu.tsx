import { Eye, EyeOff, ListChecks } from 'lucide-react';
import { MenuButton, type MenuItem } from '../../ui/MenuButton';
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

/**
 * «Passaggi chiave (n)» in the decision's toolbar (spec 2026-10-13-decision-key-passages-design,
 * «What the reader sees» 2): the legend, one entry per passage that takes the reader to it, and the
 * switch, remembered in the browser's settings. Drawn only when the decision has passages.
 */
export function KeyPassagesMenu({ passages, plain, shown, onToggleShown, onGoTo }: KeyPassagesMenuProps) {
  if (passages.length === 0) return null;
  const labels = keyPassageEntryLabels(passages, plain);
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
      label={`Passaggi chiave (${passages.length}), evidenziati automaticamente`}
      heading="Evidenziati automaticamente: non sono le tue evidenziazioni."
      items={items}
      menuClassName="w-80 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto"
      triggerClassName={toolbarToggleClass(shown)}
    >
      <ListChecks size={18} aria-hidden />
      <span className="text-xs font-medium tabular-nums">{passages.length}</span>
    </MenuButton>
  );
}
