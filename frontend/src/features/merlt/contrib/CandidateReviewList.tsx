import { CandidateCard } from './CandidateCard';
import type { ExtractionCandidate } from './types';

export interface CandidateReviewListProps {
  candidates: ExtractionCandidate[];
  /** Article URN proposals are attached to (the document's primary article). */
  articleUrn: string;
  onPromoted: (candidateId: number) => void;
}

/** Renders the extracted candidates for per-item review + promotion (Slice 2c). */
export function CandidateReviewList({ candidates, articleUrn, onPromoted }: CandidateReviewListProps) {
  if (candidates.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Nessun candidato estratto da questo documento.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {candidates.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          articleUrn={articleUrn}
          onPromoted={onPromoted}
        />
      ))}
    </div>
  );
}
