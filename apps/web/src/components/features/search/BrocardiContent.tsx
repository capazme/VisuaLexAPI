import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, ExternalLink, ChevronDown, FileText, MessageCircle, Gavel } from 'lucide-react';
import type { BrocardiInfo as BrocardiInfoType, MassimaStructured } from '../../../types';
import { cn } from '../../../lib/utils';
import { SafeHTML } from '../../../utils/sanitize';

interface BrocardiSectionProps {
  title: string;
  content: string | string[] | (string | MassimaStructured)[] | null;
  icon: React.ReactNode;
  variant: 'purple' | 'amber' | 'emerald' | 'primary';
}

const VARIANT_STYLES = {
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-100 dark:border-purple-800/30',
    text: 'text-purple-700 dark:text-purple-400',
    iconBg: 'bg-purple-100 dark:bg-purple-900/40',
    iconColor: 'text-purple-600 dark:text-purple-300'
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-100 dark:border-amber-800/30',
    text: 'text-amber-700 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-900/40',
    iconColor: 'text-amber-600 dark:text-amber-300'
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-100 dark:border-emerald-800/30',
    text: 'text-emerald-700 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    iconColor: 'text-emerald-600 dark:text-emerald-300'
  },
  primary: {
    bg: 'bg-primary-50 dark:bg-primary-900/20',
    border: 'border-primary-100 dark:border-primary-800/30',
    text: 'text-primary-700 dark:text-primary-400',
    iconBg: 'bg-primary-100 dark:bg-primary-900/40',
    iconColor: 'text-primary-600 dark:text-primary-300'
  }
};

function BrocardiSection({ title, content, icon, variant }: BrocardiSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const styles = VARIANT_STYLES[variant];

  if (!content || (Array.isArray(content) && content.length === 0)) return null;

  // Handle Massime specially - convert to string array
  let validContent: string | string[];
  if (Array.isArray(content)) {
    validContent = content
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'massima' in item) return item.massima;
        return '';
      })
      .filter(item => item && item.replace(/<[^>]*>/g, '').trim().length > 0);

    if (validContent.length === 0) return null;
  } else {
    validContent = content;
  }

  // Pagination for Massime
  const displayContent = title === 'Massime' && Array.isArray(validContent) && !showAll
    ? validContent.slice(0, 10)
    : validContent;

  return (
    <div className="border-b border-slate-100 dark:border-slate-800 last:border-0 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
      >
        <div className="flex items-center gap-4">
          <div className={cn("p-2 rounded-xl transition-colors", styles.iconBg, styles.iconColor)}>
            {icon}
          </div>
          <div className="flex flex-col">
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">
              {title}
            </h4>
            {Array.isArray(validContent) && (
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                {validContent.length} {validContent.length === 1 ? 'elemento' : 'elementi'}
              </span>
            )}
          </div>
        </div>
        <div className={cn(
          "w-8 h-8 flex items-center justify-center rounded-lg transition-all",
          isOpen ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300" : "text-slate-400"
        )}>
          <ChevronDown
            size={18}
            className={cn(
              "transition-transform duration-300",
              isOpen ? "rotate-180" : ""
            )}
          />
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-8 pt-2">
              <div className={cn("p-5 rounded-2xl border bg-white dark:bg-slate-900/50 shadow-sm", styles.border)}>
                {title === 'Massime' && Array.isArray(displayContent) ? (
                  <div className="space-y-4">
                    {displayContent.map((item, idx) => (
                      <div
                        key={`content-massima-${idx}`}
                        className="flex gap-4 group"
                      >
                        <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-500 group-hover:bg-primary-500 group-hover:text-white transition-all">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <SafeHTML
                            html={item}
                            className="prose prose-sm max-w-none [&_p]:text-slate-700 dark:[&_p]:text-slate-300/90 [&_p]:leading-relaxed font-medium"
                          />
                        </div>
                      </div>
                    ))}
                    {Array.isArray(validContent) && validContent.length > 10 && !showAll && (
                      <button
                        onClick={() => setShowAll(true)}
                        className="mt-6 w-full py-3 px-4 bg-slate-50 dark:bg-slate-800 hover:bg-primary-50 dark:hover:bg-primary-900/20 text-slate-600 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-slate-200 dark:border-slate-700 hover:border-primary-200 dark:hover:border-primary-800"
                      >
                        Mostra altre {validContent.length - 10} massime
                      </button>
                    )}
                  </div>
                ) : Array.isArray(validContent) ? (
                  <div className="space-y-3">
                    {validContent.map((item, idx) => (
                      <div
                        key={`content-item-${idx}`}
                        className="flex gap-3 items-start"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-2 shrink-0" />
                        <p className="text-sm text-slate-700 dark:text-slate-300/90 leading-relaxed font-medium">
                          {item}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <SafeHTML
                    html={validContent as string}
                    className="prose prose-sm max-w-none [&_p]:text-slate-700 dark:[&_p]:text-slate-300/90 [&_p]:leading-relaxed font-medium"
                  />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface BrocardiContentProps {
  info: BrocardiInfoType;
  articleTitle?: string;
}

export function BrocardiContent({ info, articleTitle }: BrocardiContentProps) {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {/* Article Context Banner with Glass aesthetic */}
      {articleTitle && (
        <div className="px-6 py-6 bg-primary-50/50 dark:bg-primary-900/10 border-b border-primary-100/50 dark:border-primary-800/30">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-8 rounded-full bg-primary-500" />
            <div>
              <p className="text-[10px] uppercase font-bold tracking-widest text-primary-600/70 dark:text-primary-400/70">
                Studio & Approfondimento
              </p>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                {articleTitle}
              </h3>
            </div>
          </div>
        </div>
      )}

      {/* Sections Container */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <BrocardiSection
          title="Brocardi"
          content={info.Brocardi}
          icon={<FileText size={18} />}
          variant="purple"
        />

        <BrocardiSection
          title="Ratio Legis"
          content={info.Ratio}
          icon={<Lightbulb size={18} />}
          variant="amber"
        />

        <BrocardiSection
          title="Spiegazione"
          content={info.Spiegazione}
          icon={<MessageCircle size={18} />}
          variant="emerald"
        />

        <BrocardiSection
          title="Massime"
          content={info.Massime}
          icon={<Gavel size={18} />}
          variant="primary"
        />
      </div>

      {/* Enhanced Footer Link */}
      {info.link && (
        <div className="px-6 py-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
          <a
            href={info.link}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center justify-center gap-3 py-3 px-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary-400 dark:hover:border-primary-600 rounded-xl transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
          >
            <div className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 group-hover:scale-110 transition-transform">
              <ExternalLink size={16} />
            </div>
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-primary-600 dark:group-hover:text-primary-400">
              Vedi fonte completa su Brocardi.it
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
