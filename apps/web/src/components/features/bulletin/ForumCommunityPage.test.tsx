import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The Forum's count belongs to «Dossier pubblici»: only that page clears it and starts the Forum's tour.
const forum = vi.hoisted(() => ({ markRead: vi.fn(), tryStartTour: vi.fn() }));
vi.mock('../../../services/notificationService', () => ({ notificationService: { markRead: forum.markRead } }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: forum.tryStartTour }) }));

import { ForumCommunityPage } from './ForumCommunityPage';
import { SECTION_PHRASES, sectionKicker } from '../../../features/sections/sections';

function renderPage() {
  return render(
    <MemoryRouter>
      <ForumCommunityPage />
    </MemoryRouter>,
  );
}

// An honest placeholder (F1): it says what is coming and shows nothing that is not there.
describe('ForumCommunityPage', () => {
  it('is titled by its name, the Forum\'s phrase small over it, from the one constant (L-37)', () => {
    renderPage();
    expect(SECTION_PHRASES.forum).toBe('il luogo del dibattito giuridico');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Community$/);
    expect(screen.getByText(sectionKicker('forum'))).toHaveTextContent('Forum · il luogo del dibattito giuridico');
    // Opus's phrase waits for its page.
    expect(screen.queryByText(sectionKicker('opus'))).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('says the discussions are coming, in an empty state composed for the page, with no sample posts and no counts (S7a)', () => {
    const { container } = renderPage();
    const empty = screen.getByRole('region', { name: 'Le discussioni arrivano presto' });
    expect(empty).toHaveClass('mx-auto', 'items-center', 'text-center');
    expect(screen.getByRole('heading', { level: 2, name: 'Le discussioni arrivano presto' })).toHaveClass('font-serif');
    // Two lines on what it will be.
    expect(within(empty).getByText(/domande ai colleghi e discuterai le glosse/)).toBeInTheDocument();
    expect(within(empty).getByText('Per ora il Forum raccoglie i dossier pubblicati dalla comunità.')).toBeInTheDocument();
    // The line art, decorative, in the Forum's hue.
    const drawing = empty.querySelector('svg')!;
    expect(drawing).toHaveAttribute('aria-hidden', 'true');
    expect(drawing.innerHTML).toContain('var(--vlx-section-forum)');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('leads to the public dossiers through one button-like link of 44 px', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Esplora i dossier pubblici' });
    expect(link).toHaveAttribute('href', '/forum');
    expect(link).toHaveClass('min-h-[44px]', 'bg-primary-600', 'focus-visible:ring-2');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('neither clears the Forum\'s count nor starts its tour', () => {
    renderPage();
    expect(forum.markRead).not.toHaveBeenCalled();
    expect(forum.tryStartTour).not.toHaveBeenCalled();
  });
});
