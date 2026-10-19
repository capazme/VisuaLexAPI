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

import { AdvancedExportModal } from './AdvancedExportModal';
import type { ArticleData } from '../../types';

const articleData: ArticleData = {
  article_text: 'Qualunque fatto doloso o colposo.',
  norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '2043' },
  brocardi_info: {
    position: null,
    link: null,
    Brocardi: ['Neminem laedere'],
    Ratio: 'La ratio della norma.',
    Spiegazione: 'La spiegazione.',
    Massime: null,
  },
};

function renderModal() {
  return render(
    <AdvancedExportModal isOpen onClose={() => {}} articleData={articleData} annotations={[]} highlights={[]} />,
  );
}

function enableDoctrineSections() {
  fireEvent.click(screen.getByRole('button', { name: /Locuzioni latine/ }));
  fireEvent.click(screen.getByRole('button', { name: /Ratio Legis/ }));
  fireEvent.click(screen.getByRole('button', { name: /Spiegazione/ }));
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
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

describe('AdvancedExportModal — the doctrine is credited to its source', () => {
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

  it('copies the text with the credit once, under the first doctrine heading', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderModal();
    enableDoctrineSections();
    fireEvent.click(screen.getByRole('button', { name: /Copia negli appunti/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const content = writeText.mock.calls[0][0] as string;
    expect(content).toContain('=== LOCUZIONI LATINE ===\nFonte: Brocardi.it');
    expect(occurrences(content, 'Fonte: Brocardi.it')).toBe(1);
  });

  it('writes the credit in the Markdown export', async () => {
    renderModal();
    enableDoctrineSections();
    fireEvent.click(screen.getByRole('button', { name: 'MD' }));
    fireEvent.click(screen.getByRole('button', { name: /Scarica MARKDOWN/ }));
    const content = await readBlob(blobs[0]);
    expect(content).toContain('## Locuzioni latine\n\n_Fonte: Brocardi.it_');
    expect(occurrences(content, 'Fonte: Brocardi.it')).toBe(1);
  });

  it('writes the credit in the RTF export', async () => {
    renderModal();
    enableDoctrineSections();
    fireEvent.click(screen.getByRole('button', { name: 'RTF' }));
    fireEvent.click(screen.getByRole('button', { name: /Scarica RTF/ }));
    const content = await readBlob(blobs[0]);
    expect(content).toContain('Locuzioni latine:');
    expect(occurrences(content, 'Fonte: Brocardi.it')).toBe(1);
  });

  it('writes the credit in the PDF export', () => {
    renderModal();
    enableDoctrineSections();
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    const at = pdfLines.indexOf('Locuzioni latine');
    expect(at).toBeGreaterThan(-1);
    expect(pdfLines[at + 1]).toBe('Fonte: Brocardi.it');
    expect(pdfLines.filter((line) => line === 'Fonte: Brocardi.it')).toHaveLength(1);
  });

  it('writes no credit when no doctrine section is exported', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Copia negli appunti/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).not.toContain('Brocardi.it');
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
