import { X } from 'lucide-react';
import { sanitizeHTML } from '../../../utils/sanitize';
import type { DossierItem } from '../../../types';

interface Props {
  item: DossierItem;
  onClose: () => void;
}

// Renders the article text or free note content. The `dangerouslySetInnerHTML`
// here is fed exclusively by `sanitizeHTML`, the project-wide DOMPurify wrapper
// used everywhere we surface scraped legal HTML (see ArticleTabContent).
export function ArticleViewerModal({ item, onClose }: Props) {
  const isNorma = item.type === 'norma';
  const title = isNorma
    ? `${item.data.tipo_atto} ${item.data.numero_atto || ''} - Art. ${item.data.numero_articolo}`
    : 'Nota';
  const content = isNorma ? item.data.article_text : item.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {content ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHTML(content.replace(/\n/g, '<br />')) }}
            />
          ) : (
            <p className="text-slate-500 italic text-center py-8">Contenuto non disponibile</p>
          )}
        </div>
      </div>
    </div>
  );
}
