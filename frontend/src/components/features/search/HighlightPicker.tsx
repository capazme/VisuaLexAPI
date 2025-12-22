import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../../lib/utils';

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple';

interface HighlightPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectColor: (color: HighlightColor) => void;
  selectedColor?: HighlightColor;
  position?: { top: number; left: number };
}

const COLORS: { value: HighlightColor; label: string; bg: string; text: string }[] = [
  { value: 'yellow', label: 'Giallo', bg: 'bg-yellow-200 dark:bg-yellow-700', text: 'text-yellow-900 dark:text-yellow-100' },
  { value: 'green', label: 'Verde', bg: 'bg-green-200 dark:bg-green-700', text: 'text-green-900 dark:text-green-100' },
  { value: 'blue', label: 'Blu', bg: 'bg-blue-200 dark:bg-blue-700', text: 'text-blue-900 dark:text-blue-100' },
  { value: 'red', label: 'Rosso', bg: 'bg-red-200 dark:bg-red-700', text: 'text-red-900 dark:text-red-100' },
  { value: 'purple', label: 'Viola', bg: 'bg-purple-200 dark:bg-purple-700', text: 'text-purple-900 dark:text-purple-100' },
];

export function HighlightPicker({
  isOpen,
  onClose,
  onSelectColor,
  selectedColor = 'yellow',
  position,
}: HighlightPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = (color: HighlightColor) => {
    onSelectColor(color);
    onClose();
  };

  const style = position
    ? { top: `${position.top}px`, left: `${position.left}px` }
    : undefined;

  return (
    <div
      ref={pickerRef}
      className="absolute z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl p-2 animate-in fade-in zoom-in-95 duration-200"
      style={style}
    >
      <div className="flex flex-col gap-1">
        <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          Colore evidenziatore
        </div>
        {COLORS.map((color) => (
          <button
            key={color.value}
            onClick={() => handleSelect(color.value)}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 group",
              selectedColor === color.value && "bg-slate-100 dark:bg-slate-800"
            )}
          >
            <div
              className={cn(
                "w-6 h-6 rounded-md ring-1 ring-slate-300 dark:ring-slate-600",
                color.bg
              )}
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex-1 text-left">
              {color.label}
            </span>
            {selectedColor === color.value && (
              <Check size={16} className="text-blue-600 dark:text-blue-400" />
            )}
          </button>
        ))}
      </div>

      {/* Keyboard hint */}
      <div className="mt-2 px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800">
        <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-xs">Esc</kbd> per chiudere
      </div>
    </div>
  );
}
