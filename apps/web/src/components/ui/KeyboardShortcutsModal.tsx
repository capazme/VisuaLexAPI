import { Modal } from './Modal';
import { Command, Keyboard } from 'lucide-react';
import { cn } from '../../lib/utils';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutItem[];
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? 'Cmd' : 'Ctrl';

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'Navigazione',
    shortcuts: [
      { keys: [modKey, 'K'], description: 'Apri Command Palette' },
      { keys: [modKey, 'F'], description: 'Cerca negli articoli aperti' },
      { keys: [modKey, 'B'], description: 'Toggle Sidebar' },
      { keys: [modKey, 'D'], description: 'Vai ai Dossier' },
      { keys: [modKey, 'Shift', 'S'], description: 'Toggle Pannello Ricerca' },
    ],
  },
  {
    title: 'Visualizzazione',
    shortcuts: [
      { keys: [modKey, 'Space'], description: 'Toggle Focus Mode' },
      { keys: ['Esc'], description: 'Chiudi modal/pannello' },
    ],
  },
  {
    title: 'Ricerca',
    shortcuts: [
      { keys: ['Enter'], description: 'Esegui ricerca' },
      { keys: [modKey, 'Enter'], description: 'Ricerca con Brocardi' },
    ],
  },
  {
    title: 'Articoli',
    shortcuts: [
      { keys: ['←', '→'], description: 'Articolo precedente/successivo' },
      { keys: [modKey, 'C'], description: 'Copia articolo' },
    ],
  },
];

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-[24px] h-6 px-1.5',
        'text-xs font-medium',
        'bg-slate-100 dark:bg-slate-800',
        'border border-slate-300 dark:border-slate-600',
        'rounded shadow-sm',
        'text-slate-700 dark:text-slate-300'
      )}
    >
      {children}
    </kbd>
  );
}

function ShortcutRow({ shortcut }: { shortcut: ShortcutItem }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-600 dark:text-slate-400">
        {shortcut.description}
      </span>
      <div className="flex items-center gap-1">
        {shortcut.keys.map((key, index) => (
          <span key={index} className="flex items-center gap-1">
            <KeyBadge>{key}</KeyBadge>
            {index < shortcut.keys.length - 1 && (
              <span className="text-slate-400 text-xs">+</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Scorciatoie da Tastiera" size="md">
      <div className="space-y-6">
        {/* Header info */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-900/30">
          <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
            <Keyboard size={20} className="text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-primary-900 dark:text-primary-100">
              Usa le scorciatoie per navigare velocemente
            </p>
            <p className="text-xs text-primary-600 dark:text-primary-400">
              Premi <KeyBadge>{modKey}</KeyBadge> + <KeyBadge>K</KeyBadge> per la Command Palette
            </p>
          </div>
        </div>

        {/* Shortcut groups */}
        <div className="space-y-4">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                {group.title}
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {group.shortcuts.map((shortcut, index) => (
                  <ShortcutRow key={index} shortcut={shortcut} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer tip */}
        <div className="flex items-center gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
          <Command size={14} className="text-slate-400" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Premi <KeyBadge>?</KeyBadge> in qualsiasi momento per mostrare questa guida
          </p>
        </div>
      </div>
    </Modal>
  );
}
