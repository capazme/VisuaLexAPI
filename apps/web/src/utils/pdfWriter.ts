/**
 * The page layout the app's own PDFs share (the dossier's, a decision's): A4 in points, a margin,
 * a running `y`, a footer on every page and text that wraps and breaks onto a new page. Pure
 * drawing helpers over a jsPDF document; what a PDF says is each caller's business.
 */
import type { jsPDF } from 'jspdf';

export type PdfFont = 'helvetica' | 'times';
export type PdfStyle = 'normal' | 'bold' | 'italic';

export const PDF_MARGIN = 44;
export const PDF_WIDTH = 507;
const PDF_TOP = 54;
const PDF_BOTTOM = 770;
const PDF_FOOTER_Y = 810;
const PDF_RIGHT = 555;

export interface PdfWriter {
  doc: jsPDF;
  /** The next line's baseline. */
  y: number;
  /** Goes to a new page (footer first) when `height` does not fit. */
  ensureSpace(height: number): void;
  /** Writes ready-wrapped lines at the left margin, one `lineHeight` apart. */
  writeLines(lines: string[], lineHeight: number): void;
  /** Wraps `text` to the page width and writes it. */
  write(text: string, size: number, style: PdfStyle, lineHeight: number, grey?: boolean): void;
  /** The running footer of the page being finished: `footerLeft` and the page number. */
  footer(): void;
}

/**
 * The font is one of jsPDF's standard fonts, which hold Windows-1252 only: Latin text with the
 * Italian accents, «», — and ° is fine; a character outside it (Greek, mathematical signs, some
 * Eastern European letters) is not drawn as itself. jsPDF writes an unrelated glyph or a
 * placeholder there and does not warn. Embedding a TrueType font would lift the limit.
 */
export function createPdfWriter(doc: jsPDF, options: { footerLeft: string; font?: PdfFont }): PdfWriter {
  const font = options.font ?? 'helvetica';
  const writer: PdfWriter = {
    doc,
    y: PDF_TOP,
    ensureSpace(height) {
      if (writer.y + height <= PDF_BOTTOM) return;
      writer.footer();
      doc.addPage();
      writer.y = PDF_TOP;
    },
    writeLines(lines, lineHeight) {
      lines.forEach((line) => {
        writer.ensureSpace(lineHeight);
        doc.text(line, PDF_MARGIN, writer.y);
        writer.y += lineHeight;
      });
    },
    write(text, size, style, lineHeight, grey = false) {
      doc.setFontSize(size);
      doc.setFont(font, style);
      doc.setTextColor(grey ? 100 : 0);
      writer.writeLines(doc.splitTextToSize(text, PDF_WIDTH) as string[], lineHeight);
      doc.setTextColor(0);
    },
    footer() {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(options.footerLeft, PDF_MARGIN, PDF_FOOTER_Y);
      doc.text(`Pagina ${doc.getNumberOfPages()}`, PDF_RIGHT, PDF_FOOTER_Y, { align: 'right' });
      doc.setTextColor(0);
    },
  };
  return writer;
}
