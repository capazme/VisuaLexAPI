import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StudyModeHeader } from './StudyModeHeader';
import { appStore } from '../../../../store/useAppStore';

describe('StudyModeHeader — the colour of new highlights (H1)', () => {
  afterEach(() => {
    appStore.setState((s) => ({ settings: { ...s.settings, highlightColor: 'yellow' } }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Colore delle evidenziazioni: giallo' }));
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[2]);
    expect(appStore.getState().settings.highlightColor).toBe('red');
  });
});
