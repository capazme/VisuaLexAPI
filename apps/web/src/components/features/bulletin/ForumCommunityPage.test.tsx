import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('says the area is coming, with no second title, no sample posts and no counts', () => {
    const { container } = renderPage();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByText('Domande e discussioni tra colleghi, in arrivo.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('leads to the public dossiers through a link of 44 px', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Apri i dossier pubblici' });
    expect(link).toHaveAttribute('href', '/forum');
    expect(link).toHaveClass('min-h-[44px]', 'focus-visible:ring-2');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('neither clears the Forum\'s count nor starts its tour', () => {
    renderPage();
    expect(forum.markRead).not.toHaveBeenCalled();
    expect(forum.tryStartTour).not.toHaveBeenCalled();
  });
});
