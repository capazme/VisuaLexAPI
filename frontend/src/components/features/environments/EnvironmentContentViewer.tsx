import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen,
  Zap,
  Tag,
  MessageSquare,
  Highlighter,
  ChevronDown,
  ChevronRight,
  Square,
  CheckSquare,
  FileText
} from 'lucide-react';
import type { Environment } from '../../../types';
import type { EnvironmentSelection, DetailedEnvironmentStats } from '../../../utils/environmentUtils';
import { getDetailedEnvironmentStats } from '../../../utils/environmentUtils';

type TabType = 'dossiers' | 'quickNorms' | 'aliases' | 'annotations' | 'highlights';

interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ReactNode;
  countKey: keyof DetailedEnvironmentStats;
}

const TABS: TabConfig[] = [
  { id: 'dossiers', label: 'Dossiers', icon: <FolderOpen size={14} />, countKey: 'dossiers' },
  { id: 'quickNorms', label: 'QuickNorms', icon: <Zap size={14} />, countKey: 'quickNorms' },
  { id: 'aliases', label: 'Alias', icon: <Tag size={14} />, countKey: 'customAliases' },
  { id: 'annotations', label: 'Note', icon: <MessageSquare size={14} />, countKey: 'annotations' },
  { id: 'highlights', label: 'Evidenziazioni', icon: <Highlighter size={14} />, countKey: 'highlights' },
];

export interface EnvironmentContentViewerProps {
  environment: Partial<Environment>;
  selectable?: boolean;
  selection?: EnvironmentSelection;
  onSelectionChange?: (selection: EnvironmentSelection) => void;
  compact?: boolean;
  maxHeight?: string;
}

