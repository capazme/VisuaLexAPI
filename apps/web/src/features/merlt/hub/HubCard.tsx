import type { ElementType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { HUB_GATED, HUB_HEADING, HUB_PRIMARY, HUB_TILE } from './hubStyles';

/**
 * Shared shell for every hub-dashboard card (Slice 3, §3.3; S7b): the title in the reader's serif, the card's words,
 * and its one action at its foot, so the cards of a row line up their actions. No badge in a corner: a card that needs
 * more consent says it in its action (`HubAction`'s `gated`), one that cannot reach its data says it in its text
 * (fail-soft is a per-card obligation, D3).
 */

export interface HubCardProps {
  testId: string;
  icon: ElementType;
  title: string;
  /** The card's one action, at its foot. */
  action?: ReactNode;
  children: ReactNode;
}

export function HubCard({ testId, icon: Icon, title, action, children }: HubCardProps) {
  return (
    <section data-testid={testId} className={HUB_TILE}>
      <h2 className={HUB_HEADING}>
        <Icon size={18} aria-hidden className="shrink-0 text-primary-600 dark:text-primary-400" />
        {title}
      </h2>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
      {action && <div className="mt-auto flex flex-wrap gap-2 pt-4">{action}</div>}
    </section>
  );
}

export type HubActionProps =
  /** More consent is needed: the action says which, and does nothing. */
  | { gated: string }
  /** A page of Academia. */
  | { to: string; children: ReactNode }
  | { onClick: () => void; children: ReactNode };

/** A card's one action: a link, a button, or what is missing to use it. Never a button inside a link. */
export function HubAction(props: HubActionProps) {
  if ('gated' in props) {
    return (
      <button type="button" disabled className={HUB_GATED}>
        <Lock size={16} aria-hidden />
        {props.gated}
      </button>
    );
  }
  if ('to' in props) {
    return (
      <Link to={props.to} className={HUB_PRIMARY}>
        {props.children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={props.onClick} className={HUB_PRIMARY}>
      {props.children}
    </button>
  );
}
