import React, { useState } from 'react';
import { Lightbulb, ExternalLink, ChevronDown } from 'lucide-react';
import type { BrocardiInfo as BrocardiInfoType } from '../../../types';
import { cn } from '../../../lib/utils';
import { SafeHTML } from '../../../utils/sanitize';

interface BrocardiSectionProps {
  title: string;
  content: string | string[] | null;
}

function BrocardiSection({ title, content }: BrocardiSectionProps) {
  const [isOpen, setIsOpen] = React.useState(true);

  if (!content || (Array.isArray(content) && content.length === 0)) return null;

  // Filter empty items for arrays (especially Massime)
  const validContent = Array.isArray(content)
    ? content.filter(item => item && item.replace(/<[^>]*>/g, '').trim().length > 0)
    : content;

  if (Array.isArray(validContent) && validContent.length === 0) return null;

  return (
    <div className="card border border-gray-200 dark:border-gray-700 shadow-sm rounded-md mb-3 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
          <Lightbulb size={14} className="text-blue-600" />
          {title}
        </strong>
        <span className={cn("transition-transform text-gray-400", isOpen ? "rotate-180" : "")}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300">
          {title === 'Massime' && Array.isArray(validContent) ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {validContent.map((item, idx) => (
                <div key={idx} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <div className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-500">{idx + 1}</span>
                    <SafeHTML
                      html={item}
                      className="prose prose-sm dark:prose-invert max-w-none [&_*]:text-gray-700 dark:[&_*]:text-gray-300"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : Array.isArray(validContent) ? (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {validContent.map((item, idx) => (
                <li key={idx} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">{item}</li>
              ))}
            </ul>
          ) : (
            <SafeHTML
              html={validContent as string}
              className="p-3 prose prose-sm dark:prose-invert max-w-none"
            />
          )}
        </div>
      )}
    </div>
  );
}

export function BrocardiDisplay({ info }: { info: BrocardiInfoType }) {
  // Default collapsed on mobile (<768px), expanded on desktop
  const [isMainOpen, setIsMainOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

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
          <BrocardiSection title="Brocardi" content={info.Brocardi} />
          <BrocardiSection title="Ratio" content={info.Ratio} />
          <BrocardiSection title="Spiegazione" content={info.Spiegazione} />
          <BrocardiSection title="Massime" content={info.Massime} />
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
