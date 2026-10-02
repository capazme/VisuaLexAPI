import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../utils/articleFetchCache', () => ({ fetchArticleForNorma: vi.fn() }));

import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { DossierItemReader } from './DossierItemReader';
import { appStore } from '../../../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import { formatCitation } from '../../../utils/normaMeta';
import { UNRELIABLE_REASON } from '../../../utils/versionDisplay';
import type { ArticleValidity, Highlight, NormaVisitata } from '../../../types';

const RAW = fixtureText('nrm-cc-1284');
const CURRENT_ITEM: NormaVisitata = {
  tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', allegato: '2',
};
const PAST_ITEM: NormaVisitata = { ...CURRENT_ITEM, versione: 'vigente', data_versione: '2005-06-01' };

const MIDDLE: ArticleValidity = {
  state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: true,
};
const NOT_YET: ArticleValidity = {
  state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true,
};

// A highlight made on the text in force of the same article: the key carries no version.
const highlight: Highlight = {
  id: 'h1',
  normaKey: buildItemKey(CURRENT_ITEM),
  articleId: uniqueArticleIdFromNorma(CURRENT_ITEM),
  rangeSerialized: '',
  text: 'saggio degli interessi legali',
  color: 'green',
  startOffset: RAW.replace(/\n/g, '').indexOf('saggio degli interessi legali'),
};

let writeText: Mock<(text: string) => Promise<void>>;

function read(
  norma: NormaVisitata, validity?: ArticleValidity, text = RAW,
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void = () => {},
) {
  vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: text, norma_data: norma, validity });
  return render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={showToast} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  appStore.setState({ highlights: [highlight], annotations: [] });
});

describe('DossierItemReader — a past text', () => {
  it('shows the highlight made on the text in force (the control)', async () => {
    const { container } = read(CURRENT_ITEM);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(container.querySelector('mark')).not.toBeNull();
  });

  it('draws none of those marks on a past text: they would sit on the wrong words', async () => {
    const { container } = read(PAST_ITEM, MIDDLE);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(container.querySelector('mark')).toBeNull();
    expect(container.querySelector('.vlx-sign')).toBeNull();
  });

  it('says which window it is, and only informs', async () => {
    read(PAST_ITEM, MIDDLE);
    expect(await screen.findByText('Testo storico')).toBeInTheDocument();
    expect(screen.getByText(/In vigore dal 25 dicembre 2003 al 29 dicembre 2007/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vai al testo attuale' })).not.toBeInTheDocument();
  });

  it('opens the update notes', async () => {
    const { container } = read(PAST_ITEM, MIDDLE);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(container.querySelector('.vlx-art')).toHaveClass('vlx-updates-open');
  });

  it('opens the update notes by default and lets the toggle close and reopen them, saying the truth', async () => {
    const { container } = read(PAST_ITEM, MIDDLE);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    const toggle = () => container.querySelector('.vlx-updates-toggle') as HTMLElement;
    expect(toggle()).not.toBeNull();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.vlx-art')).toHaveClass('vlx-updates-open');

    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'false'));
    expect(container.querySelector('.vlx-art')).not.toHaveClass('vlx-updates-open');

    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'true'));
    expect(container.querySelector('.vlx-art')).toHaveClass('vlx-updates-open');
  });

  it('says the day that was asked for when the source could not be read, and no more', async () => {
    read(PAST_ITEM, undefined);
    expect(await screen.findByText('Testo al 01/06/2005')).toBeInTheDocument();
  });

  it('leaves the label to the banner when the source stated the window', async () => {
    read(PAST_ITEM, MIDDLE);
    await screen.findByText('Testo storico');
    expect(screen.queryByText('Testo al 01/06/2005')).not.toBeInTheDocument();
  });

  it('is read-only even when the source could not be read', async () => {
    const { container } = read(PAST_ITEM, undefined);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(container.querySelector('mark')).toBeNull();
  });
});

