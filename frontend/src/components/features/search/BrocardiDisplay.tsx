import React, { useState } from 'react';
import { Lightbulb, ExternalLink, ChevronDown, BookOpen, Link2, FileText } from 'lucide-react';
import type { BrocardiInfo as BrocardiInfoType, RelazioneContent, Footnote, CrossReference } from '../../../types';
import { cn } from '../../../lib/utils';
import { SafeHTML } from '../../../utils/sanitize';
import { MassimeSection } from './MassimeSection';
import { FootnoteTooltip } from './FootnoteTooltip';
import { useAppStore } from '../../../store/useAppStore';

// Error Boundary for BrocardiSection
class BrocardiSectionErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('BrocardiSection error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return null; // Silently fail - don't show broken section
    }
    return this.props.children;
  }
}

interface BrocardiSectionProps {
  title: string;
  content: string | string[] | null;
  icon?: React.ReactNode;
}

function BrocardiSectionContent({ title, content, icon }: BrocardiSectionProps) {
  const [isOpen, setIsOpen] = React.useState(true);

  // Strict early validation
  if (content === null || content === undefined) return null;
  if (typeof content !== 'string' && !Array.isArray(content)) {
    console.warn(`[BrocardiSection] Invalid content type for "${title}":`, typeof content, content);
    return null;
  }
  if (Array.isArray(content) && content.length === 0) return null;
  if (typeof content === 'string' && content.trim().length === 0) return null;

  // Process arrays
  let validContent: string | string[];
  if (Array.isArray(content)) {
    validContent = content
      .filter(item => {
        // Strict type checking
        if (item === null || item === undefined) return false;
        if (typeof item !== 'string') {
          console.warn(`[BrocardiSection] Non-string item in "${title}":`, typeof item, item);
          return false;
        }
        const stripped = item.replace(/<[^>]*>/g, '').trim();
        return stripped.length > 0;
      })
      .filter((item, idx, arr) => arr.indexOf(item) === idx); // Deduplicate

    if (validContent.length === 0) return null;
  } else {
    validContent = content;
  }

  return (
    <div className="card border border-gray-200 dark:border-gray-700 shadow-sm rounded-md mb-3 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
          {icon || <Lightbulb size={14} className="text-blue-600" />}
          {title}
        </strong>
        <span className={cn("transition-transform text-gray-400", isOpen ? "rotate-180" : "")}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300">
          {Array.isArray(validContent) ? (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {validContent.map((item, idx) => {
                // Generate guaranteed unique key
                const uniqueKey = `brocardi-section-${title || 'unknown'}-item-${idx}`;

                return (
                  <li key={uniqueKey} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <SafeHTML html={String(item || '')} className="inline" />
                  </li>
                );
              })}
            </ul>
          ) : (
            <SafeHTML
              html={String(validContent || '')}
              className="p-3 prose prose-sm dark:prose-invert max-w-none"
            />
          )}
        </div>
      )}
    </div>
  );
}

// Wrapper with error boundary
function BrocardiSection(props: BrocardiSectionProps) {
  return (
    <BrocardiSectionErrorBoundary>
      <BrocardiSectionContent {...props} />
    </BrocardiSectionErrorBoundary>
  );
}

