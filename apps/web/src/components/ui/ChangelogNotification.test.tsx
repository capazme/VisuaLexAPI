import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangelogNotification, ReleaseNews } from './ChangelogNotification';
import { VERSION_CHECK_SESSION_KEY, VERSION_STORAGE_KEY } from '../../config/versionConfig';
import { RELEASE_NOTES } from '../../content/novita/releaseNotes';

// Reduced motion, switched per test: Framer's own hook, read by the toast and by `Modal`.
const motionPreference = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motionPreference.reduced,
}));

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
    motionPreference.reduced = false;
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

  it('says «Correzioni e miglioramenti» for a version this bundle has no note of, and does not mark it seen', async () => {
    // A tab opened before a deploy: the server names the new version, the bundle has the old notes.
    localStorage.setItem(VERSION_STORAGE_KEY, '99.0.0');
    answer('99.0.1');
    render(<ChangelogNotification />);

    await userEvent.click(await screen.findByRole('button', { name: 'Vedi' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Correzioni e miglioramenti')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Chiudi' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(localStorage.getItem(VERSION_STORAGE_KEY)).toBe('99.0.0');
  });

  it('only fades the toast in under reduced motion, where it otherwise rises and grows', async () => {
    const toastOf = async () => (await screen.findByRole('button', { name: 'Vedi' })).parentElement as HTMLElement;
    localStorage.setItem(VERSION_STORAGE_KEY, '1.9.0');
    answer('1.9.1');

    const moving = render(<ChangelogNotification />);
    expect((await toastOf()).style.transform).toMatch(/translateY|scale/);
    moving.unmount();

    forget();
    localStorage.setItem(VERSION_STORAGE_KEY, '1.9.0');
    motionPreference.reduced = true;
    render(<ChangelogNotification />);
    const toast = await toastOf();
    expect(toast.style.transform).not.toMatch(/translateY|scale/);
    expect(toast.style.opacity).toBe('0');
  });

  it('gives the focus back to where it was before the toast once the window closes', async () => {
    localStorage.setItem(VERSION_STORAGE_KEY, '1.9.0');
    answer('1.9.1');
    render(
      <>
        <button type="button">Prima</button>
        <ChangelogNotification />
      </>
    );
    await screen.findByRole('button', { name: 'Vedi' });
    screen.getByRole('button', { name: 'Prima' }).focus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Vedi' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Chiudi' }));

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Prima' })).toHaveFocus());
  });

  // The owners' review, 21 Oct 2026: «Vedi» pressed with the focus on the body (a click) had nowhere to give it back, and it fell to
  // the body; the page's <main> takes it, focusable only while it holds it.
  it('gives the focus to the page\'s <main> when it came from nowhere, once the window closes', async () => {
    localStorage.setItem(VERSION_STORAGE_KEY, '1.9.0');
    answer('1.9.1');
    render(
      <>
        <main data-testid="page"><p>Pagina</p></main>
        <ChangelogNotification />
      </>
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Vedi' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Chiudi' }));

    const main = screen.getByTestId('page');
    await vi.waitFor(() => expect(main).toHaveFocus());
    main.blur();
    expect(main).not.toHaveAttribute('tabindex');
  });

  it('gives the focus to the page\'s <main> when the toast is dismissed from nowhere', async () => {
    localStorage.setItem(VERSION_STORAGE_KEY, '1.9.0');
    answer('1.9.1');
    render(
      <>
        <main data-testid="page"><p>Pagina</p></main>
        <ChangelogNotification />
      </>
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Chiudi notifica' }));
    await vi.waitFor(() => expect(screen.getByTestId('page')).toHaveFocus());
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
