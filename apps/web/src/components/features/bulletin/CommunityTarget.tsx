import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import type { CommunityTarget as Target } from '../../../types/community';
import { decisionPath, identityFromKey } from '../../../utils/decisionLinks';
import { anchorLabel, searchParamsFromAnchor } from '../studia/studiaLabels';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';

interface Props {
  target: Target;
  articleUrn: string | null;
  articleId: string;
  articleLabel: string | null;
  decisionLabel: string | null;
}

const LINK = cn('rounded text-xs font-medium text-primary-700 underline-offset-2 hover:underline dark:text-primary-300', FOCUS_RING);

/**
 * What a discussion hangs on, and the way to open it: a decision at its address, an article in the reader (from its
 * URN, as a card's anchor opens). With nothing to open it by, its name alone.
 */
export function CommunityTarget({ target, articleUrn, articleId, articleLabel, decisionLabel }: Props) {
  const navigate = useNavigate();
  const triggerSearch = useAppStore((s) => s.triggerSearch);

  if (target.kind === 'decision') {
    const label = decisionLabel ?? 'Sentenza';
    const identity = identityFromKey(target.key);
    if (!identity) return <span className="text-xs text-slate-600 dark:text-slate-400">{label}</span>;
    return <Link to={decisionPath(identity)} aria-label={`Apri ${label}`} className={LINK}>{label}</Link>;
  }

  const params = articleUrn ? searchParamsFromAnchor({ urn: articleUrn }) : null;
  const label = (articleUrn && anchorLabel({ urn: articleUrn })) || articleLabel || `art. ${articleId}`;
  if (!params) return <span className="text-xs text-slate-600 dark:text-slate-400">{label}</span>;
  return (
    <button
      type="button"
      aria-label={`Apri ${label}`}
      onClick={() => {
        navigate('/');
        triggerSearch(params);
      }}
      className={LINK}
    >
      {label}
    </button>
  );
}
