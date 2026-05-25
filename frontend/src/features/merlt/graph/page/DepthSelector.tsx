import type { GraphLayoutName } from '../shared/CytoscapeView';
import { LAYOUT_OPTIONS } from './graphLayouts';

export interface DepthSelectorProps {
  depth: number;
  layout: GraphLayoutName;
  onDepthChange: (depth: number) => void;
  onLayoutChange: (layout: GraphLayoutName) => void;
}

const DEPTHS = [1, 2, 3] as const;

/**
 * Depth (1/2/3) + layout controls for the explorer. Both are controlled by the
 * page (which mirrors them into the URL). Changing depth refetches the subgraph;
 * changing layout only re-runs the layout client-side (no refetch).
 */
export function DepthSelector({
  depth,
  layout,
  onDepthChange,
  onLayoutChange,
}: DepthSelectorProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-500 dark:text-slate-400">Profondità</span>
        <div className="flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
          {DEPTHS.map((d) => {
            const active = d === depth;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={active}
                onClick={() => onDepthChange(d)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        <span>Layout</span>
        <select
          aria-label="Layout"
          value={layout}
          onChange={(e) => onLayoutChange(e.target.value as GraphLayoutName)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          {LAYOUT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
