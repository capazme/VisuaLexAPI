import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, canUseDevMode: false, devMode: false, setDevMode: vi.fn(), isAuthenticated: true }) }));
vi.mock('../../../features/connections/ConnectedAppsSection', () => ({ ConnectedAppsSection: () => null }));
vi.mock('../../../features/merlt/privacy/MerltDataSection', () => ({ MerltDataSection: () => null }));
vi.mock('../../../services/accountService', () => ({ accountService: {} }));

import { SettingsPage } from './SettingsPage';
import { useOpenSettings, useSettingsRequests } from './settingsRoute';
import type { SettingsSection } from '../../../types';

/** A page of the app with a way into Impostazioni, as the sidebar and the reader's gear have. */
function Elsewhere({ section }: { section?: SettingsSection }) {
  const openSettings = useOpenSettings();
  return <button type="button" onClick={() => openSettings(section)}>Apri le impostazioni</button>;
}

function Where() {
  // What `Layout` does: the requests become the navigation.
  useSettingsRequests();
  const { pathname, hash } = useLocation();
  return <p data-testid="where">{pathname + hash}</p>;
}

function app(section?: SettingsSection, start = '/pratiche') {
  render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/" element={<p>Pagina di ricerca</p>} />
        <Route path="/pratiche" element={<Elsewhere section={section} />} />
        <Route path="/impostazioni" element={<SettingsPage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where');
const enter = () => fireEvent.click(screen.getByRole('button', { name: 'Apri le impostazioni' }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

describe('Impostazioni — a page with its parts (LC84)', () => {
  it('opens at the part asked for, an anchor of the page', () => {
    app('dati');
    enter();
    expect(where()).toHaveTextContent('/impostazioni#dati');
    expect(document.getElementById('dati')).toContainElement(screen.getByRole('heading', { name: 'Dati e privacy' }));
  });

  // LC92: the bug beside «Impostazioni» and the user menu open «Segnala un problema», a part of the page, not a dialog.
  it('opens at «Segnala un problema», the form that was «Commenti»\'s dialog', () => {
    app('segnala');
    enter();
    expect(where()).toHaveTextContent('/impostazioni#segnala');
    const part = document.getElementById('segnala');
    expect(part).toContainElement(screen.getByRole('heading', { level: 3, name: 'Segnala un problema' }));
    expect(part).toContainElement(screen.getByRole('button', { name: 'Invia' }));
    expect(within(screen.getByRole('navigation', { name: 'Parti delle impostazioni' })).getByRole('link', { name: 'Segnala un problema' })).toHaveAttribute('href', '#segnala');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has a part for each of the former dialogs: the quick norms, the aliases, the shortcuts', () => {
    app();
    enter();
    for (const [id, name] of [['norme-rapide', 'Norme rapide'], ['alias', 'Alias'], ['scorciatoie', 'Scorciatoie da tastiera']]) {
      expect(document.getElementById(id)).toContainElement(screen.getByRole('heading', { level: 3, name }));
    }
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists its parts in an index whose links change the anchor in place', () => {
    app();
    enter();
    const index = screen.getByRole('navigation', { name: 'Parti delle impostazioni' });
    fireEvent.click(within(index).getByRole('link', { name: 'Alias' }));
    expect(where()).toHaveTextContent('/impostazioni#alias');
    expect(within(index).getByRole('link', { name: 'Alias' })).toHaveAttribute('aria-current', 'location');
    // Replaced, not pushed: «Indietro» still goes back to the page it was opened from.
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(where()).toHaveTextContent(/^\/pratiche$/);
  });

  it('coming in, the focus goes to the page\'s title', () => {
    app();
    enter();
    expect(screen.getByRole('heading', { level: 1, name: 'Impostazioni' })).toHaveFocus();
  });

  it('Esc goes back to the page it was opened from', () => {
    app('scorciatoie');
    enter();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(where()).toHaveTextContent(/^\/pratiche$/);
  });

  it('an Esc pressed outside the page (the drawer, a menu of the sidebar) is not the page\'s', () => {
    app('dati');
    enter();
    const outside = document.createElement('button');
    document.body.append(outside);
    fireEvent.keyDown(outside, { key: 'Escape' });
    expect(where()).toHaveTextContent('/impostazioni#dati');
    outside.remove();
  });

  it('opened by its address, «Indietro» goes to the search page', () => {
    app(undefined, '/impostazioni');
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(screen.getByText('Pagina di ricerca')).toBeInTheDocument();
  });

  it('an Esc taken by a space open in the page closes that space and stays', () => {
    app('dati');
    enter();
    fireEvent.click(screen.getByRole('button', { name: /Elimina l’account…/ }));
    const password = screen.getByLabelText('Password corrente per eliminare account');
    fireEvent.keyDown(password, { key: 'Escape' });
    expect(screen.queryByLabelText('Password corrente per eliminare account')).toBeNull();
    expect(where()).toHaveTextContent('/impostazioni#dati');
  });
});

describe('Impostazioni — the aliases deleted with «Annulla» (L-35)', () => {
  it('an alias leaves the list at once, and «Annulla» brings it back without telling the server', async () => {
    const { appStore } = await import('../../../store/useAppStore');
    const { NotificationHost } = await import('../../ui/Toast');
    const alias = { id: 'a1', trigger: 'cdc', type: 'reference' as const, expandTo: 'Codice civile', searchParams: { act_type: 'codice civile' }, createdAt: '', usageCount: 0 };
    const remove = vi.fn();
    appStore.setState({ customAliases: [alias], removeCustomAlias: remove });
    render(<MemoryRouter initialEntries={['/impostazioni#alias']}><SettingsPage /><NotificationHost /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Elimina l’alias cdc' }));
    expect(screen.queryByRole('button', { name: 'Elimina l’alias cdc' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Annulla/ }));
    expect(await screen.findByRole('button', { name: 'Elimina l’alias cdc' })).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    appStore.setState({ customAliases: [] });
  });

  it('after a deletion the focus goes to the next alias, or to the section\'s heading', async () => {
    const { appStore } = await import('../../../store/useAppStore');
    const make = (id: string, trigger: string) => ({ id, trigger, type: 'reference' as const, expandTo: trigger, searchParams: { act_type: 'codice civile' }, createdAt: '', usageCount: 0 });
    appStore.setState({ customAliases: [make('a1', 'aaa'), make('a2', 'bbb')], removeCustomAlias: vi.fn() });
    render(<MemoryRouter initialEntries={['/impostazioni#alias']}><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Elimina l’alias aaa' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Modifica l’alias bbb' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Elimina l’alias bbb' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'Alias' })).toHaveFocus());
    appStore.setState({ customAliases: [] });
  });
});
