import { useEffect, useRef, useState } from 'react';
import { Download, Copy, Check, FileText, StickyNote, Highlighter, Scale, FileCode, FileType } from 'lucide-react';
import type { jsPDF } from 'jspdf';
import { loadJsPdf } from '../../utils/loadJsPdf';
import { cn } from '../../lib/utils';
import { Modal } from './Modal';
import type { ArticleData } from '../../types';
import { citeNorm, inForceCitation, shortNorm } from '../../utils/sources';
import { todayInRome } from '../../utils/dateUtils';

interface ExportSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
}

interface AdvancedExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  articleData: ArticleData;
  /**
   * `anchorText` is optional — notes saved before the anchor feature
   * don't have one. Markdown export surfaces it as a blockquote so the
   * reader sees what the note refers to, matching the chip shown in
   * the notes panel.
   */
  annotations: Array<{ id: string; text: string; createdAt: string; anchorText?: string }>;
  highlights: Array<{ id: string; text: string; color: string }>;
}

type ExportFormat = 'clipboard' | 'markdown' | 'pdf' | 'rtf' | 'txt';

export function AdvancedExportModal({
  isOpen,
  onClose,
  articleData,
  annotations,
  highlights,
}: AdvancedExportModalProps) {
  const { article_text, norma_data } = articleData;

  const [sections, setSections] = useState<ExportSection[]>([
    { id: 'text', label: 'Testo Articolo', icon: <FileText size={16} />, enabled: true },
    { id: 'citation', label: 'Citazione', icon: <Scale size={16} />, enabled: true },
    { id: 'notes', label: 'Note Personali', icon: <StickyNote size={16} />, enabled: annotations.length > 0 },
    { id: 'highlights', label: 'Evidenziazioni', icon: <Highlighter size={16} />, enabled: highlights.length > 0 },
  ]);

  const [exportFormat, setExportFormat] = useState<ExportFormat>('clipboard');
  const [copied, setCopied] = useState(false);
  // The PDF waits for jsPDF the first time: the button turns its icon into a spinner, its words as they are.
  const [writingPdf, setWritingPdf] = useState(false);
  // A PDF that could not be written (jsPDF not loaded: offline, or a chunk a deploy removed) says so with the
  // decision's words; the next export tries again.
  const [pdfFailed, setPdfFailed] = useState(false);
  // Open and mounted: a host that closes or unmounts the modal while jsPDF loads (StudyMode's Esc leaves the
  // whole mode) cancels the download.
  const live = useRef(isOpen);
  useEffect(() => {
    live.current = isOpen;
    return () => { live.current = false; };
  }, [isOpen]);

  const close = () => {
    if (writingPdf) return;
    setPdfFailed(false);
    onClose();
  };

  const toggleSection = (id: string) => {
    setSections(prev => prev.map(s => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const isSectionEnabled = (id: string) => sections.find(s => s.id === id)?.enabled ?? false;

  const generateExportContent = () => {
    const parts: string[] = [];
    const plainText = (txt: string) => txt.replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim();

    if (isSectionEnabled('text') && article_text) {
      parts.push('=== TESTO ARTICOLO ===\n');
      parts.push(plainText(article_text));
      parts.push('\n');
    }

    if (isSectionEnabled('citation')) {
      parts.push('\n--- Citazione ---');
      parts.push(inForceCitation(norma_data, todayInRome()));
      parts.push('');
    }

    if (isSectionEnabled('notes') && annotations.length > 0) {
      parts.push('\n=== NOTE PERSONALI ===');
      annotations.forEach((n, idx) => {
        parts.push(`${idx + 1}. ${n.text}`);
      });
      parts.push('');
    }

    if (isSectionEnabled('highlights') && highlights.length > 0) {
      parts.push('\n=== EVIDENZIAZIONI ===');
      highlights.forEach((h, idx) => {
        parts.push(`${idx + 1}. "${h.text}"`);
      });
      parts.push('');
    }

    return parts.join('\n');
  };

  const generateRtfContent = () => {
    const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
    const plainText = (txt: string) => escape(txt.replace(/<[^>]*>/g, '').replace(/\n/g, '\\par ').trim());

    let rtf = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}{\\f1 Times New Roman;}}';

    rtf += `\\f0\\fs28\\b ${escape(citeNorm(norma_data))}\\b0\\par\\par`;

    if (isSectionEnabled('text') && article_text) {
      rtf += `\\f1\\fs22 ${plainText(article_text)}\\par\\par`;
    }

    if (isSectionEnabled('citation')) {
      rtf += `\\f0\\fs18\\i ${escape(inForceCitation(norma_data, todayInRome()))}\\i0\\par\\par`;
    }

    if (isSectionEnabled('notes') && annotations.length > 0) {
      rtf += `\\f0\\fs20\\b Note Personali:\\b0\\par`;
      annotations.forEach((n, idx) => {
        rtf += `\\f1\\fs18 ${idx + 1}. ${escape(n.text)}\\par`;
      });
      rtf += '\\par';
    }

    if (isSectionEnabled('highlights') && highlights.length > 0) {
      rtf += `\\f0\\fs20\\b Evidenziazioni:\\b0\\par`;
      highlights.forEach((h, idx) => {
        rtf += `\\f1\\fs18 ${idx + 1}. "${escape(h.text)}"\\par`;
      });
      rtf += '\\par';
    }

    rtf += '}';
    return rtf;
  };

  /**
   * Markdown export: the one format that survives round-tripping
   * through note-taking apps (Obsidian, iA Writer, Notion) without
   * losing structure. Mirrors the sections of the plain-text export
   * but uses proper Markdown headings and blockquotes; highlights
   * come with an emoji cue per colour so a quick scan still
   * distinguishes them in a mono-color reader.
   */
  const generateMarkdownContent = () => {
    const plainText = (txt: string) => txt.replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n').trim();
    const lines: string[] = [];

    lines.push(`# ${citeNorm(norma_data)}`);
    lines.push('');

    if (isSectionEnabled('text') && article_text) {
      lines.push('## Testo');
      lines.push('');
      // Preserve paragraph breaks; single \n inside a paragraph in MD just
      // renders as a soft break, which is fine for article bodies.
      lines.push(plainText(article_text));
      lines.push('');
    }

    if (isSectionEnabled('citation')) {
      lines.push(`> ${inForceCitation(norma_data, todayInRome())}`);
      lines.push('');
    }

    if (isSectionEnabled('highlights') && highlights.length > 0) {
      lines.push('## Evidenziazioni');
      lines.push('');
      const swatch = (color: string) => {
        switch (color) {
          case 'yellow': return '🟡';
          case 'green': return '🟢';
          case 'red': return '🔴';
          case 'blue': return '🔵';
          default: return '•';
        }
      };
      highlights.forEach((h) => {
        lines.push(`- ${swatch(h.color)} "${h.text}"`);
      });
      lines.push('');
    }

    if (isSectionEnabled('notes') && annotations.length > 0) {
      lines.push('## Note');
      lines.push('');
      annotations.forEach((n, idx) => {
        if (n.anchorText) {
          lines.push(`**${idx + 1}.** > _${n.anchorText}_`);
          lines.push('');
          lines.push(`   ${n.text}`);
        } else {
          lines.push(`**${idx + 1}.** ${n.text}`);
        }
        lines.push('');
      });
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  };

  /**
   * Client-side PDF generation via jsPDF. The backend's /export_pdf
   * endpoint fetches Normattiva's PDF directly and has no support for
   * user-supplied notes / highlights, so producing a "study" PDF with
   * the reader's annotations has to happen in the browser. Keeps the
   * layout intentionally simple (serif body, bold H2s, plain bullet
   * lists) — the goal is a readable printable, not a typeset document.
   */
  const buildPdf = async (): Promise<jsPDF> => {
    const plainText = (txt: string) => txt.replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n').trim();
    // jsPDF is loaded here, on the export.
    const JsPdf = await loadJsPdf();
    const doc = new JsPdf({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const margin = 48;
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    const textWidth = width - margin * 2;

    let y = margin;
    const ensureSpace = (needed: number) => {
      if (y + needed > height - margin) {
        doc.addPage();
        y = margin;
      }
    };

    const writeParagraph = (text: string, opts: { size: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; gapAfter?: number } = { size: 11 }) => {
      if (!text) return;
      const { size, bold, italic, color, gapAfter = 8 } = opts;
      doc.setFont('times', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...(color ?? [30, 30, 30]));
      const lines = doc.splitTextToSize(text, textWidth) as string[];
      const lineHeight = size * 1.25;
      for (const line of lines) {
        ensureSpace(lineHeight);
        doc.text(line, margin, y);
        y += lineHeight;
      }
      y += gapAfter;
    };

    const writeHeading = (text: string) => {
      ensureSpace(24);
      writeParagraph(text, { size: 14, bold: true, color: [15, 23, 42], gapAfter: 6 });
    };

    // Title
    writeParagraph(citeNorm(norma_data), { size: 18, bold: true, color: [15, 23, 42], gapAfter: 14 });

    if (isSectionEnabled('text') && article_text) {
      writeHeading('Testo');
      writeParagraph(plainText(article_text), { size: 11 });
    }

    if (isSectionEnabled('citation')) {
      writeParagraph(inForceCitation(norma_data, todayInRome()), { size: 10, italic: true, color: [82, 82, 91] });
    }

    if (isSectionEnabled('highlights') && highlights.length > 0) {
      writeHeading('Evidenziazioni');
      const label = (color: string) => {
        switch (color) {
          case 'yellow': return '[giallo]';
          case 'green': return '[verde]';
          case 'red': return '[rosso]';
          case 'blue': return '[blu]';
          default: return '[•]';
        }
      };
      highlights.forEach((h) => {
        writeParagraph(`${label(h.color)} "${h.text}"`, { size: 10, gapAfter: 4 });
      });
      y += 4;
    }

    if (isSectionEnabled('notes') && annotations.length > 0) {
      writeHeading('Note');
      annotations.forEach((n, idx) => {
        if (n.anchorText) {
          writeParagraph(`${idx + 1}. "${n.anchorText}"`, { size: 10, italic: true, color: [146, 102, 31], gapAfter: 2 });
          writeParagraph(n.text, { size: 11, gapAfter: 8 });
        } else {
          writeParagraph(`${idx + 1}. ${n.text}`, { size: 11, gapAfter: 8 });
        }
      });
    }

    return doc;
  };

  const handleExport = async () => {
    const content = generateExportContent();

    if (exportFormat === 'clipboard') {
      try {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Copy failed:', err);
      }
    } else if (exportFormat === 'markdown') {
      const mdContent = generateMarkdownContent();
      const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `VisuaLex_${norma_data.tipo_atto.replace(/\s+/g, '_')}_Art${norma_data.numero_articolo}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      onClose();
    } else if (exportFormat === 'pdf') {
      setWritingPdf(true);
      setPdfFailed(false);
      try {
        const doc = await buildPdf();
        if (!live.current) return;
        doc.save(`VisuaLex_${norma_data.tipo_atto.replace(/\s+/g, '_')}_Art${norma_data.numero_articolo}.pdf`);
        onClose();
      } catch (err) {
        console.error('PDF export failed:', err);
        setPdfFailed(true);
      } finally {
        setWritingPdf(false);
      }
    } else if (exportFormat === 'rtf') {
      const rtfContent = generateRtfContent();
      const blob = new Blob([rtfContent], { type: 'application/rtf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `VisuaLex_${norma_data.tipo_atto.replace(/\s+/g, '_')}_Art${norma_data.numero_articolo}.rtf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      onClose();
    } else if (exportFormat === 'txt') {
      const blob = new Blob([content], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `VisuaLex_${norma_data.tipo_atto.replace(/\s+/g, '_')}_Art${norma_data.numero_articolo}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      size="lg"
      title="Esporta Articolo"
      description={shortNorm(norma_data)}
      icon={<Download size={20} />}
      variant="info"
      footer={
        <>
          <button
            onClick={close}
            disabled={writingPdf}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          >
            Annulla
          </button>
          <button
            onClick={handleExport}
            disabled={writingPdf}
            aria-busy={writingPdf || undefined}
            className={cn(
              'px-6 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
              copied
                ? 'bg-green-600 text-white'
                : 'bg-primary-600 hover:bg-primary-700 text-white'
            )}
          >
            {copied ? (
              <>
                <Check size={16} />
                Copiato!
              </>
            ) : exportFormat === 'clipboard' ? (
              <>
                <Copy size={16} />
                Copia negli appunti
              </>
            ) : (
              <>
                {writingPdf ? (
                  <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
                ) : (
                  <Download size={16} />
                )}
                Scarica {exportFormat.toUpperCase()}
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Contenuto Base</h3>
          <div className="grid grid-cols-2 gap-2">
            {sections.filter(s => ['text', 'citation'].includes(s.id)).map(section => (
              <button
                key={section.id}
                onClick={() => toggleSection(section.id)}
                disabled={writingPdf}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left',
                  section.enabled
                    ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                )}
              >
                {section.icon}
                <span className="text-sm font-medium">{section.label}</span>
                {section.enabled && <Check size={14} className="ml-auto" />}
              </button>
            ))}
          </div>
        </div>

        {(annotations.length > 0 || highlights.length > 0) && (
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Contenuto Personale</h3>
            <div className="grid grid-cols-2 gap-2">
              {sections.filter(s => ['notes', 'highlights'].includes(s.id)).map(section => {
                const hasContent =
                  (section.id === 'notes' && annotations.length > 0) ||
                  (section.id === 'highlights' && highlights.length > 0);

                if (!hasContent) return null;

                const count = section.id === 'notes' ? annotations.length : highlights.length;

                return (
                  <button
                    key={section.id}
                    onClick={() => toggleSection(section.id)}
                    disabled={writingPdf}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left',
                      section.enabled
                        ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    )}
                  >
                    {section.icon}
                    <span className="text-sm font-medium">{section.label}</span>
                    <span className="text-xs opacity-60">({count})</span>
                    {section.enabled && <Check size={14} className="ml-auto" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Formato Esportazione</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setExportFormat('clipboard')}
              disabled={writingPdf}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                exportFormat === 'clipboard'
                  ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              )}
            >
              <Copy size={16} />
              <span className="text-sm font-medium">Copia</span>
            </button>
            <button
              onClick={() => setExportFormat('markdown')}
              disabled={writingPdf}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                exportFormat === 'markdown'
                  ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              )}
            >
              <FileCode size={16} />
              <span className="text-sm font-medium">MD</span>
            </button>
            <button
              onClick={() => setExportFormat('pdf')}
              disabled={writingPdf}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                exportFormat === 'pdf'
                  ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              )}
            >
              <FileType size={16} />
              <span className="text-sm font-medium">PDF</span>
            </button>
            <button
              onClick={() => setExportFormat('rtf')}
              disabled={writingPdf}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                exportFormat === 'rtf'
                  ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              )}
            >
              <FileText size={16} />
              <span className="text-sm font-medium">RTF</span>
            </button>
            <button
              onClick={() => setExportFormat('txt')}
              disabled={writingPdf}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                exportFormat === 'txt'
                  ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              )}
            >
              <FileText size={16} />
              <span className="text-sm font-medium">TXT</span>
            </button>
          </div>
        </div>
        {pdfFailed && <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">Download non riuscito: riprova.</p>}
      </div>
    </Modal>
  );
}