// Component for displaying Relazioni (historical relations)
function RelazioniSection({
  relazioni,
  onArticleClick
}: {
  relazioni: RelazioneContent[];
  onArticleClick?: (articleNumber: string, tipoAtto: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerSearch = useAppStore((state) => state.triggerSearch);

  if (!relazioni || relazioni.length === 0) return null;

  const handleArticleClick = (articleNumber: string) => {
    if (onArticleClick) {
      onArticleClick(articleNumber, 'codice civile');
    } else {
      triggerSearch({
        act_type: 'codice civile',
        act_number: '',
        date: '',
        article: articleNumber,
        version: 'vigente',
        show_brocardi_info: true
      });
    }
  };

  return (
    <div className="card border border-amber-200 dark:border-amber-700 shadow-sm rounded-md mb-3 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase flex items-center gap-2">
          <BookOpen size={14} />
          Relazioni Storiche ({relazioni.length})
        </strong>
        <span className={cn("transition-transform text-amber-500", isOpen ? "rotate-180" : "")}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="bg-white dark:bg-gray-900 divide-y divide-amber-100 dark:divide-amber-900/30">
          {relazioni.map((rel, idx) => (
            <div key={`relazione-${idx}`} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {rel.titolo}
                </span>
                {rel.numero_paragrafo && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    §{rel.numero_paragrafo}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
                {rel.testo}
              </p>
              {rel.articoli_citati && rel.articoli_citati.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                    <Link2 size={10} />
                    Articoli citati:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {rel.articoli_citati.map((art, i) => (
                      <button
                        key={`articolo-citato-${idx}-${i}`}
                        onClick={() => handleArticleClick(art.numero)}
                        title={art.titolo}
                        className="px-2 py-0.5 text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer transition-colors"
                      >
                        Art. {art.numero}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Component for Constitution relation
function RelazioneCostituzione({ relazione }: { relazione: NonNullable<BrocardiInfoType['RelazioneCostituzione']> }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="card border border-purple-200 dark:border-purple-700 shadow-sm rounded-md mb-3 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-purple-700 dark:text-purple-400 uppercase flex items-center gap-2">
          <BookOpen size={14} />
          {relazione.titolo}
        </strong>
        <span className={cn("transition-transform text-purple-500", isOpen ? "rotate-180" : "")}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="bg-white dark:bg-gray-900 p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {relazione.autore}, {relazione.anno}
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            {relazione.testo}
          </p>
        </div>
      )}
    </div>
  );
}

// Component for footnotes (note a piè di pagina)
function FootnotesSection({
  footnotes,
  defaultActType,
  onArticleClick,
}: {
  footnotes: Footnote[];
  defaultActType?: string;
  onArticleClick?: (articleNumber: string, tipoAtto: string) => void;
}) {
  // Aperto di default se poche note (≤5), chiuso se tante
  const [isOpen, setIsOpen] = useState(() => footnotes.length <= 5);
  const triggerSearch = useAppStore((state) => state.triggerSearch);

  if (!footnotes || footnotes.length === 0) return null;

  const handleNavigate = (articleNumber: string, tipoAtto: string) => {
    if (onArticleClick) {
      onArticleClick(articleNumber, tipoAtto);
    } else {
      triggerSearch({
        act_type: tipoAtto,
        act_number: '',
        date: '',
        article: articleNumber,
        version: 'vigente',
        show_brocardi_info: true,
      });
    }
  };

  return (
    <div className="card border border-gray-200 dark:border-gray-700 shadow-sm rounded-md mb-3 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
          <FileText size={14} className="text-gray-600" />
          Note ({footnotes.length})
        </strong>
        <span className={cn("transition-transform text-gray-400", isOpen ? "rotate-180" : "")}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
          {footnotes.map((fn, idx) => (
            <div key={`footnote-${fn.numero || idx}`} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 flex items-start gap-2">
              <FootnoteTooltip
                footnote={fn}
                defaultActType={defaultActType}
                onNavigate={handleNavigate}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">
                {fn.testo}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Component for cross references (riferimenti incrociati)
function CrossReferencesSection({
  refs,
  onArticleClick
}: {
  refs: CrossReference[];
  onArticleClick?: (articleNumber: string, tipoAtto: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerSearch = useAppStore((state) => state.triggerSearch);

  if (!refs || refs.length === 0) return null;

  const handleArticleClick = (articleNumber: string, tipoAtto?: string) => {
    const actType = tipoAtto || 'codice civile';
    if (onArticleClick) {
      onArticleClick(articleNumber, actType);
    } else {
      triggerSearch({
        act_type: actType,
        act_number: '',
        date: '',
        article: articleNumber,
        version: 'vigente',
        show_brocardi_info: true
      });
    }
  };

  // Raggruppa per sezione
  const groupedRefs = refs.reduce((acc, ref) => {
    if (!acc[ref.sezione]) acc[ref.sezione] = [];
    acc[ref.sezione].push(ref);
    return acc;
  }, {} as Record<string, CrossReference[]>);

  const sectionLabels = {
    brocardi: 'Brocardi',
    ratio: 'Ratio',
    spiegazione: 'Spiegazione',
    massime: 'Massime'
  };

  return (
    <div className="card border border-indigo-200 dark:border-indigo-700 shadow-sm rounded-md mb-3 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase flex items-center gap-2">
          <Link2 size={14} />
          Riferimenti ad Altri Articoli ({refs.length})
        </strong>
        <span className={cn("transition-transform text-indigo-500", isOpen ? "rotate-180" : "")}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="bg-white dark:bg-gray-900 p-3 space-y-3">
          {Object.entries(groupedRefs).map(([sezione, sectionRefs], sezIdx) => (
            <div key={`crossref-section-${sezione || sezIdx}`}>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                {sectionLabels[sezione as keyof typeof sectionLabels] || sezione}
              </div>
              <div className="flex flex-wrap gap-2">
                {sectionRefs.map((ref, idx) => (
                  <button
                    key={`crossref-${sezione}-${idx}`}
                    onClick={() => handleArticleClick(ref.articolo, ref.tipo_atto)}
                    title={ref.tipo_atto ? `${ref.tipo_atto} - Art. ${ref.articolo}` : `Art. ${ref.articolo}`}
                    className="px-2 py-1 text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 cursor-pointer transition-colors"
                  >
                    Art. {ref.articolo}
                    {ref.tipo_atto && <span className="ml-1 text-indigo-500">({ref.tipo_atto})</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface BrocardiDisplayProps {
  info: BrocardiInfoType;
  currentNorma?: { tipo_atto: string; data?: string; numero_atto?: string };
  onArticleClick?: (articleNumber: string, tipoAtto: string) => void;
}

export function BrocardiDisplay({ info, currentNorma, onArticleClick }: BrocardiDisplayProps) {
  // Default collapsed on mobile (<768px), expanded on desktop
  const [isMainOpen, setIsMainOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

  // Check if we have any content to display
  const hasContent = info.Brocardi || info.Ratio || info.Spiegazione ||
    (info.Massime && info.Massime.length > 0) ||
    (info.Relazioni && info.Relazioni.length > 0) ||
    (info.CrossReferences && info.CrossReferences.length > 0) ||
    (info.Footnotes && info.Footnotes.length > 0) ||
    info.RelazioneCostituzione;

  if (!hasContent) return null;

  return (
    <div className="brocardi-display mt-8 border-l-4 border-blue-500 pl-6 py-2 bg-blue-50/50 dark:bg-blue-900/10 rounded-r-xl">
      <button
        onClick={() => setIsMainOpen(!isMainOpen)}
        className="flex items-center gap-3 text-blue-800 dark:text-blue-300 font-bold uppercase tracking-wider text-xs mb-4 hover:opacity-80 transition-opacity"
      >
        <Lightbulb size={16} />
        Approfondimenti & Dottrina
        <ChevronDown
          size={14}
          className={cn("transition-transform", isMainOpen && "rotate-180")}
        />
      </button>

      {isMainOpen && (
        <div className="space-y-2">
          <BrocardiSection
            title="Brocardi"
            content={info.Brocardi || null}
          />
          <BrocardiSection
            title="Ratio"
            content={info.Ratio || null}
          />
          <BrocardiSection
            title="Spiegazione"
            content={info.Spiegazione || null}
          />

          {/* Massime with search and filter */}
          {info.Massime && info.Massime.length > 0 && (
            <MassimeSection massime={info.Massime} />
          )}

          {/* Note a piè di pagina */}
          {info.Footnotes && info.Footnotes.length > 0 && (
            <FootnotesSection
              footnotes={info.Footnotes}
              defaultActType={currentNorma?.tipo_atto}
              onArticleClick={onArticleClick}
            />
          )}

          {/* Riferimenti incrociati */}
          {info.CrossReferences && info.CrossReferences.length > 0 && (
            <CrossReferencesSection refs={info.CrossReferences} onArticleClick={onArticleClick} />
          )}

          {/* Historical relations (Guardasigilli) */}
          {info.Relazioni && info.Relazioni.length > 0 && (
            <RelazioniSection relazioni={info.Relazioni} onArticleClick={onArticleClick} />
          )}

          {/* Constitution relation (Meuccio Ruini) */}
          {info.RelazioneCostituzione && (
            <RelazioneCostituzione relazione={info.RelazioneCostituzione} />
          )}

          {info.link && (
            <div className="mt-3 text-right">
              <a href={info.link} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline flex items-center justify-end gap-1">
                Vedi fonte <ExternalLink size={10} />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
