import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));

import { CommandPalette } from './CommandPalette';
import { appStore } from '../../../store/useAppStore';
import { SEARCH_FIELD_FORM_ID } from '../../../utils/searchFieldControl';
import type { CustomAlias, QuickNorm } from '../../../types';

/**
 * The search menu in the new design (spec O1): on a computer a panel that drops from the search page's
 * field, on a phone `ui/Sheet`; the field first, the list of acts and «A portata di mano» under it, the
 * filters and the keys at the foot. The behaviour behind it is `CommandPalette.test.tsx`'s.
 */

function asDesktop(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: desktop, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

const quickNorm = (i: number): QuickNorm => ({
  id: `q${i}`, label: `Art. ${i} c.c.`, createdAt: '2026-10-01T00:00:00.000Z', usageCount: 0,
  searchParams: { act_type: 'codice civile', article: String(i), act_number: '', date: '', version: 'vigente', version_date: '' },
});
const alias = (i: number): CustomAlias => ({
  id: `a${i}`, trigger: `alias-${String(i).padStart(2, '0')}`, type: 'reference', expandTo: 'Codice penale',
  usageCount: 0, createdAt: '2026-10-01T00:00:00.000Z', searchParams: { act_type: 'codice penale', article: String(i) },
});

const optionNames = () => screen.queryAllByRole('option').map((o) => o.textContent ?? '');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ presets: {}, known_acts: [] }) })));
  appStore.setState({ quickNorms: [], customAliases: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.getElementById(SEARCH_FIELD_FORM_ID)?.remove();
  appStore.setState({ quickNorms: [], customAliases: [] });
});

describe('CommandPalette — where it opens', () => {
  it('on a computer, drops from the search page\'s field, with its own «Chiudi» and the keys at the foot', () => {
    asDesktop(true);
    const form = document.createElement('form');
    form.id = SEARCH_FIELD_FORM_ID;
    document.body.appendChild(form);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    const panel = document.getElementById('command-menu-root')!.closest('[class*="fixed"]') as HTMLElement;
    // placed by floating-ui against the field, not hung at the top of the screen
    expect(panel.className).not.toMatch(/top-16/);
    expect(panel.style.position).toBe('fixed');
    expect(screen.getByRole('button', { name: 'Chiudi' })).toBeInTheDocument();
    expect(screen.getByText('Naviga')).toBeInTheDocument();
    // a dialog with its name, the focus kept inside
    expect(screen.getByRole('dialog', { name: 'Menu di ricerca' })).toContainElement(screen.getByRole('combobox'));
  });

  it('on a computer, gives the focus back to what had it («Opzioni») when it closes', async () => {
    asDesktop(true);
    const opener = document.createElement('button');
    opener.textContent = 'Opzioni';
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  it('on a computer with no field on screen, hangs at the top, centred', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const panel = document.getElementById('command-menu-root')!.closest('[class*="fixed"]') as HTMLElement;
    expect(panel.className).toMatch(/top-16/);
  });

  it('on a phone, is a sheet with its «Chiudi», and shows no keys', () => {
    asDesktop(false);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const sheet = screen.getByRole('dialog', { name: 'Menu di ricerca' });
    expect(within(sheet).getByRole('button', { name: 'Chiudi' })).toBeInTheDocument();
    expect(screen.queryByText('Naviga')).toBeNull();
  });
});

describe('CommandPalette — the field and the steps', () => {
  it('says under the field what it takes, and marks the step in use', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    expect(screen.getByText('Scrivi una citazione: art. 2043 c.c., l. 241/1990, Cass. civ. 10787/2024')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atto' })).toHaveAttribute('aria-current', 'step');

    await user.click(screen.getByRole('option', { name: 'Codice civile · c.c.' }));
    expect(screen.getByText('Articolo').parentElement).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Atto' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText("Scrivi il numero dell'articolo: 2043, 1-bis")).toBeInTheDocument();
  });

  it('searches the article typed, as before', async () => {
    asDesktop(false);
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={onSearch} />);

    await user.click(screen.getByRole('option', { name: 'Codice civile · c.c.' }));
    const box = screen.getByRole('textbox', { name: "Numero dell'articolo" });
    await user.clear(box);
    await user.type(box, '2043');
    await user.click(screen.getByRole('button', { name: "Apri l'articolo" }));

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ act_type: 'codice civile', article: '2043' }));
  });
});

