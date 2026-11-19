import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import type { CommunityTarget as Target } from '../../../types/community';
import { decisionPath, identityFromKey } from '../../../utils/decisionLinks';
import { anchorLabel, searchParamsFromAnchor } from '../studia/studiaLabels';
import { Button } from '../../ui/Button';
import { buttonClassName } from '../../ui/buttonStyles';

interface Props {
  target: Target;
  articleUrn: string | null;
  articleId: string;
  articleLabel: string | null;
  decisionLabel: string | null;
}

// A command, not text: the common link (LC114), the same for a norm (a button) and a decision (a link), 44 px to touch
// on a phone and 36 from md.

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
    return <Link to={decisionPath(identity)} aria-label={`Apri ${label}`} className={buttonClassName('link')}>{label}</Link>;
  }

  const params = articleUrn ? searchParamsFromAnchor({ urn: articleUrn }) : null;
  const label = (articleUrn && anchorLabel({ urn: articleUrn })) || articleLabel || `art. ${articleId}`;
  if (!params) return <span className="text-xs text-slate-600 dark:text-slate-400">{label}</span>;
  return (
    <Button
      type="button"
      variant="link"
      aria-label={`Apri ${label}`}
      onClick={() => {
        navigate('/');
        triggerSearch(params);
      }}
    >
      {label}
    </Button>
  );
}
