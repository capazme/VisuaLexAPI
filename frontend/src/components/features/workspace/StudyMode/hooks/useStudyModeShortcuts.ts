import { useEffect, useCallback } from 'react';

interface StudyModeHandlers {
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onFontSize: (delta: number) => void;
  onToggleBrocardi: () => void;
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
        } else {
          // B = Brocardi panel
          e.preventDefault();
          handlers.onToggleBrocardi();
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
  { key: 'B', label: 'Brocardi' },
  { key: 'T', label: 'Tools' },
  { key: 'S', label: 'Settings' },
  { key: 'N', label: 'Nota' },
  { key: '1/2/3', label: 'Tema' },
  { key: '⌘B', label: 'Segnalibro' },
] as const;
