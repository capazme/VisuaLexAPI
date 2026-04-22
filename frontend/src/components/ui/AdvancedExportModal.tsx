import { useState, useMemo } from 'react';
import { Download, Copy, Check, ChevronDown, ChevronRight, FileText, BookOpen, StickyNote, Highlighter, Scale } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Modal } from './Modal';
import type { ArticleData, MassimaStructured } from '../../types';

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
  annotations: Array<{ id: string; text: string; createdAt: string }>;
  highlights: Array<{ id: string; text: string; color: string }>;
}

type ExportFormat = 'clipboard' | 'rtf' | 'txt';

export function AdvancedExportModal({
  isOpen,
  onClose,
  articleData,
  annotations,
  highlights,
}: AdvancedExportModalProps) {
  const { article_text, norma_data, brocardi_info } = articleData;

  const [sections, setSections] = useState<ExportSection[]>([
    { id: 'text', label: 'Testo Articolo', icon: <FileText size={16} />, enabled: true },
    { id: 'citation', label: 'Citazione', icon: <Scale size={16} />, enabled: true },
    { id: 'brocardi', label: 'Brocardi', icon: <BookOpen size={16} />, enabled: false },
    { id: 'ratio', label: 'Ratio Legis', icon: <BookOpen size={16} />, enabled: false },
    { id: 'spiegazione', label: 'Spiegazione', icon: <BookOpen size={16} />, enabled: false },
    { id: 'massime', label: 'Massime', icon: <Scale size={16} />, enabled: false },
    { id: 'notes', label: 'Note Personali', icon: <StickyNote size={16} />, enabled: annotations.length > 0 },
    { id: 'highlights', label: 'Evidenziazioni', icon: <Highlighter size={16} />, enabled: highlights.length > 0 },
  ]);

  const massimeList = useMemo(() => {
    if (!brocardi_info?.Massime || !Array.isArray(brocardi_info.Massime)) return [];
    return brocardi_info.Massime
      .filter(m => {
        if (!m) return false;
        const text = typeof m === 'string' ? m : (m as MassimaStructured).massima;
        return text && text.replace(/<[^>]*>/g, '').trim().length > 0;
      })
      .map((m, idx) => {
        const text = typeof m === 'string' ? m : (m as MassimaStructured).massima;
        return {
          id: `massima-${idx}`,
          text: text.replace(/<[^>]*>/g, '').trim(),
          html: text,
          selected: false,
        };
      });
  }, [brocardi_info?.Massime]);

  const [selectedMassime, setSelectedMassime] = useState<Set<string>>(new Set());
  const [massimeExpanded, setMassimeExpanded] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('clipboard');
  const [copied, setCopied] = useState(false);

  const toggleSection = (id: string) => {
    setSections(prev => prev.map(s => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const toggleMassima = (id: string) => {
    setSelectedMassime(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllMassime = () => {
    if (selectedMassime.size === massimeList.length) {
      setSelectedMassime(new Set());
    } else {
      setSelectedMassime(new Set(massimeList.map(m => m.id)));
    }
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
      parts.push(`${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}${norma_data.data ? ` del ${norma_data.data}` : ''}, Art. ${norma_data.numero_articolo}`);
      parts.push('');
    }

    if (isSectionEnabled('brocardi') && brocardi_info?.Brocardi) {
      parts.push('\n=== BROCARDI ===');
      if (Array.isArray(brocardi_info.Brocardi)) {
        brocardi_info.Brocardi.forEach(b => parts.push(`- ${plainText(b)}`));
      } else {
        parts.push(plainText(brocardi_info.Brocardi));
      }
      parts.push('');
    }

    if (isSectionEnabled('ratio') && brocardi_info?.Ratio) {
      parts.push('\n=== RATIO LEGIS ===');
      parts.push(plainText(brocardi_info.Ratio));
      parts.push('');
    }

    if (isSectionEnabled('spiegazione') && brocardi_info?.Spiegazione) {
      parts.push('\n=== SPIEGAZIONE ===');
      parts.push(plainText(brocardi_info.Spiegazione));
      parts.push('');
    }

    if (isSectionEnabled('massime') && selectedMassime.size > 0) {
      parts.push('\n=== MASSIME SELEZIONATE ===');
      massimeList
        .filter(m => selectedMassime.has(m.id))
        .forEach((m, idx) => {
          parts.push(`\n[${idx + 1}] ${m.text}`);
        });
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

    rtf += `\\f0\\fs28\\b ${escape(norma_data.tipo_atto)}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''} - Art. ${escape(norma_data.numero_articolo)}\\b0\\par\\par`;

    if (isSectionEnabled('text') && article_text) {
      rtf += `\\f1\\fs22 ${plainText(article_text)}\\par\\par`;
    }

    if (isSectionEnabled('citation')) {
      rtf += `\\f0\\fs18\\i Tratto da: ${escape(norma_data.tipo_atto)}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}${norma_data.data ? ` del ${escape(norma_data.data)}` : ''}, Art. ${escape(norma_data.numero_articolo)}\\i0\\par\\par`;
    }

    if (isSectionEnabled('brocardi') && brocardi_info?.Brocardi) {
      rtf += `\\f0\\fs20\\b Brocardi:\\b0\\par`;
      if (Array.isArray(brocardi_info.Brocardi)) {
        brocardi_info.Brocardi.forEach(b => {
          rtf += `\\f1\\fs18 - ${plainText(b)}\\par`;
        });
      } else {
        rtf += `\\f1\\fs18 ${plainText(brocardi_info.Brocardi)}\\par`;
      }
      rtf += '\\par';
    }

    if (isSectionEnabled('ratio') && brocardi_info?.Ratio) {
      rtf += `\\f0\\fs20\\b Ratio Legis:\\b0\\par`;
      rtf += `\\f1\\fs18 ${plainText(brocardi_info.Ratio)}\\par\\par`;
    }

    if (isSectionEnabled('spiegazione') && brocardi_info?.Spiegazione) {
      rtf += `\\f0\\fs20\\b Spiegazione:\\b0\\par`;
      rtf += `\\f1\\fs18 ${plainText(brocardi_info.Spiegazione)}\\par\\par`;
    }

    if (isSectionEnabled('massime') && selectedMassime.size > 0) {
      rtf += `\\f0\\fs20\\b Massime Selezionate (${selectedMassime.size}):\\b0\\par\\par`;
      massimeList
        .filter(m => selectedMassime.has(m.id))
        .forEach((m, idx) => {
          rtf += `\\f1\\fs18 [${idx + 1}] ${plainText(m.text)}\\par\\par`;
        });
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

  const hasBrocardiContent = brocardi_info && (brocardi_info.Brocardi || brocardi_info.Ratio || brocardi_info.Spiegazione || massimeList.length > 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Esporta Articolo"
      description={`Art. ${norma_data.numero_articolo} - ${norma_data.tipo_atto}`}
      icon={<Download size={20} />}
      variant="info"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          >
            Annulla
          </button>
          <button
            onClick={handleExport}
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
                <Download size={16} />
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

        {hasBrocardiContent && (
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Approfondimenti Brocardi</h3>
            <div className="grid grid-cols-2 gap-2">
              {sections.filter(s => ['brocardi', 'ratio', 'spiegazione'].includes(s.id)).map(section => {
                const hasContent =
                  (section.id === 'brocardi' && brocardi_info?.Brocardi) ||
                  (section.id === 'ratio' && brocardi_info?.Ratio) ||
                  (section.id === 'spiegazione' && brocardi_info?.Spiegazione);

                if (!hasContent) return null;

                return (
                  <button
                    key={section.id}
                    onClick={() => toggleSection(section.id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left',
                      section.enabled
                        ? 'bg-brocardi/10 border-brocardi/30 text-brocardi-foreground dark:text-brocardi'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    )}
                  >
                    {section.icon}
                    <span className="text-sm font-medium">{section.label}</span>
                    {section.enabled && <Check size={14} className="ml-auto" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {massimeList.length > 0 && (
          <div>
            <button
              onClick={() => {
                setMassimeExpanded(!massimeExpanded);
                if (!massimeExpanded) {
                  toggleSection('massime');
                }
              }}
              className="flex items-center gap-2 w-full text-left"
            >
              {massimeExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Massime ({massimeList.length} disponibili)
              </h3>
              {selectedMassime.size > 0 && (
                <span className="ml-auto text-xs bg-brocardi/15 text-brocardi-foreground dark:text-brocardi px-2 py-0.5 rounded-full">
                  {selectedMassime.size} selezionate
                </span>
              )}
            </button>

            {massimeExpanded && (
              <div className="mt-3 space-y-2">
                <button
                  onClick={selectAllMassime}
                  className="text-xs text-primary-600 dark:text-primary-400 hover:underline mb-2"
                >
                  {selectedMassime.size === massimeList.length ? 'Deseleziona tutte' : 'Seleziona tutte'}
                </button>

                <div className="max-h-64 overflow-y-auto space-y-2 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                  {massimeList.map((massima, idx) => (
                    <label
                      key={massima.id}
                      className={cn(
                        'flex items-start gap-3 p-2 rounded-lg cursor-pointer transition-colors',
                        selectedMassime.has(massima.id)
                          ? 'bg-brocardi/10'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedMassime.has(massima.id)}
                        onChange={() => toggleMassima(massima.id)}
                        className="mt-1 rounded border-slate-300 dark:border-slate-600 text-brocardi focus:ring-brocardi"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-slate-400 mb-1 block">#{idx + 1}</span>
                        <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-3">
                          {massima.text.substring(0, 200)}
                          {massima.text.length > 200 && '...'}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
              onClick={() => setExportFormat('rtf')}
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
      </div>
    </Modal>
  );
}
