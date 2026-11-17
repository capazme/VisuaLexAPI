import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, canUseDevMode: false, devMode: false, setDevMode: vi.fn() }) }));
vi.mock('../../../features/connections/ConnectedAppsSection', () => ({ ConnectedAppsSection: () => null }));
vi.mock('../../../features/merlt/privacy/MerltDataSection', () => ({ MerltDataSection: () => null }));
vi.mock('../../../services/accountService', () => ({ accountService: {} }));

import { SettingsPage } from './SettingsPage';

const view = () => (
  <MemoryRouter initialEntries={['/impostazioni']}>
    <SettingsPage />
  </MemoryRouter>
);

beforeEach(() => {
  // The version box asks /version when the page opens; it is not under test.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

describe('Impostazioni — the groups (Y1)', () => {
  it('titles its groups with headings in plain type', () => {
    render(view());
    for (const name of ['Tema', 'Tipografia', 'Aiuto', 'Dati e privacy', 'Informazioni']) {
      const heading = screen.getByRole('heading', { level: 3, name });
      expect(heading).not.toHaveClass('uppercase');
    }
    expect(screen.getByRole('button', { name: /Rivedi la guida iniziale/ })).toBeInTheDocument();
  });
});

describe('Impostazioni — «Carattere dell’interfaccia»', () => {
  it('names the typeface control for what it sets, the interface\'s, not the law\'s (Bill and Luca)', () => {
    render(view());
    expect(screen.getByText('Carattere dell’interfaccia')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Carattere dell’interfaccia' });
    expect(group).toBeInTheDocument();
    expect(screen.queryByText('Font')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Famiglia font' })).toBeNull();
  });

  it('on a phone puts the label over its buttons, three 44 px thirds of the row; beside them from sm', () => {
    render(view());
    const group = screen.getByRole('group', { name: 'Carattere dell’interfaccia' });
    expect(group).toHaveClass('grid', 'grid-cols-3', 'sm:flex');
    expect(group.parentElement).toHaveClass('flex-col', 'sm:flex-row', 'sm:justify-between');
    for (const name of ['Sans', 'Serif', 'Mono']) {
      expect(within(group).getByRole('button', { name })).toHaveClass('min-h-[44px]', 'sm:min-h-0');
    }
  });
});

describe('Impostazioni — «Elimina l’account…» (Y1)', () => {
  const opener = () => screen.getByRole('button', { name: /Elimina l’account…/ });

  it('asks nothing until it is chosen: no password, no confirmation', () => {
    render(view());
    expect(opener()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Password corrente per eliminare account')).toBeNull();
    expect(screen.queryByRole('button', { name: /Elimina definitivamente/ })).toBeNull();
  });

  it('opens the password, the confirmation and «Annulla», the cursor in the password', () => {
    render(view());
    fireEvent.click(opener());
    expect(opener()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Password corrente per eliminare account')).toHaveFocus();
    expect(screen.getByLabelText('Conferma eliminazione account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Elimina definitivamente/ })).toBeDisabled();
  });

  it('«Annulla» closes it, empties it and gives the focus back to its button', () => {
    render(view());
    fireEvent.click(opener());
    fireEvent.change(screen.getByLabelText('Password corrente per eliminare account'), { target: { value: 'segreta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByLabelText('Password corrente per eliminare account')).toBeNull();
    expect(opener()).toHaveFocus();
    fireEvent.click(opener());
    expect(screen.getByLabelText('Password corrente per eliminare account')).toHaveValue('');
  });

  it('opens in the page, under its button, never over it (L-73)', () => {
    render(view());
    fireEvent.click(opener());
    const form = document.getElementById('delete-account-form');
    expect(opener()).toHaveAttribute('aria-controls', 'delete-account-form');
    expect(form).toContainElement(screen.getByLabelText('Password corrente per eliminare account'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('left with the page, it opens again closed and empty', () => {
    const { unmount } = render(view());
    fireEvent.click(opener());
    fireEvent.change(screen.getByLabelText('Password corrente per eliminare account'), { target: { value: 'segreta' } });
    unmount();
    render(view());
    expect(opener()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(opener());
    expect(screen.getByLabelText('Password corrente per eliminare account')).toHaveValue('');
  });

  it('keeps 44 px buttons on a phone', () => {
    render(view());
    fireEvent.click(opener());
    for (const name of [/Esporta i miei dati/, /Elimina l’account…/, /Elimina definitivamente/, 'Annulla']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]');
    }
  });
});
