import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const account = vi.hoisted(() => ({ devMode: false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ devMode: account.devMode }) }));

import { SectionSwitcher } from './SectionSwitcher';
import { sectionStore } from './useSection';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderSwitcher(path = '/', forumCount = 0, onChoose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <SectionSwitcher forumCount={forumCount} onChoose={onChoose} />
    </MemoryRouter>,
  );
  return onChoose;
}

const trigger = () => screen.getByRole('button', { name: /^Sezione:/ });

beforeEach(() => {
  account.devMode = false;
  sectionStore.setState({ section: 'opus' });
});

describe('SectionSwitcher (spec S3)', () => {
  it('names the active section on its button', () => {
    renderSwitcher('/studia/schede');
    expect(trigger()).toHaveAccessibleName('Sezione: Gymnasium, cambia sezione');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('lists the sections with their lines, the active one checked; Academia only in development mode', () => {
    renderSwitcher();
    fireEvent.click(trigger());
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      'VisuaLex OpusDossier di lavoro e strumenti per la professione',
      'VisuaLex GymnasiumSchede, ripasso, esami e concorsi',
      'VisuaLex ForumDossier pubblici e community',
    ]);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(items[1]).toHaveAttribute('aria-checked', 'false');
    expect(items[0]).toHaveFocus();
  });

  it('shows Academia with the development mode', () => {
    account.devMode = true;
    renderSwitcher();
    fireEvent.click(trigger());
    expect(screen.getByRole('menuitemradio', { name: /VisuaLex Academia/ })).toBeInTheDocument();
  });

  it('moves by keyboard and closes with Esc, focus back on the button', () => {
    renderSwitcher();
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    const menu = screen.getByRole('menu');
    expect(screen.getByRole('menuitemradio', { name: /Forum/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(screen.getByRole('menuitemradio', { name: /Opus/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: /Gymnasium/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("goes to the chosen section's page and tells the phone's menu to close (S4)", () => {
    const onChoose = renderSwitcher('/dossier');
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Gymnasium/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso');
    expect(onChoose).toHaveBeenCalledOnce();
    expect(trigger()).toHaveAccessibleName('Sezione: Gymnasium, cambia sezione');
  });

  it('says the Forum has news outside it: a dot on the icon, the count on its entry (S5)', () => {
    renderSwitcher('/', 3);
    expect(trigger()).toHaveAccessibleName('Sezione: Opus, cambia sezione, nuove attività nel Forum');
    expect(screen.getByTestId('forum-dot')).toBeInTheDocument();
    fireEvent.click(trigger());
    expect(screen.getByRole('menuitemradio', { name: /Forum.*3 notifiche/ })).toBeInTheDocument();
  });

  it('draws no dot inside the Forum, where its own entry counts', () => {
    renderSwitcher('/forum', 3);
    expect(trigger()).toHaveAccessibleName('Sezione: Forum, cambia sezione');
    expect(screen.queryByTestId('forum-dot')).toBeNull();
  });
});
