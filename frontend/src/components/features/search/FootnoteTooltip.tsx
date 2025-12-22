import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowUpRight } from 'lucide-react';
import type { Footnote } from '../../../types';
import { extractArticleRefs, type ArticleRef } from '../../../utils/citationParser';
import { cn } from '../../../lib/utils';

interface FootnoteTooltipProps {
  footnote: Footnote;
  defaultActType?: string;
  onNavigate?: (articleNumber: string, tipoAtto: string) => void;
  className?: string;
}

interface TooltipPosition {
  top: number;
  left: number;
}

/**
 * FootnoteTooltip - Tooltip inline attivabile per note a piè di pagina.
 *
 * Mostra il contenuto della nota al click, con link cliccabili verso
 * gli articoli citati nel testo della nota.
 */
export function FootnoteTooltip({
  footnote,
  defaultActType = 'codice civile',
  onNavigate,
  className,
}: FootnoteTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Estrai riferimenti ad articoli dal testo della nota
  const articleRefs = extractArticleRefs(footnote.testo, defaultActType);

  // Calcola posizione tooltip quando si apre
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const tooltipWidth = 320; // max-w-xs = 320px
    const tooltipHeight = 200; // estimated max height
    const padding = 8;

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let top = rect.bottom + padding;

    // Evita overflow a destra
    if (left + tooltipWidth > window.innerWidth - padding) {
      left = window.innerWidth - tooltipWidth - padding;
    }

    // Evita overflow a sinistra
    if (left < padding) {
      left = padding;
    }

    // Se non c'è spazio sotto, mostra sopra
    if (top + tooltipHeight > window.innerHeight - padding) {
      top = rect.top - tooltipHeight - padding;
    }

    setPosition({ top, left });
  }, []);

  // Aggiorna posizione e gestisci scroll/resize
  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    const handleScroll = () => updatePosition();
    const handleResize = () => updatePosition();

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, updatePosition]);

  // Chiudi al click esterno
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    // Chiudi con Escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleArticleClick = (ref: ArticleRef) => {
    onNavigate?.(ref.numero, ref.tipoAtto);
    setIsOpen(false);
  };

  return (
    <>
      {/* Trigger: numero superscript cliccabile */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "inline-flex items-center justify-center min-w-[1.1em] h-[1.1em] px-0.5",
          "text-[0.7em] font-bold align-super leading-none",
          "text-blue-600 dark:text-blue-400",
          "bg-blue-50 dark:bg-blue-900/30 rounded-full",
          "hover:bg-blue-100 dark:hover:bg-blue-900/50",
          "cursor-pointer transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1",
          isOpen && "bg-blue-200 dark:bg-blue-800",
          className
        )}
        aria-label={`Nota ${footnote.numero}`}
        aria-expanded={isOpen}
        title={`Nota ${footnote.numero}: clicca per visualizzare`}
      >
        {footnote.numero}
      </button>

      {/* Tooltip popover - renderizzato in portal */}
      {isOpen &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            className="fixed z-50 max-w-xs w-full animate-in fade-in-0 zoom-in-95 duration-150"
            style={{
              top: position.top,
              left: position.left,
            }}
          >
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Nota {footnote.numero}
                </span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  aria-label="Chiudi nota"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Content */}
              <div className="p-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-h-48 overflow-y-auto">
                <p>{footnote.testo}</p>
              </div>

              {/* Link ad articoli citati */}
              {articleRefs.length > 0 && (
                <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/30">
                  <span className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 block">
                    Articoli citati:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {articleRefs.map((ref, i) => (
                      <button
                        key={`footnote-ref-${footnote.numero}-${ref.numero || 'unknown'}-${ref.tipoAtto || 'atto'}-${i}`}
                        onClick={() => handleArticleClick(ref)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium
                          bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300
                          rounded hover:bg-blue-100 dark:hover:bg-blue-900/50
                          transition-colors cursor-pointer"
                        title={`Vai a Art. ${ref.numero} - ${ref.tipoAtto}`}
                      >
                        Art. {ref.numero}
                        <ArrowUpRight size={10} className="opacity-60" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * FootnoteMarker - Versione leggera solo marker, senza tooltip.
 * Utile per rendering nel testo dove il tooltip è gestito esternamente.
 */
export function FootnoteMarker({
  numero,
  onClick,
  isActive,
}: {
  numero: number;
  onClick?: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center min-w-[1.1em] h-[1.1em] px-0.5",
        "text-[0.7em] font-bold align-super leading-none",
        "text-blue-600 dark:text-blue-400",
        "bg-blue-50 dark:bg-blue-900/30 rounded-full",
        "hover:bg-blue-100 dark:hover:bg-blue-900/50",
        "cursor-pointer transition-colors",
        isActive && "bg-blue-200 dark:bg-blue-800"
      )}
      aria-label={`Nota ${numero}`}
    >
      {numero}
    </button>
  );
}
