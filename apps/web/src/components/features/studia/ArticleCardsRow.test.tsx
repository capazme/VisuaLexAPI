import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { forArticle: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import type { NormaVisitata } from '../../../types';
import type { SchedaDellArticolo } from '../../../types/studia';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import { parseArticleStructure } from '../../../utils/articleStructure';
import { ArticleCardsRow, type ArticleCardsHandle } from './ArticleCardsRow';
import { clearArticleCardsCache } from '../../../utils/articleCardsCache';

const forArticle = vi.mocked(studiaService.forArticle);
const create = vi.mocked(studiaService.create);

const URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';
const NORMA: NormaVisitata = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1453', urn: URN };
const TEXT = fixtureText('akn-dlgs231-25ter');
const STRUCTURE = parseArticleStructure(TEXT);

const card = (id: string, extra: Partial<SchedaDellArticolo> = {}): SchedaDellArticolo => ({
  id, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione per inadempimento', tipo: 'ISTITUTO_DEFINIZIONE',
  domanda: `Domanda ${id}?`, risposta: `Risposta ${id}.`, spiegazione: null, stato: 'BOZZA_PERSONALE',
  createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', origine: null,
  ancore: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: URN, isPrimary: true }],
  comunita: false, approvazioni: null,
  ...extra,
});

