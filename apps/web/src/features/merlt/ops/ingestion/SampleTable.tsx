function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 60 ? `${json.slice(0, 60)}…` : json;
  }
  return String(value);
}

export interface SampleTableProps {
  title: string;
  items: Record<string, unknown>[];
  total: number;
  onLoadMore?: () => void;
}

/**
 * Generic preview table for `nodes_sample` / `edges_sample` — shapes are
 * opaque `Record<string, unknown>[]` (MERL-T-defined, not FE-owned), so
 * columns are derived from the union of keys on the first row rather than a
 * fixed schema. "Carica altri" bumps the parent's node_limit/edge_limit.
 */
export function SampleTable({ title, items, total, onLoadMore }: SampleTableProps) {
  const columns = items.length > 0 ? Object.keys(items[0]).slice(0, 6) : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title} ({items.length} di {total})
        </h4>
        {onLoadMore && items.length < total && (
          <button
            type="button"
            onClick={onLoadMore}
            className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
          >
            Carica altri
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">Nessun elemento nel campione.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-1.5 text-left font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((item, idx) => (
                <tr key={idx}>
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-300">
                      {formatCellValue(item[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
