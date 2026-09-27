import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { promoteCandidate } from './contribApi';
import { NormaPicker } from './NormaPicker';
import { RelationEndpointPicker } from './RelationEndpointPicker';
import { stagedEndpoint } from './relationEndpoints';
import type { PromotedEntity, RelationEndpoint } from './relationEndpoints';
import type { ExtractionCandidate, PromoteCandidatePayload, PromoteDuplicate } from './types';

/**
 * Per-requirement checklist for the copyright gate (Slice 3 §3.8): makes each
 * ✓/✗ legible to a lawyer instead of a bare disabled button. Every requirement
 * is derived from the SAME booleans that drive `canPromote`.
 */
interface GateRequirement {
  label: string;
  met: boolean;
}

function PromotionChecklist({ requirements }: { requirements: GateRequirement[] }) {
  return (
    <ul data-testid="promotion-checklist" className="mt-3 space-y-1 text-xs">
      {requirements.map((req) => (
        <li
          key={req.label}
          className={
            req.met
              ? 'flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400'
              : 'flex items-center gap-1.5 text-slate-500 dark:text-slate-400'
          }
        >
          {req.met ? <Check size={13} /> : <X size={13} />}
          <span>{req.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Review + promote a single extracted candidate (Slice 2c). The promote action
 * is gated client-side (mirror of the server copyright gate): a citable fonte,
 * a reformulated description that differs from the verbatim excerpt, and an
 * explicit attestation. The server re-checks against the authoritative verbatim.
 */

export interface CandidateCardProps {
  candidate: ExtractionCandidate;
  articleUrn: string;
  /** Called once a pending_* row exists, with its MERL-T id. */
  onPromoted: (candidateId: number, pendingId: string) => void;
  /**
   * Entity candidates of the same document promoted in this session: a
   * relation end can point at one of them ("usa la proposta appena promossa").
   */
  promotedEntities?: PromotedEntity[];
}

const NO_PROMOTED_ENTITIES: PromotedEntity[] = [];

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

const PLACEHOLDER_URN = 'user_document';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  concetto: 'Concetto',
  principio: 'Principio',
  definizione: 'Definizione',
};

export function CandidateCard({
  candidate,
  articleUrn: defaultArticleUrn,
  onPromoted,
  promotedEntities = NO_PROMOTED_ENTITIES,
}: CandidateCardProps) {
  const verbatim = candidate.verbatim_excerpt ?? '';
  const [descrizione, setDescrizione] = useState(candidate.descrizione ?? '');
  // Pre-filled with a sensible default so the user doesn't have to type
  // anything for the common case of notes-derived candidates. The user can
  // override with a real source (book, page) before promoting.
  const [fonte, setFonte] = useState('Appunti personali');
  // Optional: if the user wants to bind the proposal to a specific norma, they
  // can paste a URN here. Defaults to the candidate's own context (often the
  // `user_document` placeholder) and the BFF replaces a blank with that
  // placeholder server-side. The proposal still goes through validation; the
  // community can re-link it to a real article later.
  const initialUrn =
    candidate.article_urn && candidate.article_urn !== PLACEHOLDER_URN
      ? candidate.article_urn
      : defaultArticleUrn;
  const [articleUrn, setArticleUrn] = useState(initialUrn);
  const [attested, setAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // MERL-T deferred on an identical proposal: the user confirms or drops.
  const [duplicates, setDuplicates] = useState<PromoteDuplicate[] | null>(null);
  // B1: the two ends of a relation, as identifiers the graph knows. Seeded
  // only when the staging parser already resolved them; a concept name the
  // extractor wrote is never sent as an endpoint.
  const isRelation = candidate.candidate_type === 'relation';
  const sourceText = candidate.source_text || candidate.source_node_urn || '';
  const targetText = candidate.target_text || candidate.target_entity_id || '';
  const [sourceEndpoint, setSourceEndpoint] = useState<RelationEndpoint | null>(() =>
    stagedEndpoint(candidate.source_node_urn, candidate.source_text, candidate.source_resolved),
  );
  const [targetEndpoint, setTargetEndpoint] = useState<RelationEndpoint | null>(() =>
    stagedEndpoint(candidate.target_entity_id, candidate.target_text, candidate.target_resolved),
  );

  const hasFonte = fonte.trim().length > 0;
  const reformulated = normalize(descrizione).length > 0 && normalize(descrizione) !== normalize(verbatim);
  // For entities the article URN is optional (BFF fallback). For relations it
  // still carries semantic weight (source endpoint), so we keep requiring it.
  const articleRequired = isRelation;
  const hasArticle = articleUrn.trim().length > 0 && articleUrn.trim() !== PLACEHOLDER_URN;
  const endpointsResolved = !isRelation || (sourceEndpoint !== null && targetEndpoint !== null);
  const canPromote =
    hasFonte && attested && reformulated && (!articleRequired || hasArticle) && endpointsResolved && !submitting;

  // Legible copyright gate — each requirement mirrors a `canPromote` condition.
  const requirements: GateRequirement[] = [
    { label: 'Fonte indicata', met: hasFonte },
    { label: 'Riformulazione diversa dall’estratto originale', met: reformulated },
    { label: 'Dichiarazione di riformulazione originale', met: attested },
    ...(articleRequired ? [{ label: 'Norma di riferimento selezionata', met: hasArticle }] : []),
    ...(isRelation ? [{ label: 'Estremi della relazione collegati al grafo', met: endpointsResolved }] : []),
  ];

  const handlePromote = async (confirmDuplicate?: PromoteDuplicate) => {
    setSubmitting(true);
    setError(null);
    setDuplicates(null);
    try {
      const retry = confirmDuplicate
        ? { skipDuplicateCheck: true, acknowledgedDuplicateOf: confirmDuplicate.id || undefined }
        : {};
      const payload: PromoteCandidatePayload =
        candidate.candidate_type === 'entity'
          ? {
              candidateType: 'entity',
              articleUrn,
              nome: candidate.entity_text ?? '',
              // The LLM-assigned type; the BFF re-reads it from the candidate.
              tipo: candidate.entity_type || 'concetto',
              descrizione,
              fonte,
              attested,
              ...retry,
            }
          : {
              candidateType: 'relation',
              articleUrn,
              // Resolved identifiers only: canPromote guarantees both are set.
              sourceUrn: sourceEndpoint?.id ?? '',
              targetEntityId: targetEndpoint?.id ?? '',
              tipoRelazione: candidate.relation_type ?? '',
              descrizione,
              fonte,
              attested,
              ...retry,
            };
      const result = await promoteCandidate(candidate.id, payload);
      // A 200 is not a success: only a pending id means a proposal exists.
      if (result.pendingId) {
        setDone(true);
        onPromoted(candidate.id, result.pendingId);
      } else if (result.duplicateActionRequired) {
        setDuplicates(result.duplicates ?? []);
      } else {
        setError(result.message || 'Proposta non creata: MERL-T non ha accettato la voce.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promozione non riuscita');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div
        data-testid={`candidate-${candidate.id}`}
        className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
      >
        <Check className="mr-2 inline" size={16} />
        Proposta inviata alla validazione della community.
      </div>
    );
  }

  return (
    <div
      data-testid={`candidate-${candidate.id}`}
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {candidate.candidate_type === 'entity' ? 'Entità' : 'Relazione'}
            {typeof candidate.llm_confidence === 'number' && ` · conf. ${candidate.llm_confidence.toFixed(2)}`}
          </span>
          {candidate.candidate_type === 'entity' && candidate.entity_type && (
            <span
              data-testid="entity-type-badge"
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
            >
              {ENTITY_TYPE_LABELS[candidate.entity_type] ?? candidate.entity_type}
            </span>
          )}
        </div>
        {isRelation ? (
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-1 text-sm font-medium text-slate-900 dark:text-white">
            <span className="truncate">{sourceText || '—'}</span>
            <ArrowRight size={12} className="shrink-0 text-slate-400" aria-hidden="true" />
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {candidate.relation_type || '—'}
            </span>
            <ArrowRight size={12} className="shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate">{targetText || '—'}</span>
          </span>
        ) : (
          <span className="font-medium text-slate-900 dark:text-white">{candidate.entity_text}</span>
        )}
      </div>

      {candidate.potential_duplicate_of && (
        <p
          data-testid="dedup-hint"
          className="mb-2 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle size={14} />
          Simile a un nodo già presente ({candidate.potential_duplicate_of}).
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Estratto originale</label>
          <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-500 dark:bg-slate-800/60">
            {verbatim || '—'}
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor={`reform-${candidate.id}`}>
            La tua riformulazione
          </label>
          <textarea
            id={`reform-${candidate.id}`}
            value={descrizione}
            onChange={(e) => setDescrizione(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
      </div>

      {isRelation && (
        <div className="mt-3 grid gap-3 md:grid-cols-2" data-testid="relation-endpoints">
          <RelationEndpointPicker
            end="source"
            rawText={sourceText}
            value={sourceEndpoint}
            onChange={setSourceEndpoint}
            promotedEntities={promotedEntities}
          />
          <RelationEndpointPicker
            end="target"
            rawText={targetText}
            value={targetEndpoint}
            onChange={setTargetEndpoint}
            promotedEntities={promotedEntities}
          />
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <input
          aria-label="Fonte"
          placeholder="Fonte (es. Torrente, Manuale di diritto privato, p. 120)"
          value={fonte}
          onChange={(e) => setFonte(e.target.value)}
          className="w-full rounded-lg border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
        {articleRequired ? (
          <NormaPicker value={articleUrn} onChange={setArticleUrn} />
        ) : (
          <details className="rounded-lg border border-slate-200 dark:border-slate-800">
            <summary className="cursor-pointer px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
              Lega a una norma specifica (opzionale)
            </summary>
            <div className="m-2">
              <NormaPicker value={articleUrn} onChange={setArticleUrn} />
            </div>
          </details>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          Dichiaro che il testo è una mia riformulazione originale, non una copia letterale.
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {duplicates && (
        <div
          data-testid="duplicate-confirm"
          role="alert"
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <p>
            Esiste già una proposta identica
            {duplicates[0]?.text ? `: ${duplicates[0].text}` : ''}. La proposta non è stata creata.
          </p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDuplicates(null)}>
              Annulla
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={submitting}
              onClick={() => void handlePromote(duplicates[0] ?? { id: '', text: '' })}
            >
              Invia comunque
            </Button>
          </div>
        </div>
      )}

      {/* When the gate blocks promotion, spell out the missing requirements so
          the copyright gate is legible rather than a silent disabled button. */}
      {!canPromote && !submitting && <PromotionChecklist requirements={requirements} />}

      <div className="mt-3 flex justify-end">
        <Button variant="primary" size="sm" disabled={!canPromote} loading={submitting} onClick={() => void handlePromote()}>
          Promuovi come proposta
        </Button>
      </div>
    </div>
  );
}
