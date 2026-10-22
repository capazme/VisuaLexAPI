import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('names the card’s «⋯» menu and gives it a 44 px touch target on a phone', () => {
    renderCard(base);
    const menu = screen.getByRole('button', { name: 'Azioni su «Ricorso Rossi»' });
    expect(menu).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'md:min-h-0', 'md:min-w-0');
  });

  it('gives «Mi piace» and «Aggiungi ai miei dossier» a 44 px touch target on a phone', () => {
    renderCard(base);
    // 44 px on a phone; on a computer as tall as the action beside it (36 px), not the heart's 18.
    expect(screen.getByRole('button', { name: /Mi piace/ })).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'md:min-h-9');
    expect(screen.getByRole('button', { name: /Aggiungi «Ricorso Rossi» ai miei dossier/ })).toHaveClass('min-h-[44px]', 'md:min-h-0');
  });
});

describe('SharedEnvironmentCard — its tags', () => {
  it('shows them with a capital letter, as typed past the first (D1)', () => {
    renderCard({ ...base, tags: ['appello', 'GDPR'] });
    expect(screen.getByText('Appello')).toBeInTheDocument();
    expect(screen.getByText('GDPR')).toBeInTheDocument();
  });
});

// The card as S7a draws it: the title in Newsreader, one plain line of who and when, two tags at most, «Mi piace» an
// icon with its number, one action, outlined.
describe('SharedEnvironmentCard — its shape (S7a)', () => {
  it('titles it in Newsreader 18 px and says the category, the version, the author and when in one plain line', () => {
    renderCard({ ...base, createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 2 * 86400000).toISOString() });
    const card = screen.getByRole('article', { name: 'Ricorso Rossi' });
    expect(screen.getByRole('heading', { name: 'Ricorso Rossi' })).toHaveClass('font-serif', 'text-lg');
    const line = within(card).getByText('Civile').parentElement!;
    expect(line).toHaveClass('text-sm');
    expect(line.className).not.toMatch(/uppercase/);
    expect(line).toHaveTextContent('Civile· v1· autore· 2 giorni fa');
    // A narrow card wraps it between the parts, never inside one, and cuts a long username.
    expect(line).toHaveClass('flex-wrap');
    expect(within(line).getByTitle('autore')).toHaveClass('truncate', 'min-w-0');
  });

  it('shows two tags at most, then «+N»', () => {
    renderCard({ ...base, tags: ['appello', 'gdpr', 'locazione', 'mora'] });
    const tags = within(screen.getByRole('list', { name: 'Etichette' })).getAllByRole('listitem');
    expect(tags.map((tag) => tag.textContent)).toHaveLength(3);
    expect(tags.slice(0, 2).map((tag) => tag.textContent)).toEqual(['Appello', 'Gdpr']);
    // «+2» to the eye, «e altre 2» to a screen reader.
    expect(within(tags[2]).getByText('+2')).toHaveAttribute('aria-hidden');
    expect(within(tags[2]).getByText('e altre 2')).toHaveClass('sr-only');
  });

  it('draws «Mi piace» as a heart with its number, pressed when liked, and passes the card on', async () => {
    const onLike = vi.fn();
    render(<SharedEnvironmentCard environment={{ ...base, likeCount: 7, userLiked: true }} onLike={onLike} onImport={vi.fn()} onReport={vi.fn()} />);
    const like = screen.getByRole('button', { name: 'Mi piace: 7' });
    expect(like).toHaveAttribute('aria-pressed', 'true');
    expect(like).toHaveTextContent(/^7$/);
    await userEvent.click(like);
    expect(onLike).toHaveBeenCalledWith('env-1');
  });

  it('has one action, outlined, not filled', () => {
    renderCard(base);
    const add = screen.getByRole('button', { name: /Aggiungi «Ricorso Rossi» ai miei dossier/ });
    // «Aggiungi» on a phone, the whole words from sm; the name whole on every width.
    expect(within(add).getByText('Aggiungi', { selector: 'span' })).toHaveClass('sm:hidden');
    expect(within(add).getByText('Aggiungi ai miei dossier')).toHaveClass('hidden', 'sm:inline');
    expect(add).toHaveClass('border', 'border-primary-600');
    expect(add.className).not.toMatch(/bg-primary-600/);
    // Only the like, the action and the «⋯» menu: no counters drawn as bare numbers.
    expect(screen.getAllByRole('button')).toHaveLength(3);
    // Its words are cut rather than pushed out of a narrow card; the like is as tall as it on a computer.
    expect(within(add).getByText('Aggiungi ai miei dossier')).toHaveClass('truncate');
    expect(add).toHaveClass('min-w-0');
    expect(screen.getByRole('button', { name: /Mi piace/ })).toHaveClass('md:min-h-9');
  });

  it('marks a withdrawn card by its dashed edge and its badge, with no opacity that would trap its menu', () => {
    renderCard({ ...base, isActive: false });
    const card = screen.getByRole('article', { name: 'Ricorso Rossi' });
    expect(card).toHaveClass('border-dashed');
    expect(card.className).not.toMatch(/opacity-/);
    expect(within(card).getByText('Ritirato')).toBeInTheDocument();
  });

  it('takes the category\'s hue from its token, not a hand-written colour', () => {
    const { container } = renderCard({ ...base, category: 'penal' });
    const hued = [...container.querySelectorAll<HTMLElement>('[style]')].map((el) => el.style.backgroundColor);
    expect(hued.length).toBeGreaterThan(0);
    for (const colour of hued) expect(colour).toBe('hsl(var(--category-penal))');
  });
});

// How many added a dossier stays on its card, small, beside the like; the views are its author's alone (Bill, S7a).
describe('SharedEnvironmentCard — who added it, and the views', () => {
  it('says «aggiunto da N» beside the like, and nothing at 0', () => {
    const { unmount } = renderCard({ ...base, downloadCount: 12, viewCount: 340 });
    const line = screen.getByText('aggiunto da 12');
    expect(line.closest('div')).toContainElement(screen.getByRole('button', { name: /Mi piace/ }));
    expect(line.parentElement).toHaveClass('text-xs');
    // Not the views: they are the author's.
    expect(screen.queryByText(/visualizzazion/)).toBeNull();
    unmount();
    renderCard({ ...base, downloadCount: 0, viewCount: 340 });
    expect(screen.queryByText(/aggiunto da/)).toBeNull();
  });

  it('shows its author the views, in «I miei pubblicati»', () => {
    render(
      <SharedEnvironmentCard
        environment={{ ...base, isOwner: true, downloadCount: 3, viewCount: 1 }}
        onLike={vi.fn()}
        onImport={vi.fn()}
        onReport={vi.fn()}
        showOwnerActions
      />,
    );
    expect(screen.getByText('aggiunto da 3')).toBeInTheDocument();
    expect(screen.getByText('1 visualizzazione')).toBeInTheDocument();
  });
});
