import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ForumCommunityPage } from './ForumCommunityPage';
import { FORUM_TITLE } from '../../../features/sections/sections';

function renderPage() {
  return render(
    <MemoryRouter>
      <ForumCommunityPage />
    </MemoryRouter>,
  );
}

// An honest placeholder (F1): it says what is coming and shows nothing that is not there.
describe('ForumCommunityPage', () => {
  it('carries the Forum\'s title with its phrase, from the one constant', () => {
    renderPage();
    expect(FORUM_TITLE).toBe('Forum: la tua piazza giuridica');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(FORUM_TITLE);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('names the area and says it is coming, with no sample posts and no counts', () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 2, name: 'Community' })).toBeInTheDocument();
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
});
