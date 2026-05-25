import { X, Crosshair } from 'lucide-react';
import type { GraphNode, GraphEdge } from '../shared/types';

export interface NodeDetailsDrawerProps {
  node: GraphNode | null;
  edges: GraphEdge[];
  nodesById: Map<string, GraphNode>;
  onRecenter: (node: GraphNode) => void;
  onClose: () => void;
}

// Property keys worth surfacing, in display order. Anything else is ignored to
// keep the drawer readable (the full blob lives in the graph, not the UI).
const SHOWN_PROPS: Array<{ key: string; label: string; truncate?: number }> = [
  { key: 'rubrica', label: 'Rubrica' },
  { key: 'fonte', label: 'Fonte' },
  { key: 'testo_vigente', label: 'Testo', truncate: 240 },
  { key: 'descrizione', label: 'Descrizione', truncate: 240 },
  { key: 'massima_text', label: 'Massima', truncate: 240 },
];

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * Right-hand drawer with the selected node's metadata and its in/out relations.
 * "Centra qui" re-centers the explorer on this node (click-to-recenter is the
 * double-click path; this is the explicit button equivalent).
 */
export function NodeDetailsDrawer({
  node,
  edges,
  nodesById,
  onRecenter,
  onClose,
}: NodeDetailsDrawerProps): React.ReactElement | null {
  if (!node) return null;

  const outgoing = edges.filter((e) => e.source === node.id);
  const incoming = edges.filter((e) => e.target === node.id);
  const props = node.properties ?? {};

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{node.label}</h2>
          <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {node.type}
          </span>
        </div>
        <button
          type="button"
          aria-label="Chiudi"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-auto p-3 text-sm">
        {node.urn && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">URN</p>
            <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">{node.urn}</p>
          </div>
        )}

        {SHOWN_PROPS.map(({ key, label, truncate }) => {
          const text = asText(props[key]);
          if (!text) return null;
          const shown = truncate && text.length > truncate ? `${text.slice(0, truncate)}…` : text;
          return (
            <div key={key}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
              <p className="text-slate-700 dark:text-slate-200">{shown}</p>
            </div>
          );
        })}

        <RelationGroup title="Relazioni in uscita" edges={outgoing} dir="out" nodesById={nodesById} />
        <RelationGroup title="Relazioni in entrata" edges={incoming} dir="in" nodesById={nodesById} />
      </div>

      <footer className="border-t border-slate-200 p-3 dark:border-slate-700">
        <button
          type="button"
          onClick={() => onRecenter(node)}
          className="flex w-full items-center justify-center gap-2 rounded bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Crosshair className="h-4 w-4" />
          Centra qui
        </button>
      </footer>
    </div>
  );
}

function RelationGroup({
  title,
  edges,
  dir,
  nodesById,
}: {
  title: string;
  edges: GraphEdge[];
  dir: 'in' | 'out';
  nodesById: Map<string, GraphNode>;
}): React.ReactElement | null {
  if (edges.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">{title}</p>
      <ul className="space-y-1">
        {edges.map((e) => {
          const otherId = dir === 'out' ? e.target : e.source;
          const other = nodesById.get(otherId);
          return (
            <li key={e.id ?? `${e.source}-${e.type}-${e.target}`} className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-700 dark:text-slate-200">{other?.label ?? otherId}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{e.type}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