describe('DossierItemReader — the citation', () => {
  it('copies the citation of the version a past item holds', async () => {
    read(PAST_ITEM, MIDDLE);
    fireEvent.click(await screen.findByRole('button', { name: /Copia citazione/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(
      /^art\. 1284 c\.c\., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 \(Normattiva, testo consolidato, consultato il /,
    );
  });

  it('copies the day that was asked for when the source could not be read', async () => {
    read(PAST_ITEM, undefined);
    fireEvent.click(await screen.findByRole('button', { name: /Copia citazione/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(/^art\. 1284 c\.c\., nel testo in vigore al 1° giugno 2005 \(Normattiva/);
  });

  it('keeps the citation a text in force always had, byte for byte', async () => {
    read(CURRENT_ITEM, { ...MIDDLE, state: 'current', valid_to: null });
    fireEvent.click(await screen.findByRole('button', { name: /Copia citazione/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('codice civile n. 262 del 1942-03-16, Art. 1284 (Allegato 2)');
  });
});

describe('DossierItemReader — "Original" in any case', () => {
  it('cites the original text for an item whose version is written " Originale "', async () => {
    read({ ...CURRENT_ITEM, versione: ' Originale ' }, MIDDLE);
    fireEvent.click(await screen.findByRole('button', { name: /Copia citazione/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(/^art\. 1284 c\.c\., nel testo originale/);
  });
});

describe('DossierItemReader — an act of the Union opened with a stale day', () => {
  const EU_ITEM: NormaVisitata = {
    tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016', numero_articolo: '5',
    versione: 'vigente', data_versione: '2007-10-12',
  };

  it('copies the plain citation of the article: the server ignores the day, so it is the true one', async () => {
    read(EU_ITEM);
    const button = await screen.findByRole('button', { name: /Copia citazione/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(formatCitation(EU_ITEM));
  });
});

describe('DossierItemReader — a text the table says may not be copied', () => {
  const RECT = { x: 40, y: 120, width: 90, height: 18 };
  const originalRect = Range.prototype.getBoundingClientRect;
  const WORDS = 'Gli interessi superiori alla misura legale';

  beforeEach(() => {
    // jsdom has no layout: give the range a rect so the popup can position.
    Range.prototype.getBoundingClientRect = () =>
      ({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) }) as DOMRect;
  });
  afterEach(() => {
    Range.prototype.getBoundingClientRect = originalRect;
    window.getSelection()?.removeAllRanges();
  });

  function select(container: HTMLElement, needle: string) {
    const root = container.querySelector('.vlx-art');
    if (!root) throw new Error('no text on screen');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const at = node.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      fireEvent.mouseUp(root);
      return;
    }
    throw new Error(`"${needle}" is not in the text`);
  }

  it('does not copy the selected words of a version that does not contain the day, and says why', async () => {
    const showToast = vi.fn();
    const { container } = read(PAST_ITEM, { ...MIDDLE, request_in_window: false }, RAW, showToast);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    select(container, WORDS);
    fireEvent.click(await screen.findByTitle(/^Copia \(/));
    await act(async () => { await Promise.resolve(); }); // the handler is async: let a write, if any, happen
    expect(writeText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(UNRELIABLE_REASON, 'info');
    expect(showToast).not.toHaveBeenCalledWith('Testo copiato con citazione', 'success');
  });

  it('does not copy the citation either (an item with no day asked, on a version that does not contain today)', async () => {
    // The button is locked only for a past request; here nothing was asked, so the guard in the handler is what refuses.
    const showToast = vi.fn();
    read(CURRENT_ITEM, { ...MIDDLE, request_in_window: false }, RAW, showToast);
    const button = await screen.findByRole('button', { name: /Copia citazione/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await act(async () => { await Promise.resolve(); });
    expect(writeText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(UNRELIABLE_REASON, 'info');
  });

  it('copies the selected words of a reliable past text with the citation first (the control)', async () => {
    const showToast = vi.fn();
    const { container } = read(PAST_ITEM, MIDDLE, RAW, showToast);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    select(container, WORDS);
    fireEvent.click(await screen.findByTitle(/^Copia \(/));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0];
    expect(copied.startsWith('art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva')).toBe(true);
    expect(copied).toContain(WORDS);
    expect(showToast).toHaveBeenCalledWith('Testo copiato con citazione', 'success');
  });
});

describe('DossierItemReader — an article that did not exist yet', () => {
  it('says so instead of drawing the notice as an article, and copies no citation', async () => {
    const { container } = read(
      { ...PAST_ITEM, data_versione: '2010-01-01' }, NOT_YET, 'Art. 183-bis\n\nARTICOLO NON ANCORA ESISTENTE O VIGENTE',
    );
    expect(await screen.findByText(/Questo articolo non esisteva al 1° gennaio 2010/)).toBeInTheDocument();
    expect(container.querySelector('.vlx-art')).toBeNull();
    expect(screen.getByRole('button', { name: /Copia citazione/ })).toBeDisabled();
  });
});
