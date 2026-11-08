import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StudyModeHeader } from './StudyModeHeader';
import { appStore } from '../../../../store/useAppStore';

describe('StudyModeHeader — the highlighter (H1, A4)', () => {
  afterEach(() => {
    appStore.setState((s) => ({ readingTool: null, settings: { ...s.settings, highlightColor: 'yellow' } }));
  });

  it('is chosen here too, as in the reading bar', () => {
    render(
      <StudyModeHeader
        visible
        article={{ article_text: 'x', norma_data: { tipo_atto: 'codice civile', numero_articolo: '1453' } } as never}
        normaLabel="Codice civile"
        currentIndex={0}
        totalArticles={1}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onToggleSettings={vi.fn()}
        onBookmark={vi.fn()}
        isBookmarked={false}
        theme="light"
        onThemeChange={vi.fn()}
      />,
    );
    // An icon alone: its words in a tooltip.
    expect(screen.getByRole('button', { name: 'Evidenziatore (giallo)' })).toHaveAttribute('title', expect.stringMatching(/^Evidenziatore \(giallo\): /));
    fireEvent.click(screen.getByRole('button', { name: 'Colore dell’evidenziatore' }));
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[2]);
    expect(appStore.getState().settings.highlightColor).toBe('red');
    expect(screen.getByRole('button', { name: 'Evidenziatore (rosso)' })).toHaveAttribute('aria-pressed', 'true');
    // Its header has a gear already (Study Mode's own settings, which hold the way to the meanings): no second one.
    expect(screen.queryByRole('button', { name: 'Cambia il significato dei colori' })).toBeNull();
  });
});