describe('CommandPalette — «Scegli l\'atto»', () => {
  it('lists the acts by group, each by name and abbreviation', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByText('Fonti primarie')).toBeInTheDocument();
    expect(screen.getByText('Codici fondamentali')).toBeInTheDocument();
    expect(screen.getByText('Unione europea')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Codice di procedura civile · c.p.c.' })).toBeInTheDocument();
  });

  it('is narrowed by the field while it is typed', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'proc');
    const names = optionNames();
    expect(names).toContain('Codice di procedura civile · c.p.c.');
    expect(names).toContain('Codice di procedura penale · c.p.p.');
    expect(names).not.toContain('Codice civile · c.c.');
  });

  it('says so when no act has the name typed', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    await user.type(screen.getByRole('combobox'), 'zzzz');
    // once the server has said it is no act either (until then: «Cerco l'atto…»)
    expect(await screen.findByText('Nessun atto con questo nome')).toBeInTheDocument();
  });
});

describe('CommandPalette — «A portata di mano»', () => {
  it('is one quiet line each when empty: no favourite, and «Crea un alias»', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByText('Nessun preferito: il fulmine su un articolo lo aggiunge qui')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Crea un alias' })).toBeInTheDocument();
  });

  it('on a phone, gives «Gestisci» a heading as tall as it, so it covers no favourite', () => {
    asDesktop(false);
    appStore.setState({ quickNorms: [quickNorm(1)] });
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const group = document.getElementById('command-palette-quick-norms')!;
    expect(group.className).toMatch(/\[&_\[cmdk-group-heading\]\]:min-h-\[44px\]/);
    expect(within(group).getByRole('button', { name: 'Gestisci' })).toHaveClass('top-0', 'min-h-[44px]');
  });

  it('shows the first six of 30 favourites and of 50 aliases, and the way to all of them', () => {
    asDesktop(true);
    appStore.setState({
      quickNorms: Array.from({ length: 30 }, (_, i) => quickNorm(i + 1)),
      customAliases: Array.from({ length: 50 }, (_, i) => alias(i + 1)),
    });
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    const names = optionNames();
    expect(names.filter((n) => n.startsWith('Art. ') && n.endsWith('Codice civile'))).toHaveLength(6);
    expect(names.filter((n) => n.startsWith('alias-'))).toHaveLength(6);
    expect(screen.getByRole('option', { name: 'Tutti i preferiti (30)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gestisci alias (50)' })).toBeInTheDocument();
  });

  it('narrows the favourites and the aliases with the field, past the six', async () => {
    asDesktop(true);
    appStore.setState({ customAliases: Array.from({ length: 50 }, (_, i) => alias(i + 1)) });
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'alias-4');
    const names = optionNames().filter((n) => n.startsWith('alias-'));
    expect(names).toHaveLength(10); // alias-40 … alias-49
    expect(names[0]).toMatch(/^alias-40/);
  });
});

describe('CommandPalette — «Filtri avanzati»', () => {
  it('stays closed, says its state in words, and the search carries what was chosen', async () => {
    asDesktop(true);
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={onSearch} />);

    const toggle = screen.getByRole('button', { name: /Filtri avanzati/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Nessun filtro');

    await user.click(toggle);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fonte' }), 'eurlex');
    await user.type(screen.getByRole('spinbutton', { name: "Dall'anno" }), '1990');
    expect(toggle).toHaveTextContent('2 filtri attivi');

    await user.click(screen.getByRole('option', { name: 'Codice civile · c.c.' }));
    await user.click(screen.getByRole('button', { name: "Apri l'articolo" }));
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ source: 'eurlex', yearFrom: 1990 }) }));
  });
});

describe('CommandPalette — the keys', () => {
  it('leaves Enter to a button: «Filtri avanzati» opens, no act is picked', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: /Filtri avanzati/ });
    toggle.focus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // still on the first step: Enter did not reach cmdk's list
    expect(screen.getByRole('button', { name: 'Atto' })).toHaveAttribute('aria-current', 'step');
  });

  it('on a computer, Enter on an opening runs the first favourite, as before', async () => {
    asDesktop(true);
    const favourite = quickNorm(2043);
    const original = appStore.getState().selectQuickNorm;
    // the store's own counts the use on the server: not here
    appStore.setState({ quickNorms: [favourite], selectQuickNorm: () => favourite });
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={onSearch} />);

    await user.keyboard('{Enter}');
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ act_type: 'codice civile', article: '2043' }));
    appStore.setState({ selectQuickNorm: original });
  });

  it('tells a screen reader what the box was read as, a norm too', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription('Scrivi una citazione: art. 2043 c.c., l. 241/1990, Cass. civ. 10787/2024');
    await user.type(screen.getByRole('combobox'), 'art 2043 cc');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Premi Invio per cercare\.$/));
  });
});
