// apps/web/src/components/features/decisions/DecisionLink.tsx
import type { MouseEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { linkableDecisionPath, parseDecisionPath, type LooseDecisionRef } from '../../../utils/decisionLinks';
import { useAppStore } from '../../../store/useAppStore';

interface DecisionLinkProps {
  to: LooseDecisionRef;
  /** The workspace tab the link sits in: on the search page the decision opens beside it. */
  besideTabId?: string;
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
 * new tab or a copied link works); a plain click on the search page opens the decision's tab
 * beside the article, anywhere else it goes to the address, which queues the decision.
 * Data that cannot make an address (no year, another court) is a plain label.
 */
export function DecisionLink({ to, besideTabId, className, title, children }: DecisionLinkProps) {
  const path = linkableDecisionPath(to);
  const navigate = useNavigate();
  const onSearchPage = useLocation().pathname === '/';
  const openDecisionTab = useAppStore((s) => s.openDecisionTab);
  if (!path) return <span className={className} title={title}>{children}</span>;

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!onSearchPage) {
      navigate(path);
      return;
    }
    const parsed = parseDecisionPath(pathParams(path), new URL(path, 'http://link.invalid').searchParams);
    if (parsed.ok) openDecisionTab(parsed.reference, { besideTabId });
  };
  return <a href={path} onClick={onClick} className={className} title={title}>{children}</a>;
}
