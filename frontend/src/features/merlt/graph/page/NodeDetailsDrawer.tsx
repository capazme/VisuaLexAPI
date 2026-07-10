import { X, Check, Crosshair, Plus, Share2 } from 'lucide-react';
import { NODE_TYPE_STYLE } from '../shared/graphStyles';
import type { GraphNode, GraphEdge, NodeProvenance } from '../shared/types';
import { deriveProvenance, readNodeDegree } from '../shared/types';

export interface NodeDetailsDrawerProps {
  node: GraphNode | null;
  edges: GraphEdge[];
  nodesById: Map<string, GraphNode>;
  onRecenter: (node: GraphNode) => void;
  onClose: () => void;
  /**
   * Nodes-as-context: add THIS node to the question's context basket. Absent →
   * the affordance is hidden. `inContext` reflects whether it is already in the
   * basket (the button flips to a subdued "Nel contesto" confirmation).
   */
  onAddToContext?: (node: GraphNode) => void;
  inContext?: boolean;
}

// Prominent properties shown first, in this order, with friendly labels.
// The key is the REAL FalkorDB property name (verified against the Libro IV
// seed): `massima` (9.9k sentenze), NOT the historical typo `massima_text`.
const PRIMARY_PROPS: Array<{ key: string; label: string; long?: boolean }> = [
  { key: 'rubrica', label: 'Rubrica' },
  { key: 'fonte', label: 'Fonte' },
  { key: 'testo_vigente', label: 'Testo vigente', long: true },
  { key: 'testo', label: 'Testo', long: true },
  { key: 'massima', label: 'Massima', long: true },
  { key: 'regola_generale', label: 'Regola generale', long: true },
  { key: 'principi_applicati', label: 'Principi applicati', long: true },
  { key: 'descrizione', label: 'Descrizione', long: true },
  { key: 'spiegazione', label: 'Spiegazione', long: true },
  { key: 'ratio', label: 'Ratio', long: true },
];
const PRIMARY_KEYS = new Set(PRIMARY_PROPS.map((p) => p.key));

// Provenance chip copy + colour (matches the canvas provenance encoding).
const PROVENANCE_META: Record<NodeProvenance, { label: string; color: string }> = {
  seed: { label: 'Corpus', color: '#2563eb' },
  community_validated: { label: 'Validato dalla comunità', color: '#059669' },
  live_unconfirmed: { label: 'Non confermato', color: '#d97706' },
};

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Right-hand details panel for the selected node: full metadata + in/out
 * relations (each clickable to re-center on the connected node). "Centra qui"
 * re-centers on this node. Rendered inside a floating container by the page.
 */
export function NodeDetailsDrawer({
  node,
  edges,
  nodesById,
  onRecenter,
  onClose,
  onAddToContext,
  inContext = false,
}: NodeDetailsDrawerProps): React.ReactElement | null {
  if (!node) return null;

  const props = node.properties ?? {};
  const outgoing = edges.filter((e) => e.source === node.id);
  const incoming = edges.filter((e) => e.target === node.id);
  const typeColor = NODE_TYPE_STYLE[node.type]?.color ?? '#94a3b8';
  const provenance = deriveProvenance(node);
  const provMeta = provenance ? PROVENANCE_META[provenance] : null;
  // F4: FULL-graph degree (Wave-1 metadata) — the honest connection count the
  // user sees BEFORE expanding, distinct from the in/out lists below which only
  // cover the edges present in the current (possibly truncated) subgraph.
  const degree = readNodeDegree(node);

  // Remaining primitive properties not already shown prominently.
  const extraProps = Object.entries(props)
    .filter(([k]) => !PRIMARY_KEYS.has(k))
    .map(([k, v]) => [k, asText(v)] as const)
    .filter((entry): entry is [string, string] => entry[1] !== null);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
            {node.label}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300"
              style={{ backgroundColor: `${typeColor}22` }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: typeColor }} />
              {node.type}
            </span>
            {provMeta && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300"
                style={{ backgroundColor: `${provMeta.color}22` }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: provMeta.color }} />
                {provMeta.label}
              </span>
            )}
            {degree !== undefined && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                title="Numero totale di relazioni di questo nodo nell'intero grafo"
              >
                <Share2 size={10} aria-hidden="true" />
                {degree} {degree === 1 ? 'collegamento' : 'collegamenti'} nel grafo
              </span>
            )}
          </div>
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
        {node.urn && (
          <Field label="URN">
            <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">{node.urn}</p>
          </Field>
        )}

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

        <RelationGroup
          title={`Relazioni in uscita (${outgoing.length})`}
          edges={outgoing}
          dir="out"
          nodesById={nodesById}
          onRecenter={onRecenter}
        />
        <RelationGroup
          title={`Relazioni in entrata (${incoming.length})`}
          edges={incoming}
          dir="in"
          nodesById={nodesById}
          onRecenter={onRecenter}
        />
      </div>

      <footer className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-700">
        <button
          type="button"
          onClick={() => onRecenter(node)}
          className="flex flex-1 items-center justify-center gap-2 rounded bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        >
          <Crosshair className="h-4 w-4" />
          Centra qui
        </button>
        {onAddToContext &&
          (inContext ? (
            <span
              className="flex flex-1 items-center justify-center gap-1.5 rounded border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-medium text-primary-700 dark:border-primary-900 dark:bg-primary-950/40 dark:text-primary-300"
              title="Questo nodo è già nel contesto della domanda"
            >
              <Check className="h-4 w-4" />
              Nel contesto
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onAddToContext(node)}
              title="Aggiungi questo nodo al contesto della domanda"
              className="flex flex-1 items-center justify-center gap-1.5 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-700 dark:hover:bg-primary-950/40 dark:hover:text-primary-300"
            >
              <Plus className="h-4 w-4" />
              Usa come contesto
            </button>
          ))}
      </footer>
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

function RelationGroup({
  title,
  edges,
  dir,
  nodesById,
  onRecenter,
}: {
  title: string;
  edges: GraphEdge[];
  dir: 'in' | 'out';
  nodesById: Map<string, GraphNode>;
  onRecenter: (node: GraphNode) => void;
}): React.ReactElement | null {
  if (edges.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">{title}</p>
      <ul className="space-y-0.5">
        {edges.map((e) => {
          const otherId = dir === 'out' ? e.target : e.source;
          const other = nodesById.get(otherId);
          return (
            <li key={e.id ?? `${e.source}-${e.type}-${e.target}`}>
              <button
                type="button"
                disabled={!other}
                onClick={() => other && onRecenter(other)}
                className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-default disabled:opacity-50 disabled:text-slate-400 disabled:hover:bg-transparent dark:hover:bg-slate-800"
              >
                <span className="truncate text-slate-700 dark:text-slate-200">{other?.label ?? otherId}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{e.type}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
