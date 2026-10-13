// apps/web/src/components/features/decisions/DecisionLink.tsx
import type { MouseEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { linkableDecisionPath, parseDecisionPath, type LooseDecisionRef } from '../../../utils/decisionLinks';
import { useAppStore } from '../../../store/useAppStore';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import { DecisionPreviewDialog } from './DecisionPreviewDialog';
import { useListDecisionPreview } from './useListDecisionPreview';

interface DecisionLinkProps {
  to: LooseDecisionRef;
  /** The place the link sits in (a practice, one of its windows or the phone's reader): on the search page the decision opens beside it. */
  besideId?: string;
  /** Where the reader stands in the article: recorded as the way back when the decision opens beside it. */
  backEntry?: ReadingBackEntry;
  className?: string;
  title?: string;
  children: ReactNode;
}

/** `/sentenze/<corte>/<numero>/<anno>` → the params the route would hand `parseDecisionPath`. */
function pathParams(path: string): { corte?: string; numero?: string; anno?: string } {
  const [, , corte, numero, anno] = new URL(path, 'http://link.invalid').pathname.split('/');
  return { corte, numero, anno };
}

/**
 * A decision named by other data. The address stays the contract (it is a real `href`, so a
 * new tab or a copied link works). A plain click, or Enter, opens the decision's preview
 * (`DecisionPreviewDialog`); its «Apri accanto» opens the decision beside the article on the
 * search page, and anywhere else goes to the address, which queues the decision.
 * Data that cannot make an address (no year, another court) is a plain label.
 */
export function DecisionLink({ to, besideId, backEntry, className, title, children }: DecisionLinkProps) {
  const path = linkableDecisionPath(to);
  const navigate = useNavigate();
  const onSearchPage = useLocation().pathname === '/';
  const openDecision = useAppStore((s) => s.openDecision);
  const pushReadingBack = useAppStore((s) => s.pushReadingBack);
  const { preview, anchorRef, toggle } = useListDecisionPreview();
  if (!path) return <span className={className} title={title}>{children}</span>;

  const parsed = parseDecisionPath(pathParams(path), new URL(path, 'http://link.invalid').searchParams);
  const open = () => {
    // the two parsers share their ranges; if they ever diverge the link still goes somewhere
    if (!onSearchPage || !parsed.ok) {
      navigate(path);
      return;
    }
    // «‹ Torna a art. 2043 c.c.» (the reading back-stack), as for a citation jump
    if (backEntry) pushReadingBack(backEntry);
    openDecision(parsed.reference, { fromLink: true, besideId });
  };

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (parsed.ok) toggle(e.currentTarget, parsed.reference, path);
    else navigate(path);
  };
  return (
    <>
      <a
        href={path}
        onClick={onClick}
        className={className}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={preview.isVisible}
      >
        {children}
      </a>
      {preview.isVisible && (
        <DecisionPreviewDialog
          preview={preview}
          anchorRef={anchorRef}
          onOpen={open}
          openLabel={onSearchPage ? 'Apri accanto' : 'Apri la sentenza'}
        />
      )}
    </>
  );
}
