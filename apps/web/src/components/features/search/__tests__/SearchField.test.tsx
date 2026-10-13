import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The server's resolver: «statuto dei lavoratori» is an act it names; anything else it does not.
const legalFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../../services/legalFetch', () => ({ legalFetch }));

import { appStore } from '../../../../store/useAppStore';
import { SearchField } from '../SearchField';
import { isTypedSearch } from '../../../../hooks/useSearchActions';
import { focusSearchField, resetSearchFieldControl } from '../../../../utils/searchFieldControl';

const original = appStore.getState();
const triggerSearch = vi.fn();
const openDecision = vi.fn();
const openTopicSearch = vi.fn();
const openCommandPaletteWith = vi.fn();
const openCommandPalette = vi.fn();

function answer(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** The field on the search page; `/dossier` stands for any other page. */
function renderField(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SearchField />
      <Routes>
        <Route path="/" element={<p>Pagina di ricerca</p>} />
        <Route path="/dossier" element={<p>Pagina dossier</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const field = () => screen.getByRole('searchbox', { name: 'Cerca una norma, una sentenza o un tema' });

beforeEach(() => {
  legalFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
    return /statuto dei lavoratori/i.test(query ?? '')
      ? answer({ recognized: true, parsed: { act_type: 'legge', act_number: '300', date: '1970-05-20', article: '18' } })
      : answer({ recognized: false });
  });
  appStore.setState({
    customAliases: [],
    triggerSearch,
    openDecision,
    openTopicSearch,
    openCommandPaletteWith,
    openCommandPalette,
  });
});

afterEach(() => {
  appStore.setState({
    triggerSearch: original.triggerSearch,
    openDecision: original.openDecision,
    openTopicSearch: original.openTopicSearch,
    openCommandPaletteWith: original.openCommandPaletteWith,
    openCommandPalette: original.openCommandPalette,
  });
  resetSearchFieldControl();
  vi.clearAllMocks();
});

describe('SearchField — the search page\'s field', () => {
  it('searches a complete norm in the practices with Enter, as a typed search, and empties itself', async () => {
    const user = userEvent.setup();
    renderField();
    await user.type(field(), 'art 2043 cc');
    expect(screen.getByTestId('search-field-hint')).toHaveTextContent('Invio cerca');
    await user.keyboard('{Enter}');
    expect(triggerSearch).toHaveBeenCalledTimes(1);
    const params = triggerSearch.mock.calls[0][0];
    expect(params).toMatchObject({ article: '2043', version: 'vigente', show_brocardi_info: true });
    expect(isTypedSearch(params)).toBe(true);
    expect(field()).toHaveValue('');
  });

  it('opens a decision with Enter', async () => {
    const user = userEvent.setup();
    renderField();
    await user.type(field(), 'Cass. civ. 10787/2024{Enter}');
    expect(openDecision).toHaveBeenCalledWith(expect.objectContaining({ corte: 'cassazione', numero: 10787, anno: 2024 }), { fromLink: true });
    expect(triggerSearch).not.toHaveBeenCalled();
  });

  it('searches a topic in the Cassazione\'s decisions once the server has said it is no act', async () => {
    const user = userEvent.setup();
    renderField();
    await user.type(field(), 'danno da vacanza rovinata');
    await waitFor(() => expect(screen.getByTestId('search-field-hint')).toHaveTextContent('Cerca «danno da vacanza rovinata» nelle sentenze della Cassazione'));
    await user.keyboard('{Enter}');
    expect(openTopicSearch).toHaveBeenCalledWith({ tema: 'danno da vacanza rovinata' }, 'Tema: danno da vacanza rovinata');
  });

  it('waits for the server when Enter comes first, then searches the act it named', async () => {
    const user = userEvent.setup();
    renderField();
    await user.type(field(), 'art 18 statuto dei lavoratori{Enter}');
    expect(triggerSearch).not.toHaveBeenCalled();
    await waitFor(() => expect(triggerSearch).toHaveBeenCalledTimes(1));
    expect(triggerSearch.mock.calls[0][0]).toMatchObject({ act_type: 'legge', act_number: '300', article: '18' });
    expect(openTopicSearch).not.toHaveBeenCalled();
  });

  it('hands a norm that still lacks its number or article to the palette, with the words typed', async () => {
    const user = userEvent.setup();
    renderField();
    await user.type(field(), 'legge 241');
    await waitFor(() => expect(screen.getByTestId('search-field-hint')).toHaveTextContent('Invio completa'));
    await user.keyboard('{Enter}');
    // After the server's answer, which names no more than the client did.
    await waitFor(() => expect(openCommandPaletteWith).toHaveBeenCalledWith('legge 241'));
    expect(triggerSearch).not.toHaveBeenCalled();
  });

  it('«Opzioni» opens the palette, with the words typed when there are some', async () => {
    const user = userEvent.setup();
    renderField();
    await user.click(screen.getByRole('button', { name: 'Altre opzioni di ricerca (⌘K)' }));
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
    await user.type(field(), 'gdpr');
    await user.click(screen.getByRole('button', { name: 'Altre opzioni di ricerca (⌘K)' }));
    expect(openCommandPaletteWith).toHaveBeenCalledWith('gdpr');
  });

  it('is filled and focused from elsewhere: the empty page\'s examples', () => {
    renderField();
    act(() => focusSearchField({ text: 'Art. 2043 c.c.' }));
    expect(field()).toHaveValue('Art. 2043 c.c.');
    expect(field()).toHaveFocus();
  });

  it('takes a request made before it was mounted (the sidebar\'s «Ricerca» navigates, then focuses)', () => {
    focusSearchField();
    renderField();
    expect(field()).toHaveFocus();
  });

  it('Escape empties it', async () => {
    const user = userEvent.setup();
    renderField();
    await user.type(field(), 'art 2043 cc{Escape}');
    expect(field()).toHaveValue('');
  });

  it('brings the reader to the search page when used from another page', async () => {
    const user = userEvent.setup();
    renderField('/dossier');
    await user.type(field(), 'art 2043 cc{Enter}');
    expect(await screen.findByText('Pagina di ricerca')).toBeInTheDocument();
  });
});
