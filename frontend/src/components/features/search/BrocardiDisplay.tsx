import React, { useState } from 'react';
import { Lightbulb, ExternalLink, ChevronDown, BookOpen, Link2, FileText, ChevronRight } from 'lucide-react';
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
    <div className="card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl mb-3 overflow-hidden transition-all hover:shadow-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase flex items-center gap-2.5">
          {icon || <Lightbulb size={16} className="text-primary-500" />}
          {title}
        </strong>
        <ChevronDown
          size={16}
          className={cn("text-slate-400 transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>
      {isOpen && (
        <div className="text-sm text-slate-700 dark:text-slate-300">
          {Array.isArray(validContent) ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {validContent.map((item, idx) => {
                const uniqueKey = `brocardi-section-${title || 'unknown'}-item-${idx}`;
                return (
                  <li key={uniqueKey} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <SafeHTML html={String(item || '')} className="inline leading-relaxed" />
                  </li>
                );
              })}
            </ul>
          ) : (
            <SafeHTML
              html={String(validContent || '')}
              className="p-4 prose prose-sm dark:prose-invert max-w-none prose-slate leading-relaxed"
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
    <div className="card bg-white dark:bg-slate-800 border border-amber-200/60 dark:border-amber-900/40 shadow-sm rounded-xl mb-3 overflow-hidden transition-all hover:shadow-md group/relazioni">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-amber-50/50 to-transparent dark:from-amber-950/20 hover:from-amber-100/50 dark:hover:from-amber-900/30 transition-all text-left"
      >
        <strong className="text-xs font-bold text-amber-700 dark:text-amber-500 uppercase flex items-center gap-2.5">
          <BookOpen size={16} className="text-amber-500" />
          Relazioni Storiche
          <span className="px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-[10px] text-amber-700 dark:text-amber-400">
            {relazioni.length}
          </span>
        </strong>
        <ChevronDown
          size={16}
          className={cn("text-amber-400 transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>
      {isOpen && (
        <div className="divide-y divide-amber-100/50 dark:divide-amber-900/20">
          {relazioni.map((rel, idx) => (
            <div key={`relazione-${idx}`} className="p-4 hover:bg-amber-50/30 dark:hover:bg-amber-900/10 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {rel.titolo}
                </span>
                {rel.numero_paragrafo && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    §{rel.numero_paragrafo}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-3">
                {rel.testo}
              </p>
              {rel.articoli_citati && rel.articoli_citati.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/50">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
                    <Link2 size={12} />
                    Articoli citati:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {rel.articoli_citati.map((art, i) => (
                      <button
                        key={`articolo-citato-${idx}-${i}`}
                        onClick={() => handleArticleClick(art.numero)}
                        title={art.titolo}
                        className="px-2 py-1 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer transition-colors border border-amber-100 dark:border-amber-900/30"
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
    <div className="card bg-white dark:bg-slate-800 border border-purple-200/60 dark:border-purple-900/40 shadow-sm rounded-xl mb-3 overflow-hidden transition-all hover:shadow-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-50/50 to-transparent dark:from-purple-950/20 hover:from-purple-100/50 dark:hover:from-purple-900/30 transition-all text-left"
      >
        <strong className="text-xs font-bold text-purple-700 dark:text-purple-400 uppercase flex items-center gap-2.5">
          <BookOpen size={16} className="text-purple-500" />
          {relazione.titolo}
        </strong>
        <ChevronDown
          size={16}
          className={cn("text-purple-400 transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>
      {isOpen && (
        <div className="p-5 hover:bg-purple-50/10 dark:hover:bg-purple-900/5 transition-colors">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            {relazione.autore}, {relazione.anno}
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
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
    <div className="card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl mb-3 overflow-hidden transition-all hover:shadow-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2.5">
          <FileText size={16} className="text-slate-400" />
          Note
          <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            {footnotes.length}
          </span>
        </strong>
        <ChevronDown
          size={16}
          className={cn("text-slate-400 transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>
      {isOpen && (
        <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {footnotes.map((fn, idx) => (
            <div key={`footnote-${fn.numero || idx}`} className="p-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors flex items-start gap-3 group">
              <FootnoteTooltip
                footnote={fn}
                defaultActType={defaultActType}
                onNavigate={handleNavigate}
              />
              <span className="text-sm text-slate-600 dark:text-slate-300 flex-1 leading-relaxed">
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
    <div className="card bg-white dark:bg-slate-800 border border-indigo-200/60 dark:border-indigo-900/40 shadow-sm rounded-xl mb-3 overflow-hidden transition-all hover:shadow-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50/50 to-transparent dark:from-indigo-950/20 hover:from-indigo-100/50 dark:hover:from-indigo-900/30 transition-all text-left"
      >
        <strong className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase flex items-center gap-2.5">
          <Link2 size={16} className="text-indigo-500" />
          Riferimenti ad Altri Articoli
          <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-[10px] text-indigo-700 dark:text-indigo-300">
            {refs.length}
          </span>
        </strong>
        <ChevronDown
          size={16}
          className={cn("text-indigo-400 transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>
      {isOpen && (
        <div className="p-4 space-y-4 bg-white dark:bg-slate-900">
          {Object.entries(groupedRefs).map(([sezione, sectionRefs], sezIdx) => (
            <div key={`crossref-section-${sezione || sezIdx}`} className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700/50">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
                {sectionLabels[sezione as keyof typeof sectionLabels] || sezione}
              </div>
              <div className="flex flex-wrap gap-2">
                {sectionRefs.map((ref, idx) => (
                  <button
                    key={`crossref-${sezione}-${idx}`}
                    onClick={() => handleArticleClick(ref.articolo, ref.tipo_atto)}
                    title={ref.tipo_atto ? `${ref.tipo_atto} - Art. ${ref.articolo}` : `Art. ${ref.articolo}`}
                    className="flex items-center gap-1.5 pl-2 pr-2.5 py-1 text-xs bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/30 cursor-pointer transition-all border border-indigo-100 dark:border-indigo-900/20 shadow-sm"
                  >
                    <span className="font-semibold">Art. {ref.articolo}</span>
                    {ref.tipo_atto && <span className="text-indigo-400 text-[10px]">({ref.tipo_atto})</span>}
                    <ChevronRight size={10} className="text-indigo-300" />
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
    <div className="brocardi-display bg-slate-50/50 dark:bg-slate-800/30 rounded-xl p-4 sm:p-5 border border-slate-100 dark:border-slate-800">
      <button
        onClick={() => setIsMainOpen(!isMainOpen)}
        className="w-full flex items-center justify-between text-primary-700 dark:text-primary-400 font-bold uppercase tracking-wider text-xs mb-4 hover:opacity-80 transition-opacity"
      >
        <span className="flex items-center gap-2">
          <BookOpen size={18} className="text-primary-500" />
          Approfondimenti & Dottrina
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-medium normal-case bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
            Fonte: Brocardi.it
          </span>
          <ChevronDown
            size={16}
            className={cn("transition-transform duration-200", isMainOpen && "rotate-180")}
          />
        </div>
      </button>

      {isMainOpen && (
        <div className="space-y-4 animate-in slide-in-from-top-2 fade-in duration-300">
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
            icon={<FileText size={16} className="text-primary-500" />}
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
            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700/50 flex justify-end">
              <a href={info.link} target="_blank" rel="noreferrer" className="text-xs font-medium text-slate-500 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-400 hover:underline flex items-center gap-1.5 transition-colors">
                Apri su Brocardi.it <ExternalLink size={12} />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
