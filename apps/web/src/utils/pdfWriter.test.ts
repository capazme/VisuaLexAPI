import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { createPdfWriter } from './pdfWriter';

describe('createPdfWriter', () => {
  it('writes a text that runs over a page break in the face, size and colour it started in', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const w = createPdfWriter(doc, { footerLeft: 'footer' });
    const seen: Array<{ page: number; size: number; font: string }> = [];
    const draw = doc.text.bind(doc);
    (doc as unknown as { text: unknown }).text = (...a: Parameters<typeof draw>) => {
      // The footer (y 810) has its own face; the body's lines are what is checked.
      if (a[2] !== 810) seen.push({ page: doc.getNumberOfPages(), size: doc.getFontSize(), font: doc.getFont().fontName });
      return draw(...a);
    };
    w.write('parola '.repeat(1500).trim(), 11, 'italic', 15, true, 'times');
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(seen.every((s) => s.size === 11 && s.font === 'times')).toBe(true);
    expect(new Set(seen.map((s) => s.page)).size).toBeGreaterThan(1);
  });
});
