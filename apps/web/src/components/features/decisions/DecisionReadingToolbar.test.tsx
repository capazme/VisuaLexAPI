import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DecisionReadingToolbar } from './DecisionReadingToolbar';

describe('DecisionReadingToolbar', () => {
  it('is marked as pinned at the top of its column, so the find window opens under it (spec §4.4)', () => {
    const { container } = render(
      <DecisionReadingToolbar
        notesCount={0} highlightsCount={0} isNotesOpen={false} isHighlightsOpen={false}
        onToggleNotes={vi.fn()} onToggleHighlights={vi.fn()} onToggleDiscussion={vi.fn()}
        isFindOpen={false} onToggleFind={vi.fn()}
      />,
    );
    const bar = container.firstElementChild as HTMLElement;
    expect(bar).toHaveAttribute('data-pinned-head');
    expect(bar).toHaveClass('sticky', 'top-0');
  });

  it('draws «Cerca nel testo» only for a reading place the find window can search (none in the dossier, D7a)', () => {
    const props = {
      notesCount: 0, highlightsCount: 0, isNotesOpen: false, isHighlightsOpen: false,
      onToggleNotes: vi.fn(), onToggleHighlights: vi.fn(), onToggleDiscussion: vi.fn(),
    };
    const { unmount } = render(<DecisionReadingToolbar {...props} isFindOpen={false} onToggleFind={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Cerca nel testo/ })).toBeInTheDocument();
    unmount();
    render(<DecisionReadingToolbar {...props} />);
    expect(screen.queryByRole('button', { name: /Cerca nel testo/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Glosse sulla decisione/ })).toBeInTheDocument();
  });

  it('has the colour\'s gear to the colours\' meanings, 44 px on a phone, as the article\'s bar', () => {
    render(
      <DecisionReadingToolbar
        notesCount={0} highlightsCount={0} isNotesOpen={false} isHighlightsOpen={false}
        onToggleNotes={vi.fn()} onToggleHighlights={vi.fn()} onToggleDiscussion={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cambia il significato dei colori' })).toHaveClass('min-h-[44px]', 'min-w-[44px]');
  });
});
