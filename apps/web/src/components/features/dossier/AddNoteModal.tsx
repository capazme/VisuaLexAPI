import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { StickyNote, X } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSave: (text: string) => void;
}

const MAX_NOTE_LENGTH = 2000;

export function AddNoteModal({ onClose, onSave }: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSave(trimmed);
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const trimmedLength = text.trim().length;
  const isEmpty = trimmedLength === 0;
  const remaining = MAX_NOTE_LENGTH - text.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <StickyNote size={20} className="text-yellow-500" />
            Aggiungi una nota al dossier
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-2">
          <label htmlFor="dossier-note-text" className="sr-only">Testo della nota</label>
          <textarea
            id="dossier-note-text"
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
            onKeyDown={handleKeyDown}
            rows={6}
            placeholder="Scrivi un appunto, una riflessione o un promemoria da allegare al dossier…"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 resize-y min-h-32 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          <div className="flex justify-between text-xs text-slate-400">
            <span>⌘/Ctrl + Invio per salvare</span>
            <span className={remaining < 100 ? 'text-amber-500' : undefined}>
              {remaining} caratteri rimanenti
            </span>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isEmpty}
            className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2"
          >
            Aggiungi al dossier
          </button>
        </div>
      </div>
    </div>
  );
}