/** jsdom has no viewport: the phone's layout is the default, the desktop's is chosen here. */
function setDesktop(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

interface RowOptions {
  norma?: NormaVisitata;
  historical?: boolean;
  articleText?: string;
}

function renderRow({ norma = NORMA, historical = false, articleText = TEXT }: RowOptions = {}) {
  const handle = createRef<ArticleCardsHandle>();
  render(
    <MemoryRouter>
      <ArticleCardsRow ref={handle} norma={norma} articleText={articleText} structure={parseArticleStructure(articleText)} historical={historical} />
    </MemoryRouter>,
  );
  return handle;
}

beforeEach(() => {
  setDesktop(true);
  forArticle.mockReset();
  create.mockReset();
  clearArticleCardsCache();
});

afterEach(() => {
  setDesktop(false);
  vi.unstubAllEnvs();
});

describe('ArticleCardsRow', () => {
  it('counts the cards and offers a new one', async () => {
    forArticle.mockResolvedValue([card('a'), card('b')]);
    renderRow();
    expect(await screen.findByRole('button', { name: 'Schede su questo articolo (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Nuova scheda' })).toBeEnabled();
    expect(screen.getByRole('group', { name: 'Schede di studio' })).toHaveTextContent('Schede su questo articolo (2) · + Nuova scheda');
    expect(forArticle).toHaveBeenCalledWith(URN);
  });

  it('says there is none, and still offers a new one', async () => {
    forArticle.mockResolvedValue([]);
    renderRow();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Schede di studio' })).toHaveTextContent('Nessuna scheda su questo articolo · + Nuova scheda'));
    expect(screen.queryByRole('button', { name: /schede su questo articolo/i })).not.toBeInTheDocument();
  });

  it('keeps to the offer when the cards cannot be read, never claiming there are none', async () => {
    forArticle.mockRejectedValue(new Error('down'));
    renderRow();
    await waitFor(() => expect(forArticle).toHaveBeenCalled());
    const row = screen.getByRole('group', { name: 'Schede di studio' });
    expect(within(row).getByRole('button', { name: '+ Nuova scheda' })).toBeEnabled();
    expect(row).not.toHaveTextContent(/nessuna scheda/i);
  });

  it('opens the Peek on the count: each question with its state, linking to the card', async () => {
    const user = userEvent.setup();
    forArticle.mockResolvedValue([card('a', { stato: 'VALIDATA' }), card('b', { domanda: '<img src=x onerror=alert(1)>' })]);
    renderRow();
    await user.click(await screen.findByRole('button', { name: 'Schede su questo articolo (2)' }));
    const peek = await screen.findByRole('dialog');
    const rows = within(peek).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('href', '/studia/schede/a');
    expect(within(rows[0]).getByText('Domanda a?')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Validata')).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('href', '/studia/schede/b');
    expect(within(rows[1]).getByText('Bozza')).toBeInTheDocument();
    // Plain text, not markup.
    expect(within(rows[1]).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(peek.querySelector('img')).toBeNull();
    // No composer: the Peek only lists.
    expect(within(peek).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('closes the Peek with its button', async () => {
    const user = userEvent.setup();
    forArticle.mockResolvedValue([card('a')]);
    renderRow();
    await user.click(await screen.findByRole('button', { name: 'Schede su questo articolo (1)' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Chiudi' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('draws no row for an act with no Normattiva address', () => {
    renderRow({ norma: { ...NORMA, tipo_atto: 'regolamento UE', urn: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679' } });
    expect(screen.queryByRole('group', { name: 'Schede di studio' })).not.toBeInTheDocument();
    expect(forArticle).not.toHaveBeenCalled();
  });

  it('draws no row, and asks nothing, without an address at all', () => {
    renderRow({ norma: { ...NORMA, urn: undefined } });
    expect(screen.queryByRole('group', { name: 'Schede di studio' })).not.toBeInTheDocument();
    expect(forArticle).not.toHaveBeenCalled();
  });

  it('draws no row with the feature off', () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    renderRow();
    expect(screen.queryByRole('group', { name: 'Schede di studio' })).not.toBeInTheDocument();
    expect(forArticle).not.toHaveBeenCalled();
  });

  describe('on a past text', () => {
    const REASON = 'Le schede si ancorano al testo vigente';
    const shown = () => screen.getAllByText(REASON).length;

    it('marks «+ Nuova scheda» unavailable and says why, keeping it reachable', async () => {
      forArticle.mockResolvedValue([card('a')]);
      renderRow({ historical: true });
      const button = await screen.findByRole('button', { name: '+ Nuova scheda' });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
      expect(button).toHaveAccessibleDescription(REASON);
      // The cards already written still open.
      expect(screen.getByRole('button', { name: 'Schede su questo articolo (1)' })).toBeEnabled();
    });

    it('shows the reason on hover', async () => {
      const user = userEvent.setup();
      forArticle.mockResolvedValue([card('a')]);
      renderRow({ historical: true });
      const button = await screen.findByRole('button', { name: '+ Nuova scheda' });
      expect(shown()).toBe(1);
      await user.hover(button);
      await waitFor(() => expect(shown()).toBe(2));
    });

    it('shows the reason on keyboard focus, and hides it on leaving', async () => {
      const user = userEvent.setup();
      forArticle.mockResolvedValue([]);
      renderRow({ historical: true });
      const button = await screen.findByRole('button', { name: '+ Nuova scheda' });
      await user.tab();
      expect(button).toHaveFocus();
      await waitFor(() => expect(shown()).toBe(2));
      await user.tab();
      await waitFor(() => expect(shown()).toBe(1));
    });

    it('does nothing on click, nor when the reader asks for a card from a selection', async () => {
      const user = userEvent.setup();
      forArticle.mockResolvedValue([]);
      const handle = renderRow({ historical: true });
      await user.click(await screen.findByRole('button', { name: '+ Nuova scheda' }));
      act(() => handle.current?.createFromPassage('words'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Istituto')).not.toBeInTheDocument();
    });
  });

  it('opens the form from «+ Nuova scheda» with the article’s rubric as the institute', async () => {
    const user = userEvent.setup();
    forArticle.mockResolvedValue([]);
    renderRow();
    await user.click(await screen.findByRole('button', { name: '+ Nuova scheda' }));
    expect(await screen.findByLabelText('Istituto')).toHaveValue('Reati societari');
    expect(screen.getByLabelText('Risposta')).toHaveValue('');
  });

  it('opens the form with the selected words in the answer when the reader asks for it', async () => {
    forArticle.mockResolvedValue([]);
    const handle = renderRow();
    await waitFor(() => expect(forArticle).toHaveBeenCalled());
    act(() => handle.current?.createFromPassage('false comunicazioni sociali'));
    expect(await screen.findByLabelText('Risposta')).toHaveValue('false comunicazioni sociali');
  });

  it('reads the cards again after a save', async () => {
    const user = userEvent.setup();
    forArticle.mockResolvedValueOnce([card('a')]).mockResolvedValue([card('a'), card('n')]);
    create.mockResolvedValue({ outcome: 'created', id: 'n' });
    renderRow({ articleText: '' });
    await user.click(await screen.findByRole('button', { name: '+ Nuova scheda' }));
    await user.type(await screen.findByLabelText('Istituto'), 'Risoluzione');
    await user.type(screen.getByLabelText('Domanda'), 'Quando?');
    await user.type(screen.getByLabelText('Risposta'), 'Se inadempiente.');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByRole('button', { name: 'Schede su questo articolo (2)' })).toBeInTheDocument();
    expect(forArticle).toHaveBeenCalledTimes(2);
  });

  it('asks once for an article however many times it is shown', async () => {
    forArticle.mockResolvedValue([card('a')]);
    const { unmount } = render(
      <MemoryRouter>
        <ArticleCardsRow norma={NORMA} articleText={TEXT} structure={STRUCTURE} historical={false} />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Schede su questo articolo (1)' });
    unmount();
    renderRow();
    expect(await screen.findByRole('button', { name: 'Schede su questo articolo (1)' })).toBeInTheDocument();
    expect(forArticle).toHaveBeenCalledTimes(1);
  });
});
