import { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { promoteCandidate } from './contribApi';
import type { ExtractionCandidate, PromoteCandidatePayload } from './types';

/**
 * Review + promote a single extracted candidate (Slice 2c). The promote action
 * is gated client-side (mirror of the server copyright gate): a citable fonte,
 * a reformulated description that differs from the verbatim excerpt, and an
 * explicit attestation. The server re-checks against the authoritative verbatim.
 */

export interface CandidateCardProps {
  candidate: ExtractionCandidate;
  articleUrn: string;
  onPromoted: (candidateId: number) => void;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

const PLACEHOLDER_URN = 'user_document';

export function CandidateCard({ candidate, articleUrn: defaultArticleUrn, onPromoted }: CandidateCardProps) {
  const verbatim = candidate.verbatim_excerpt ?? '';
  const [descrizione, setDescrizione] = useState(candidate.descrizione ?? '');
  const [fonte, setFonte] = useState('');
  // #6: the user associates the real norma the proposal attaches to. Defaults to
  // the page context; the parser's "user_document" placeholder never promotes.
  const initialUrn =
    candidate.article_urn && candidate.article_urn !== PLACEHOLDER_URN
      ? candidate.article_urn
      : defaultArticleUrn;
  const [articleUrn, setArticleUrn] = useState(initialUrn);
  const [attested, setAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reformulated = normalize(descrizione).length > 0 && normalize(descrizione) !== normalize(verbatim);
  const hasArticle = articleUrn.trim().length > 0 && articleUrn.trim() !== PLACEHOLDER_URN;
  const canPromote =
    fonte.trim().length > 0 && attested && reformulated && hasArticle && !submitting;

  const handlePromote = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: PromoteCandidatePayload =
        candidate.candidate_type === 'entity'
          ? {
              candidateType: 'entity',
              articleUrn,
              nome: candidate.entity_text ?? '',
              tipo: candidate.relation_type ?? 'concetto',
              descrizione,
              fonte,
              attested,
            }
          : {
              candidateType: 'relation',
              articleUrn,
              sourceUrn: candidate.source_node_urn ?? '',
              targetEntityId: candidate.target_entity_id ?? '',
              tipoRelazione: candidate.relation_type ?? '',
              descrizione,
              fonte,
              attested,
            };
      await promoteCandidate(candidate.id, payload);
      setDone(true);
      onPromoted(candidate.id);
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
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {candidate.candidate_type === 'entity' ? 'Entità' : 'Relazione'}
          {typeof candidate.llm_confidence === 'number' && ` · conf. ${candidate.llm_confidence.toFixed(2)}`}
        </span>
        <span className="font-medium text-slate-900 dark:text-white">{candidate.entity_text}</span>
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

      <div className="mt-3 flex flex-col gap-2">
        <input
          aria-label="Norma di riferimento"
          placeholder="Norma di riferimento (URN, es. urn:nir:stato:codice.civile:1942;262~art1453)"
          value={articleUrn}
          onChange={(e) => setArticleUrn(e.target.value)}
          className="w-full rounded-lg border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
        <input
          aria-label="Fonte"
          placeholder="Fonte (es. Torrente, Manuale di diritto privato, p. 120)"
          value={fonte}
          onChange={(e) => setFonte(e.target.value)}
          className="w-full rounded-lg border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
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

      <div className="mt-3 flex justify-end">
        <Button variant="primary" size="sm" disabled={!canPromote} loading={submitting} onClick={() => void handlePromote()}>
          Promuovi come proposta
        </Button>
      </div>
    </div>
  );
}
