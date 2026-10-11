import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../utils/articleFetchCache', () => ({ fetchArticleForNorma: vi.fn() }));

import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import { UNRELIABLE_REASON } from '../../../utils/versionDisplay';
import type { ArticleValidity, NormaVisitata } from '../../../types';
import { ArticleReadOnly } from './ArticleReadOnly';

const RAW = fixtureText('nrm-cc-1453');
const WORDS = 'Nei contratti con prestazioni corrispettive';
const CURRENT: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1453' };
const PAST: NormaVisitata = { ...CURRENT, versione: 'vigente', data_versione: '2005-06-01' };
const MIDDLE: ArticleValidity = {
  state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: true,
};
const NOT_YET: ArticleValidity = {
  state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true,
};

const RECT = { x: 40, y: 120, width: 90, height: 18 };
const originalRect = Range.prototype.getBoundingClientRect;
let writeText: Mock<(text: string) => Promise<void>>;
let showToast: Mock<(message: string, type?: 'success' | 'error' | 'info') => void>;

function read(norma: NormaVisitata, validity?: ArticleValidity, text = RAW) {
  vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: text, norma_data: norma, validity });
  return render(<ArticleReadOnly norma={norma} showToast={showToast} />);
}

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

/** Select until the popup's copy button shows: the text can be drawn again after the first paint. */
function selectForCopy(container: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const button = screen.queryByTitle(/^Copia \(/);
    if (button) return button;
    select(container, WORDS);
    throw new Error('the selection popup is not open yet');
  }, { timeout: 3000 });
}

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  showToast = vi.fn();
  Object.assign(navigator, { clipboard: { writeText } });
  // jsdom has no layout: give the range a rect so the popup can position.
  Range.prototype.getBoundingClientRect = () =>
    ({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  Range.prototype.getBoundingClientRect = originalRect;
  window.getSelection()?.removeAllRanges();
});

describe('ArticleReadOnly — copy', () => {
  it('offers «Copia» alone on a selection: no highlight, no note', async () => {
    const { container } = read(CURRENT);
    await selectForCopy(container);
    expect(screen.queryByTitle(/Evidenzia|Aggiungi nota|Nota/)).toBeNull();
    expect(container.querySelector('mark')).toBeNull();
  });

  it('copies the selected words with the citation first, and says so', async () => {
    const { container } = read(PAST, MIDDLE);
    fireEvent.click(await selectForCopy(container));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0];
    expect(copied.startsWith('art. 1453 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva')).toBe(true);
    expect(copied).toContain(WORDS);
    expect(showToast).toHaveBeenCalledWith('Testo copiato con citazione', 'success');
  });

  it('copies with the citation of the text in force when no day was asked', async () => {
    const { container } = read(CURRENT);
    fireEvent.click(await selectForCopy(container));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(/^art\. 1453 c\.c\. \(Normattiva/);
    expect(writeText.mock.calls[0][0]).toContain(WORDS);
  });

  it('does not copy a version that does not contain the day asked, and says why', async () => {
    const { container } = read(PAST, { ...MIDDLE, request_in_window: false });
    fireEvent.click(await selectForCopy(container));
    await act(async () => { await Promise.resolve(); }); // the handler is async: let a write, if any, happen
    expect(writeText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(UNRELIABLE_REASON, 'info');
    expect(showToast).not.toHaveBeenCalledWith('Testo copiato con citazione', 'success');
  });

  it('says the copy failed when the clipboard refuses', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const { container } = read(PAST, MIDDLE);
    fireEvent.click(await selectForCopy(container));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Errore durante la copia', 'error'));
  });

  it('draws no text, and so offers no copy, for an article that did not exist yet', async () => {
    const { container } = read({ ...PAST, data_versione: '2010-01-01' }, NOT_YET, 'Art. 183-bis\n\nARTICOLO NON ANCORA ESISTENTE O VIGENTE');
    expect(await screen.findByText(/Questo articolo non esisteva al 1° gennaio 2010/)).toBeInTheDocument();
    expect(container.querySelector('.vlx-art')).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });
});
