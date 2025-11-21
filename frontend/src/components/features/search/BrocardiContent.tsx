import React, { useState } from 'react';
import { Lightbulb, ExternalLink, ChevronDown, FileText, Scale, MessageCircle, Gavel } from 'lucide-react';
import type { BrocardiInfo as BrocardiInfoType } from '../../../types';
import { cn } from '../../../lib/utils';
import { SafeHTML } from '../../../utils/sanitize';

interface BrocardiSectionProps {
  title: string;
  content: string | string[] | null;
  icon: React.ReactNode;
  color: string;
}

function BrocardiSection({ title, content, icon, color }: BrocardiSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (!content || (Array.isArray(content) && content.length === 0)) return null;

  // Filter empty items for arrays (especially Massime)
  const validContent = Array.isArray(content)
    ? content.filter(item => item && item.replace(/<[^>]*>/g, '').trim().length > 0)
    : content;

  if (Array.isArray(validContent) && validContent.length === 0) return null;

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left group"
      >
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", color)}>
            {icon}
          </div>
          <strong className="text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </strong>
          {Array.isArray(validContent) && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({validContent.length})
            </span>
          )}
        </div>
        <ChevronDown
          size={18}
          className={cn(
            "text-gray-400 transition-transform duration-200",
            isOpen ? "rotate-180" : ""
          )}
        />
      </button>

      {isOpen && (
        <div className="px-6 pb-4">
          {title === 'Massime' && Array.isArray(validContent) ? (
            <div className="space-y-3">
              {validContent.map((item, idx) => (
                <div
                  key={idx}
                  className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <span className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30 text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {idx + 1}
                  </span>
                  <SafeHTML
                    html={item}
                    className="prose prose-sm dark:prose-invert max-w-none flex-1 [&_*]:text-gray-700 dark:[&_*]:text-gray-300"
                  />
                </div>
              ))}
            </div>
          ) : Array.isArray(validContent) ? (
            <ul className="space-y-2">
              {validContent.map((item, idx) => (
                <li
                  key={idx}
                  className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm text-gray-700 dark:text-gray-300"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <SafeHTML
              html={validContent as string}
              className="prose prose-sm dark:prose-invert max-w-none [&_*]:text-gray-700 dark:[&_*]:text-gray-300"
            />
          )}
        </div>
      )}
    </div>
  );
}

interface BrocardiContentProps {
  info: BrocardiInfoType;
  articleTitle?: string;
}

export function BrocardiContent({ info, articleTitle }: BrocardiContentProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Article Context Banner */}
      {articleTitle && (
        <div className="px-6 py-4 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-900/30">
          <p className="text-xs uppercase tracking-wide text-blue-600 dark:text-blue-400 font-semibold mb-1">
            Annotazioni per
          </p>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            {articleTitle}
          </h3>
        </div>
      )}

      {/* Sections */}
      <div className="flex-1 overflow-y-auto">
        <BrocardiSection
          title="Brocardi"
          content={info.Brocardi}
          icon={<FileText size={16} className="text-purple-600 dark:text-purple-400" />}
          color="bg-purple-100 dark:bg-purple-900/30"
        />

        <BrocardiSection
          title="Ratio Legis"
          content={info.Ratio}
          icon={<Lightbulb size={16} className="text-yellow-600 dark:text-yellow-400" />}
          color="bg-yellow-100 dark:bg-yellow-900/30"
        />

        <BrocardiSection
          title="Spiegazione"
          content={info.Spiegazione}
          icon={<MessageCircle size={16} className="text-green-600 dark:text-green-400" />}
          color="bg-green-100 dark:bg-green-900/30"
        />

        <BrocardiSection
          title="Massime"
          content={info.Massime}
          icon={<Gavel size={16} className="text-blue-600 dark:text-blue-400" />}
          color="bg-blue-100 dark:bg-blue-900/30"
        />
      </div>

      {/* Footer Link */}
      {info.link && (
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <a
            href={info.link}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
          >
            <ExternalLink size={16} />
            Vedi fonte completa su Brocardi.it
          </a>
        </div>
      )}
    </div>
  );
}
