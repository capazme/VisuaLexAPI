import { ArrowRight, Crosshair, X } from 'lucide-react';
import { EDGE_TYPE_STYLE, humanizeEdgeType } from '../shared/graphStyles';
import type { GraphEdge, GraphNode } from '../shared/types';

export interface EdgeDetailsDrawerProps {
  edge: GraphEdge | null;
  nodesById: Map<string, GraphNode>;
  onRecenter: (node: GraphNode) => void;
  onClose: () => void;
}

// Prominent edge properties shown first, in this order, with friendly labels.
const PRIMARY_PROPS: Array<{ key: string; label: string; long?: boolean }> = [
  { key: 'certezza', label: 'Certezza' },
  { key: 'fonte', label: 'Fonte' },
  { key: 'evidence', label: 'Estremi probatori', long: true },
  { key: 'descrizione', label: 'Descrizione', long: true },
  { key: 'community_validated', label: 'Validato dalla community' },
  { key: 'approval_score', label: 'Approvazioni (peso)' },
  { key: 'votes_count', label: 'Voti totali' },
];
const PRIMARY_KEYS = new Set(PRIMARY_PROPS.map((p) => p.key));

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'sì' : 'no';
  return null;
}

function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Right-hand details panel for a selected RELATION (edge). Mirrors
 * NodeDetailsDrawer: type chip + source→target endpoints (clickable to
 * re-center) + full property breakdown. Rendered inside a floating container
 * by the page; closes when the parent drops `edge`.
 */
export function EdgeDetailsDrawer({
  edge,
  nodesById,
  onRecenter,
  onClose,
}: EdgeDetailsDrawerProps): React.ReactElement | null {
  if (!edge) return null;

  const props = edge.properties ?? {};
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  const typeColor = EDGE_TYPE_STYLE[edge.type]?.color ?? '#94a3b8';

  const extraProps = Object.entries(props)
    .filter(([k]) => !PRIMARY_KEYS.has(k))
    .map(([k, v]) => [k, asText(v)] as const)
    .filter((entry): entry is [string, string] => entry[1] !== null);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
            Relazione
          </h2>
          <span
            className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300"
            style={{ backgroundColor: `${typeColor}22` }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: typeColor }} />
            {humanizeEdgeType(edge.type)}
          </span>
        </div>
        <button
          type="button"
          aria-label="Chiudi"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        {/* Endpoints — clickable to re-center on either side. */}
        <Field label="Endpoints">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60">
            <EndpointButton node={sourceNode} fallback={edge.source} onRecenter={onRecenter} />
            <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />
            <EndpointButton node={targetNode} fallback={edge.target} onRecenter={onRecenter} />
          </div>
        </Field>

        {PRIMARY_PROPS.map(({ key, label, long }) => {
          const text = asText(props[key]);
          if (!text) return null;
          return (
            <Field key={key} label={label}>
              <p
                className={
                  long
                    ? 'whitespace-pre-wrap text-slate-700 dark:text-slate-200'
                    : 'text-slate-700 dark:text-slate-200'
                }
              >
                {text}
              </p>
            </Field>
          );
        })}

        {extraProps.length > 0 && (
          <Field label="Altre proprietà">
            <dl className="space-y-1">
              {extraProps.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="shrink-0 text-xs text-slate-400">{humanize(k)}</dt>
                  <dd className="break-words text-xs text-slate-600 dark:text-slate-300">{v}</dd>
                </div>
              ))}
            </dl>
          </Field>
        )}

        {edge.id && (
          <Field label="ID arco">
            <p className="break-all font-mono text-xs text-slate-500">{edge.id}</p>
          </Field>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <p className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      {children}
    </div>
  );
}

function EndpointButton({
  node,
  fallback,
  onRecenter,
}: {
  node: GraphNode | undefined;
  fallback: string;
  onRecenter: (n: GraphNode) => void;
}): React.ReactElement {
  if (!node) {
    return (
      <span className="min-w-0 flex-1 truncate text-xs text-slate-400" title={fallback}>
        {fallback}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onRecenter(node)}
      title={`Centra su ${node.label}`}
      className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-slate-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-200 dark:hover:bg-slate-900/60"
    >
      <Crosshair className="h-3 w-3 shrink-0 text-slate-400" />
      <span className="truncate">{node.label}</span>
    </button>
  );
}
