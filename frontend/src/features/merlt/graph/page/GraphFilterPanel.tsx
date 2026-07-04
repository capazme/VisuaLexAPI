import { useState } from 'react';
import { Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { NODE_TYPE_STYLE, EDGE_TYPE_STYLE } from '../shared/graphStyles';
import type { TypeCount } from '../shared/graphFilters';

export interface GraphFilterPanelProps {
  nodeTypes: TypeCount[];
  edgeTypes: TypeCount[];
  hiddenNodeTypes: ReadonlySet<string>;
  hiddenEdgeTypes: ReadonlySet<string>;
  onToggleNodeType: (type: string) => void;
  onToggleEdgeType: (type: string) => void;
  onSetAllNodes: (hidden: boolean) => void;
  onSetAllEdges: (hidden: boolean) => void;
  /** Legend hover → emphasize that node type in the graph (null = clear). */
  onHoverType: (type: string | null) => void;
}

/**
 * Filter panel + legend for the explorer. Lists the node and relation
 * types present in the current graph with a colour swatch, count and a
 * visibility toggle. Toggling hides elements without re-laying-out the graph;
 * hovering a node type highlights it in the canvas.
 * Positioning is owned by the caller: GraphExplorerPage stacks this panel and
 * the "nascondi giurisprudenza" pill in one absolute flex-col overlay so the
 * two never collide.
 */
export function GraphFilterPanel({
  nodeTypes,
  edgeTypes,
  hiddenNodeTypes,
  hiddenEdgeTypes,
  onToggleNodeType,
  onToggleEdgeType,
  onSetAllNodes,
  onSetAllEdges,
  onHoverType,
}: GraphFilterPanelProps): React.ReactElement {
  const [open, setOpen] = useState(true);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <span className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary-600" />
          Filtri
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto border-t border-slate-100 px-3 py-2 dark:border-slate-800">
          <Section
            title="Nodi"
            items={nodeTypes}
            hidden={hiddenNodeTypes}
            colorOf={(t) => NODE_TYPE_STYLE[t]?.color ?? '#94a3b8'}
            onToggle={onToggleNodeType}
            onHover={onHoverType}
            onSetAll={onSetAllNodes}
            allLabel="Tutti"
            noneLabel="Nessuno"
          />
          <Section
            title="Relazioni"
            items={edgeTypes}
            hidden={hiddenEdgeTypes}
            colorOf={(t) => EDGE_TYPE_STYLE[t]?.color ?? '#cbd5e1'}
            onToggle={onToggleEdgeType}
            onSetAll={onSetAllEdges}
            allLabel="Tutte"
            noneLabel="Nessuna"
          />
        </div>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  items: TypeCount[];
  hidden: ReadonlySet<string>;
  colorOf: (type: string) => string;
  onToggle: (type: string) => void;
  onSetAll: (hidden: boolean) => void;
  onHover?: (type: string | null) => void;
  allLabel: string;
  noneLabel: string;
}

function Section({
  title,
  items,
  hidden,
  colorOf,
  onToggle,
  onSetAll,
  onHover,
  allLabel,
  noneLabel,
}: SectionProps): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{title}</span>
        <span className="flex gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => onSetAll(false)}
            className="rounded px-1.5 py-0.5 text-primary-600 hover:bg-primary-50 dark:hover:bg-slate-800"
          >
            {allLabel}
          </button>
          <button
            type="button"
            onClick={() => onSetAll(true)}
            className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {noneLabel}
          </button>
        </span>
      </div>
      <ul className="space-y-0.5">
        {items.map(({ type, count }) => {
          const isHidden = hidden.has(type);
          return (
            <li key={type}>
              <div
                role="checkbox"
                aria-checked={!isHidden}
                aria-label={type}
                tabIndex={0}
                onClick={() => onToggle(type)}
                onMouseEnter={() => onHover?.(type)}
                onMouseLeave={() => onHover?.(null)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(type);
                  }
                }}
                className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                  isHidden ? 'opacity-45 hover:opacity-70' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm border border-black/10"
                  style={{ backgroundColor: colorOf(type) }}
                />
                <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{type}</span>
                <span className="shrink-0 tabular-nums text-slate-400">{count}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