export function EnvironmentContentViewer({
  environment,
  selectable = false,
  selection,
  onSelectionChange,
  compact = false,
  maxHeight = '300px',
}: EnvironmentContentViewerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('dossiers');
  const [expandedDossiers, setExpandedDossiers] = useState<Set<string>>(new Set());

  const stats = useMemo(() => getDetailedEnvironmentStats(environment), [environment]);

  const toggleDossierExpand = (id: string) => {
    setExpandedDossiers(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Selection helpers
  const isSelected = useCallback((type: TabType, id: string): boolean => {
    if (!selection) return false;
    switch (type) {
      case 'dossiers': return selection.dossierIds.includes(id);
      case 'quickNorms': return selection.quickNormIds.includes(id);
      case 'aliases': return selection.aliasIds.includes(id);
      case 'annotations': return selection.annotationIds.includes(id);
      case 'highlights': return selection.highlightIds.includes(id);
      default: return false;
    }
  }, [selection]);

  const toggleSelection = useCallback((type: TabType, id: string) => {
    if (!selection || !onSelectionChange) return;

    const newSelection = { ...selection };
    let arr: string[];

    switch (type) {
      case 'dossiers':
        arr = [...newSelection.dossierIds];
        break;
      case 'quickNorms':
        arr = [...newSelection.quickNormIds];
        break;
      case 'aliases':
        arr = [...newSelection.aliasIds];
        break;
      case 'annotations':
        arr = [...newSelection.annotationIds];
        break;
      case 'highlights':
        arr = [...newSelection.highlightIds];
        break;
      default:
        return;
    }

    const idx = arr.indexOf(id);
    if (idx === -1) {
      arr.push(id);
    } else {
      arr.splice(idx, 1);
    }

    switch (type) {
      case 'dossiers':
        newSelection.dossierIds = arr;
        break;
      case 'quickNorms':
        newSelection.quickNormIds = arr;
        break;
      case 'aliases':
        newSelection.aliasIds = arr;
        break;
      case 'annotations':
        newSelection.annotationIds = arr;
        break;
      case 'highlights':
        newSelection.highlightIds = arr;
        break;
    }

    onSelectionChange(newSelection);
  }, [selection, onSelectionChange]);

  const getTabCount = (tab: TabConfig): number => {
    const data = stats[tab.countKey];
    return 'count' in data ? data.count : 0;
  };

  // Auto-select first non-empty tab if current tab is empty
  useMemo(() => {
    const currentCount = getTabCount(TABS.find(t => t.id === activeTab)!);
    if (currentCount === 0) {
      const nonEmpty = TABS.find(tab => getTabCount(tab) > 0);
      if (nonEmpty) {
        setActiveTab(nonEmpty.id);
      }
    }
  }, [stats]);

  const renderCheckbox = (type: TabType, id: string) => {
    if (!selectable) return null;
    const checked = isSelected(type, id);
    return (
      <button
        onClick={(e) => { e.stopPropagation(); toggleSelection(type, id); }}
        className="mr-2 flex-shrink-0 hover:text-indigo-600 dark:hover:text-indigo-400"
      >
        {checked ? (
          <CheckSquare size={16} className="text-indigo-600 dark:text-indigo-400" />
        ) : (
          <Square size={16} className="text-slate-400" />
        )}
      </button>
    );
  };

  const renderDossiers = () => {
    if (stats.dossiers.count === 0) {
      return <EmptyState message="Nessun dossier" />;
    }

    return (
      <div className="space-y-1">
        {stats.dossiers.items.map(dossier => (
          <div key={dossier.id}>
            <div
              className="flex items-center py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
              onClick={() => toggleDossierExpand(dossier.id)}
            >
              {renderCheckbox('dossiers', dossier.id)}
              <button className="mr-1.5 text-slate-500">
                {expandedDossiers.has(dossier.id) ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
              <FolderOpen size={14} className="mr-2 text-indigo-500" />
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">
                {dossier.name}
              </span>
              <span className="text-xs text-slate-500 ml-2">
                {dossier.articleCount} {dossier.articleCount === 1 ? 'articolo' : 'articoli'}
              </span>
            </div>

            <AnimatePresence>
              {expandedDossiers.has(dossier.id) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="ml-8 pl-3 border-l-2 border-slate-200 dark:border-slate-700 py-1">
                    {dossier.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 italic">
                        {dossier.description}
                      </p>
                    )}
                    {/* Would need to access actual dossier items from environment */}
                    <p className="text-xs text-slate-400">
                      Contiene {dossier.articleCount} norme
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    );
  };

  const renderQuickNorms = () => {
    if (stats.quickNorms.count === 0) {
      return <EmptyState message="Nessuna QuickNorm" />;
    }

    return (
      <div className="space-y-1">
        {stats.quickNorms.items.map(qn => (
          <div
            key={qn.id}
            className="flex items-center py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {renderCheckbox('quickNorms', qn.id)}
            <Zap size={14} className="mr-2 text-amber-500" />
            <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">
              {qn.label}
            </span>
            <span className="text-xs text-slate-500 ml-2 truncate max-w-[120px]">
              {qn.actType}
              {qn.article && ` art. ${qn.article}`}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const renderAliases = () => {
    if (stats.customAliases.count === 0) {
      return <EmptyState message="Nessun alias" />;
    }

    return (
      <div className="space-y-1">
        {stats.customAliases.shortcuts > 0 && (
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 px-2 pt-1">
            Scorciatoie ({stats.customAliases.shortcuts})
          </div>
        )}
        {stats.customAliases.items
          .filter(a => a.type === 'shortcut')
          .map(alias => (
            <div
              key={alias.id}
              className="flex items-center py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {renderCheckbox('aliases', alias.id)}
              <code className="text-xs font-mono bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded mr-2">
                {alias.trigger}
              </code>
              <span className="text-slate-400 mx-1">&rarr;</span>
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">
                {alias.expandTo}
              </span>
            </div>
          ))}

        {stats.customAliases.references > 0 && (
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 px-2 pt-2">
            Riferimenti ({stats.customAliases.references})
          </div>
        )}
        {stats.customAliases.items
          .filter(a => a.type === 'reference')
          .map(alias => (
            <div
              key={alias.id}
              className="flex items-center py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {renderCheckbox('aliases', alias.id)}
              <code className="text-xs font-mono bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded mr-2">
                {alias.trigger}
              </code>
              <span className="text-slate-400 mx-1">&rarr;</span>
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">
                {alias.expandTo}
              </span>
            </div>
          ))}
      </div>
    );
  };

  const renderAnnotations = () => {
    if (stats.annotations.count === 0) {
      return <EmptyState message="Nessuna annotazione" />;
    }

    const byNorm = Object.entries(stats.annotations.byNorm);

    return (
      <div className="space-y-2">
        {byNorm.map(([normaKey, count]) => (
          <div key={normaKey} className="px-2">
            <div className="flex items-center text-sm">
              <FileText size={14} className="mr-2 text-emerald-500" />
              <span className="flex-1 text-slate-700 dark:text-slate-300 truncate font-medium">
                {normaKey.replace(/--/g, ' ').replace(/-/g, ' ')}
              </span>
              <span className="text-xs text-slate-500 ml-2">
                {count} {count === 1 ? 'nota' : 'note'}
              </span>
            </div>
          </div>
        ))}

        <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
          {stats.annotations.items.map(ann => (
            <div
              key={ann.id}
              className="flex items-start py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {renderCheckbox('annotations', ann.id)}
              <MessageSquare size={14} className="mr-2 mt-0.5 text-emerald-500 flex-shrink-0" />
              <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                {ann.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderHighlights = () => {
    if (stats.highlights.count === 0) {
      return <EmptyState message="Nessuna evidenziazione" />;
    }

    const byNorm = Object.entries(stats.highlights.byNorm);

    return (
      <div className="space-y-2">
        {byNorm.map(([normaKey, count]) => (
          <div key={normaKey} className="px-2">
            <div className="flex items-center text-sm">
              <FileText size={14} className="mr-2 text-yellow-500" />
              <span className="flex-1 text-slate-700 dark:text-slate-300 truncate font-medium">
                {normaKey.replace(/--/g, ' ').replace(/-/g, ' ')}
              </span>
              <span className="text-xs text-slate-500 ml-2">
                {count} {count === 1 ? 'evidenziazione' : 'evidenziazioni'}
              </span>
            </div>
          </div>
        ))}

        <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
          {stats.highlights.items.map(hl => (
            <div
              key={hl.id}
              className="flex items-start py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {renderCheckbox('highlights', hl.id)}
              <div
                className="w-3 h-3 rounded mr-2 mt-0.5 flex-shrink-0"
                style={{
                  backgroundColor:
                    hl.color === 'yellow' ? '#FEF08A' :
                    hl.color === 'green' ? '#BBF7D0' :
                    hl.color === 'red' ? '#FECACA' :
                    '#BFDBFE'
                }}
              />
              <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                {hl.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dossiers': return renderDossiers();
      case 'quickNorms': return renderQuickNorms();
      case 'aliases': return renderAliases();
      case 'annotations': return renderAnnotations();
      case 'highlights': return renderHighlights();
      default: return null;
    }
  };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-x-auto">
        {TABS.map(tab => {
          const count = getTabCount(tab);
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap
                transition-colors border-b-2 -mb-px
                ${isActive
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-slate-900'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }
                ${count === 0 ? 'opacity-50' : ''}
              `}
            >
              {tab.icon}
              <span className={compact ? 'hidden sm:inline' : ''}>
                {tab.label}
              </span>
              {count > 0 && (
                <span className={`
                  px-1.5 py-0.5 rounded-full text-[10px] font-bold
                  ${isActive
                    ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }
                `}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div
        className="overflow-y-auto"
        style={{ maxHeight }}
      >
        <div className="p-2">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-slate-400 dark:text-slate-500">
      <span className="text-sm">{message}</span>
    </div>
  );
}
