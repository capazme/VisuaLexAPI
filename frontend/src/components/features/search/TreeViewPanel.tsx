import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface TreeViewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  treeData: any[];
  urn: string;
  title?: string;
}

export function TreeViewPanel({ isOpen, onClose, treeData, title = 'Struttura Atto' }: TreeViewPanelProps) {
  // Recursive function to render tree nodes with enhanced styling
  const renderTreeNodes = (nodes: any, depth = 0): JSX.Element | null => {
    if (!nodes) return null;

    const list = Array.isArray(nodes) ? nodes : Object.values(nodes);

    return (
      <ul className={cn(
        'space-y-1 text-gray-600 dark:text-gray-300',
        depth > 0 && 'ml-4 text-xs border-l border-gray-200 dark:border-gray-700 pl-3'
      )}>
        {list.map((node: any, idx: number) => {
          const label = node?.title || node?.label || node?.name || node?.numero || (typeof node === 'string' ? node : `Nodo ${idx + 1}`);
          const children = node?.children || node?.items || node?.articoli;

          return (
            <li key={node?.id || idx}>
              <div className="flex items-start gap-2 group">
                <span className={cn(
                  "mt-1.5 rounded-full flex-shrink-0",
                  depth === 0 ? "w-2 h-2 bg-blue-500" : "w-1.5 h-1.5 bg-gray-400 dark:bg-gray-600"
                )} />
                <span className={cn(
                  "leading-relaxed",
                  depth === 0 && "font-medium text-gray-900 dark:text-white"
                )}>
                  {label}
                </span>
              </div>
              {children && renderTreeNodes(children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
          />

          {/* Side Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-96 bg-white dark:bg-gray-900 shadow-2xl z-50 overflow-y-auto border-l border-gray-200 dark:border-gray-800"
          >
            {/* Sticky Header */}
            <div className="sticky top-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex justify-between items-center z-10">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">{title}</h3>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {treeData && treeData.length > 0 ? (
                renderTreeNodes(treeData)
              ) : (
                <div className="text-center py-10">
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    Struttura non disponibile
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
