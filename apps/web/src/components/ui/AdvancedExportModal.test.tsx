import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pdfLines: string[] = [];

vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    addPage() {}
    splitTextToSize(text: string) {
      return [text];
    }
    text(line: string) {
      pdfLines.push(line);
    }
    save() {}
  },
}));

// jsPDF's arrival, held by a test that wants to act while it waits; otherwise it comes at once.
const { gate } = vi.hoisted(() => ({ gate: { held: null as null | { promise: Promise<void>; open: () => void; fail: () => void } } }));
vi.mock('../../utils/loadJsPdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../utils/loadJsPdf')>();
  return { loadJsPdf: async () => { if (gate.held) await gate.held.promise; return real.loadJsPdf(); } };
});
function holdJsPdf() {
  let open = () => {};
  let fail = () => {};
  const promise = new Promise<void>((resolve, reject) => { open = resolve; fail = () => reject(new Error('offline')); });
  gate.held = { promise, open, fail };
  return gate.held;
}

import { AdvancedExportModal } from './AdvancedExportModal';
import type { ArticleData } from '../../types';

const articleData: ArticleData = {
  article_text: 'Qualunque fatto doloso o colposo.',
  norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '2043' },
};
// An article as a reader that never reloaded may still hold it from before D-078 (no Brocardi text here)
const legacyArticle = {
  ...articleData,
  brocardi_info: { position: null, link: null, Brocardi: ['Neminem laedere'], Ratio: 'La ratio della norma.', Spiegazione: 'La spiegazione.', Massime: ['Una massima.'] },
} as unknown as ArticleData;

function renderModal(data: ArticleData = articleData) {
  return render(
    <AdvancedExportModal isOpen onClose={() => {}} articleData={data} annotations={[]} highlights={[]} />,
  );
}

let blobs: Blob[];

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const BROCARDI_WORDS = /Brocardi|Neminem|ratio della norma|spiegazione|massima|Locuzioni|Ratio Legis|Massime/i;

describe('AdvancedExportModal — nothing of Brocardi (D-078)', () => {
  beforeEach(() => {
    pdfLines.length = 0;
    blobs = [];
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the text, the citation and the reader\'s own, and no doctrine section, whatever the article still holds', () => {
    renderModal(legacyArticle);
    expect(screen.getByRole('button', { name: /Testo Articolo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Citazione/ })).toBeInTheDocument();
    expect(screen.queryByText(/Approfondimenti|dottrina/i)).toBeNull();
    expect(screen.queryByText(BROCARDI_WORDS)).toBeNull();
  });

  it('copies the text and nothing of Brocardi', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderModal(legacyArticle);
    fireEvent.click(screen.getByRole('button', { name: /Copia negli appunti/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const content = writeText.mock.calls[0][0] as string;
    expect(content).toContain('Qualunque fatto doloso o colposo.');
    expect(content).not.toMatch(BROCARDI_WORDS);
  });

  it.each([['MD', /Scarica MARKDOWN/], ['RTF', /Scarica RTF/], ['TXT', /Scarica TXT/]])('writes the %s file with the text and nothing of Brocardi', async (format, download) => {
    renderModal(legacyArticle);
    fireEvent.click(screen.getByRole('button', { name: format }));
    fireEvent.click(screen.getByRole('button', { name: download }));
    const content = await readBlob(blobs[0]);
    expect(content).toContain('Qualunque fatto doloso o colposo.');
    expect(content).not.toMatch(BROCARDI_WORDS);
  });

  it('writes the PDF with the text and nothing of Brocardi', async () => {
    renderModal(legacyArticle);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    // jsPDF comes on the first export: the lines follow it.
    await waitFor(() => expect(pdfLines).toContain('Qualunque fatto doloso o colposo.'));
    expect(pdfLines.join('\n')).not.toMatch(BROCARDI_WORDS);
  });

  it('shows the wait for jsPDF in «Scarica PDF», its words as they are', async () => {
    const onClose = vi.fn();
    render(<AdvancedExportModal isOpen onClose={onClose} articleData={articleData} annotations={[]} highlights={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    const button = screen.getByRole('button', { name: /Scarica PDF/ });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Scarica PDF');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('cannot be closed while the PDF waits for jsPDF, and closes once it is saved', async () => {
    const held = holdJsPdf();
    const onClose = vi.fn();
    render(<AdvancedExportModal isOpen onClose={onClose} articleData={articleData} annotations={[]} highlights={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copia' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onClose).not.toHaveBeenCalled();
    held.open();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(pdfLines).toContain('Qualunque fatto doloso o colposo.');
    gate.held = null;
  });

  it('when jsPDF cannot be loaded, gives the buttons back and stays open', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const held = holdJsPdf();
    const onClose = vi.fn();
    render(<AdvancedExportModal isOpen onClose={onClose} articleData={articleData} annotations={[]} highlights={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    const button = screen.getByRole('button', { name: /Scarica PDF/ });
    fireEvent.click(button);
    held.fail();
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    gate.held = null;
    error.mockRestore();
  });
});

describe('AdvancedExportModal — the citation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cites the text in force in the source convention, with its source and the day (D8)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Copia negli appunti/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0] as string)
      .toMatch(/--- Citazione ---\nart\. 2043 c\.c\. \(Normattiva, testo vigente, consultato (?:il |l')[^)]+\)/);
  });
});
