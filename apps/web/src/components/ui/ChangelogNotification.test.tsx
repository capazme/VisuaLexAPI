import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangelogNotification, ReleaseNews } from './ChangelogNotification';
import { VERSION_CHECK_SESSION_KEY, VERSION_STORAGE_KEY } from '../../config/versionConfig';
import { RELEASE_NOTES } from '../../content/novita/releaseNotes';

describe('ReleaseNews', () => {
  it('draws one version’s note as headings, items and marks, with no version heading', () => {
    render(<ReleaseNews news={[{ version: '1.9.1', note: '**Accesso**\n- La **pagina** nuova, `/crediti`.' }]} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Accesso' })).toBeInTheDocument();
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('La pagina nuova, /crediti.');
    expect(within(item).getByText('pagina').tagName).toBe('STRONG');
    expect(within(item).getByText('/crediti').tagName).toBe('CODE');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Versione/ })).not.toBeInTheDocument();
  });

  it('draws the skipped versions each under its heading, the newest first', () => {
    render(
      <ReleaseNews
        news={[
          { version: '1.9.1', note: '**Ricerca**\n- uno' },
          { version: '1.9.0', note: '**Gymnasium**\n- due' },
        ]}
      />
    );

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Versione 1.9.1',
      'Versione 1.9.0',
    ]);
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Ricerca', 'Gymnasium']);
  });

  it('says «Correzioni e miglioramenti» for a version with no note, never that nothing is available', () => {
    render(<ReleaseNews news={[{ version: '1.9.2', note: null }]} />);

    expect(screen.getByText('Correzioni e miglioramenti')).toBeInTheDocument();
    expect(screen.queryByText(/Nessun changelog/)).not.toBeInTheDocument();
  });
});

describe('ChangelogNotification', () => {
  const answer = (version: string) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      // The production answer: no git in the image, so no changelog.
      new Response(JSON.stringify({ version, changelog: [] }), { status: 200 })
    );

  // not `clear()`: the setup's storage mock is `window.localStorage` itself and would delete its own methods
  const forget = () => {
    localStorage.removeItem(VERSION_STORAGE_KEY);
    sessionStorage.removeItem(VERSION_CHECK_SESSION_KEY);
  };

  beforeEach(forget);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the new version’s own note, though /version sends no changelog', async () => {
    localStorage.setItem(VERSION_STORAGE_KEY, '1.9.0');
    answer('1.9.1');
    render(<ChangelogNotification />);

    await userEvent.click(await screen.findByRole('button', { name: 'Vedi' }));

    const dialog = screen.getByRole('dialog', { name: 'Novità in v1.9.1' });
    expect(within(dialog).getByRole('heading', { name: 'Accesso' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: /Versione/ })).not.toBeInTheDocument();
    expect(RELEASE_NOTES['1.9.1']).toContain('**Accesso**');
  });

  it('adds the notes of the versions skipped since the last visit, the newest first', async () => {
    localStorage.setItem(VERSION_STORAGE_KEY, '1.8.5');
    answer('1.9.1');
    render(<ChangelogNotification />);

    await userEvent.click(await screen.findByRole('button', { name: 'Vedi' }));

    const dialog = screen.getByRole('dialog', { name: 'Novità dalla tua ultima visita' });
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Versione 1.9.1',
      'Versione 1.9.0',
    ]);
  });

  it('says «Correzioni e miglioramenti» for a version released with no note', async () => {
    localStorage.setItem(VERSION_STORAGE_KEY, '99.0.0');
    answer('99.0.1');
    render(<ChangelogNotification />);

    await userEvent.click(await screen.findByRole('button', { name: 'Vedi' }));

    expect(within(screen.getByRole('dialog')).getByText('Correzioni e miglioramenti')).toBeInTheDocument();
  });

  it('remembers the version once the window is closed, and says nothing on a first visit', async () => {
    localStorage.setItem(VERSION_STORAGE_KEY, '1.9.0');
    answer('1.9.1');
    const { unmount } = render(<ChangelogNotification />);

    await userEvent.click(await screen.findByRole('button', { name: 'Vedi' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Chiudi' }));
    expect(localStorage.getItem(VERSION_STORAGE_KEY)).toBe('1.9.1');
    unmount();

    forget();
    render(<ChangelogNotification />);
    await vi.waitFor(() => expect(localStorage.getItem(VERSION_STORAGE_KEY)).toBe('1.9.1'));
    expect(screen.queryByRole('button', { name: 'Vedi' })).not.toBeInTheDocument();
  });
});
