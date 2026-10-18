import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharedEnvironmentCard } from './SharedEnvironmentCard';
import type { SharedEnvironment } from '../../../types';

const base: SharedEnvironment = {
  id: 'env-1',
  title: 'Ricorso Rossi',
  description: 'Dossier di prova',
  content: {} as SharedEnvironment['content'],
  category: 'civil',
  tags: [],
  includeNotes: false,
  includeHighlights: false,
  viewCount: 0,
  downloadCount: 0,
  likeCount: 0,
  currentVersion: 1,
  isActive: true,
  user: { id: 'u1', username: 'autore', displayName: 'Autore' } as SharedEnvironment['user'],
  userLiked: false,
  isOwner: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const renderCard = (env: SharedEnvironment, onImport = vi.fn()) =>
  render(
    <SharedEnvironmentCard
      environment={env}
      onLike={vi.fn()}
      onImport={onImport}
      onReport={vi.fn()}
    />,
  );

describe('SharedEnvironmentCard «Ai miei dossier»', () => {
  it('offers «Ai miei dossier» on someone else’s card and passes the card on', async () => {
    const onImport = vi.fn();
    renderCard(base, onImport);
    await userEvent.click(screen.getByRole('button', { name: /Aggiungi «Ricorso Rossi» ai miei dossier/ }));
    expect(onImport).toHaveBeenCalledWith(base);
  });

  it('does not offer «Ai miei dossier» on the user’s own published card', () => {
    renderCard({ ...base, isOwner: true });
    expect(screen.queryByRole('button', { name: /ai miei dossier/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Ai miei dossier')).not.toBeInTheDocument();
  });
});
