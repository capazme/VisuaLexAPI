import { useId, useState } from 'react';
import { BookOpen, Link2, Network, X } from 'lucide-react';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { NormaPicker } from './NormaPicker';
import { EntitySearchPicker } from './EntitySearchPicker';
import { isNormReference, isResolvedRelationEndpoint } from './relationEndpoints';
import type { PromotedEntity, RelationEndpoint } from './relationEndpoints';

export interface RelationEndpointPickerProps {
  /** Which end of the relation this picker resolves. */
  end: 'source' | 'target';
  /** The name the extractor wrote for this end, shown as context and used as the first search. */
  rawText: string;
  value: RelationEndpoint | null;
  onChange: (endpoint: RelationEndpoint | null) => void;
  /** Entity candidates of the same document promoted in this session. */
  promotedEntities: PromotedEntity[];
}

type Mode = 'grafo' | 'norma' | 'proposta';

const END_LABELS = {
  source: { title: 'Origine', lower: 'origine', norma: 'Norma di origine', grafo: 'Nodo di origine' },
  target: { title: 'Destinazione', lower: 'destinazione', norma: 'Norma di destinazione', grafo: 'Nodo di destinazione' },
} as const;

const KIND_ICONS = { norma: BookOpen, entity: Network, pending: Link2 } as const;

/**
 * Resolves one end of a note-derived relation to something the graph knows
 * (B1): a node found in the graph, a norm picked in natural language, or an
 * entity of the same document the user has just promoted. Until both ends are
 * resolved the card keeps promotion disabled, so a concept name never reaches
 * MERL-T as a node identifier.
 */
export function RelationEndpointPicker({
  end,
  rawText,
  value,
  onChange,
  promotedEntities,
}: RelationEndpointPickerProps) {
  const labels = END_LABELS[end];
  const layoutId = `relation-endpoint-${useId()}`;
  const [mode, setMode] = useState<Mode>('grafo');
  const [normaError, setNormaError] = useState(false);
  const activeMode: Mode = mode === 'proposta' && promotedEntities.length === 0 ? 'grafo' : mode;

  if (value) {
    const Icon = KIND_ICONS[value.kind];
    return (
      <div
        data-testid={`endpoint-${end}-selected`}
        className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30"
      >
        <span className="flex min-w-0 items-center gap-2 text-emerald-700 dark:text-emerald-300">
          <Icon size={14} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate">{value.label}</span>
            {value.label !== value.id && (
              <span className="block truncate font-mono text-[11px] opacity-80">{value.id}</span>
            )}
          </span>
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Cambia ${labels.lower}`}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded p-1 text-emerald-600 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:min-w-0 dark:hover:bg-emerald-900/40"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  const options = [
    { value: 'grafo', label: 'Nel grafo' },
    { value: 'norma', label: 'Norma' },
    ...(promotedEntities.length > 0 ? [{ value: 'proposta', label: 'Proposta promossa' }] : []),
  ];

  return (
    <div data-testid={`endpoint-${end}-picker`} className="space-y-2 rounded-lg border border-amber-200 p-2 dark:border-amber-900/60">
      <p className="text-xs text-slate-600 dark:text-slate-300">
        <span className="font-medium">{labels.title}:</span> «{rawText || 'non indicata'}». Non è ancora
        collegata al grafo: scegli a cosa si riferisce.
      </p>
      <SegmentedControl
        size="sm"
        variant="outline"
        layoutId={layoutId}
        options={options}
        value={activeMode}
        onChange={(next) => {
          setMode(next as Mode);
          setNormaError(false);
        }}
      />
      {activeMode === 'grafo' && (
        <EntitySearchPicker
          ariaLabel={labels.grafo}
          initialQuery={rawText}
          onSelect={(item) =>
            onChange({
              id: item.id,
              label: item.nome || item.id,
              kind: isNormReference(item.id) ? 'norma' : 'entity',
            })
          }
        />
      )}
      {activeMode === 'norma' && (
        <div className="space-y-1">
          <NormaPicker
            value=""
            ariaLabel={labels.norma}
            onChange={(urn) => {
              if (isResolvedRelationEndpoint(urn)) {
                setNormaError(false);
                onChange({ id: urn.trim(), label: urn.trim(), kind: 'norma' });
              } else {
                setNormaError(true);
              }
            }}
          />
          {normaError && (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              Questa norma non ha un URN Normattiva: non si può ancora collegare al grafo.
            </p>
          )}
        </div>
      )}
      {activeMode === 'proposta' && (
        <div className="space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Usa la proposta appena promossa:</p>
          <ul className="space-y-1">
            {promotedEntities.map((p) => (
              <li key={p.pendingId}>
                <button
                  type="button"
                  onClick={() => onChange({ id: p.pendingId, label: p.label, kind: 'pending' })}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-left text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <span className="truncate text-slate-800 dark:text-slate-100">{p.label}</span>
                  {p.tipo && <span className="shrink-0 text-xs text-slate-400">{p.tipo}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
