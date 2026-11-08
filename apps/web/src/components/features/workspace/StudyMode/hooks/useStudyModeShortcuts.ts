import { useEffect, useCallback } from 'react';

interface StudyModeHandlers {
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onFontSize: (delta: number) => void;
  onToggleTools: () => void;
  onToggleSettings: () => void;
  onTheme: (theme: 'light' | 'dark' | 'sepia') => void;
  onBookmark: () => void;
  onNewNote?: () => void;
  onExport?: () => void;
  onToggleFullscreen?: () => void;
}

interface UseStudyModeShortcutsOptions {
  enabled?: boolean;
}

export function useStudyModeShortcuts(
  handlers: StudyModeHandlers,
  options: UseStudyModeShortcutsOptions = {}
) {
  const { enabled = true } = options;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // While a dialog is open over Study Mode (Impostazioni, opened from its settings) the keys are the dialog's: its Esc,
    // its arrows and what is typed in it never close Study Mode or turn the article under it — the focus inside the
    // dialog or not (a click on its words, the 50 ms before its first focus, Safari's click that focuses nothing).
    if (document.querySelector('[aria-modal="true"]')) return;
    // Ignore if typing in input or textarea
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      // Only allow ESC in inputs
      if (e.key === 'Escape') {
        (e.target as HTMLElement).blur();
      }
      return;
    }

    // A key an open menu took (its Esc, its arrows), or any key while one has focus (the colour of new highlights,
    // H1): never Study Mode's too, which would close it or turn the article.
    if (e.defaultPrevented) return;
    if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
    // With text selected, H and N are the selection popup's (highlight it, a note on it), not «previous» and a note.
    if ((e.key === 'h' || e.key === 'n') && window.getSelection()?.toString().trim()) return;

    // Prevent default for our shortcuts
    const isModifier = e.metaKey || e.ctrlKey;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        handlers.onClose();
        break;

      case 'ArrowLeft':
      case 'h':
        if (!isModifier) {
          e.preventDefault();
          handlers.onNavigate('prev');
        }
        break;

      case 'ArrowRight':
      case 'l':
        if (!isModifier) {
          e.preventDefault();
          handlers.onNavigate('next');
        }
        break;

      case '+':
      case '=':
        e.preventDefault();
        handlers.onFontSize(2);
        break;

      case '-':
        if (!isModifier) {
          e.preventDefault();
          handlers.onFontSize(-2);
        }
        break;

      case 'b':
        if (isModifier) {
          // Cmd/Ctrl + B = Bookmark
          e.preventDefault();
          handlers.onBookmark();
        }
        break;

      case 't':
        if (!isModifier) {
          e.preventDefault();
          handlers.onToggleTools();
        }
        break;

      case 's':
        if (!isModifier) {
          e.preventDefault();
          handlers.onToggleSettings();
        }
        break;

      case 'n':
        if (!isModifier && handlers.onNewNote) {
          e.preventDefault();
          handlers.onNewNote();
        }
        break;

      case 'e':
        if (isModifier && handlers.onExport) {
          e.preventDefault();
          handlers.onExport();
        }
        break;

      case '1':
        e.preventDefault();
        handlers.onTheme('light');
        break;

      case '2':
        e.preventDefault();
        handlers.onTheme('sepia');
        break;

      case '3':
        e.preventDefault();
        handlers.onTheme('dark');
        break;

      case 'f':
        if (!isModifier && handlers.onToggleFullscreen) {
          e.preventDefault();
          handlers.onToggleFullscreen();
        }
        break;
    }
  }, [handlers]);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

// Shortcut definitions for displaying hints
export const STUDY_MODE_SHORTCUTS = [
  { key: 'ESC', label: 'Chiudi' },
  { key: '← →', label: 'Naviga' },
  { key: '+ -', label: 'Zoom' },
  { key: 'T', label: 'Tools' },
  { key: 'S', label: 'Settings' },
  { key: 'N', label: 'Nota' },
  { key: '1/2/3', label: 'Tema' },
  { key: '1-4', label: 'Sceglie il colore ed evidenzia (con selezione)' },
  { key: '⌘B', label: 'Segnalibro' },
] as const;
