import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../utils/articleFetchCache', () => ({ fetchArticleForNorma: vi.fn() }));

import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { DossierItemReader } from './DossierItemReader';
import { appStore } from '../../../store/useAppStore';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import { todayInRome } from '../../../utils/dateUtils';
import type { ArticleUpcoming, ArticleValidity, NormaVisitata } from '../../../types';

const RAW = fixtureText('nrm-cc-1284');
const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1284';
// The item as a dossier stores it: no address of its own.
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

let writeText: Mock<(text: string) => Promise<void>>;
let write: Mock<(items: unknown[]) => Promise<void>>;
const showToast = vi.fn();

function read(norma: NormaVisitata, urn: string | undefined, validity?: ArticleValidity, upcoming?: ArticleUpcoming) {
  vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: RAW, norma_data: { ...norma, urn }, validity, upcoming });
  return render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={showToast} />);
}

class FakeClipboardItem {
  items: Record<string, Blob>;
  constructor(items: Record<string, Blob>) { this.items = items; }
}
const blobText = (blob: Blob) => new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.readAsText(blob);
});

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  write = vi.fn<(items: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText, write } });
  appStore.setState({ highlights: [], annotations: [] });
});

afterEach(() => vi.unstubAllGlobals());

describe('DossierItemReader — «Copia link Normattiva»', () => {
  it('copies the address the API returned and the citation as its link', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    read(CURRENT_ITEM, URN);
    fireEvent.click(await screen.findByRole('button', { name: 'Copia link Normattiva' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const [[[item]]] = write.mock.calls as unknown as [[[FakeClipboardItem]]];
    expect(await blobText(item.items['text/plain'])).toBe(URN);
    expect(await blobText(item.items['text/html'])).toBe(`<a href="${URN}">art. 1284 c.c.</a>`);
    expect(showToast).toHaveBeenCalledWith('Link Normattiva copiato', 'success');
  });

  it('keeps a past text’s version in the link and reads as that version', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    read(PAST_ITEM, `${URN}!vig=2005-06-01`, MIDDLE);
    fireEvent.click(await screen.findByRole('button', { name: 'Copia link Normattiva' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const [[[item]]] = write.mock.calls as unknown as [[[FakeClipboardItem]]];
    expect(await blobText(item.items['text/plain'])).toBe(`${URN}!vig=2005-06-01`);
    expect(await blobText(item.items['text/html'])).toBe(`<a href="${URN}!vig=2005-06-01">art. 1284 c.c., nel testo in vigore al 1° giugno 2005</a>`);
  });

  it('fixes the text in force to today when a later text is announced: Normattiva would open that one', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const current: ArticleValidity = {
      state: 'current', valid_from: '2003-12-25', valid_to: null, version_number: 7, act_updated: null, request_in_window: null,
    };
    read({ ...CURRENT_ITEM, versione: 'vigente' }, `${URN}!vig=`, current, { change: 'abrogated', valid_from: '2999-01-01', version_number: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Copia link Normattiva' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${URN}!vig=${todayInRome()}`));
  });

  it('writes the address alone where the browser has no ClipboardItem', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    read(CURRENT_ITEM, URN);
    fireEvent.click(await screen.findByRole('button', { name: 'Copia link Normattiva' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URN));
    expect(write).not.toHaveBeenCalled();
  });

  it('is locked where «Copia citazione» is: an article that did not exist on the day', async () => {
    read(PAST_ITEM, `${URN}!vig=2005-06-01`, NOT_YET);
    await screen.findByRole('button', { name: 'Copia citazione' });
    expect(screen.getByRole('button', { name: 'Copia link Normattiva' })).toBeDisabled();
  });

  it('is not offered when the norm holds no address of its source', async () => {
    read(CURRENT_ITEM, undefined);
    await screen.findByRole('button', { name: 'Copia citazione' });
    expect(screen.queryByRole('button', { name: /Copia link/ })).not.toBeInTheDocument();
  });
});
