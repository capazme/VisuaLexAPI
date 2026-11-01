import { memo, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, Link2, Link2Off, MoreHorizontal, PencilLine, RotateCcw, Undo2, XCircle } from 'lucide-react';
import { formatCitationLabel, type CitationMatch } from '../../../utils/citationMatcher';
import { FOCUS_RING, TRANSITION } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import { MenuButton, type MenuItem } from '../../ui/MenuButton';
import { RECOGNISED_EXAMPLES, citedPassage, type ActGroup, type CitedPassage } from './citationGroups';
import {
  NO_LINK_WORDS, actName, articleLabel, linksToAct, linksToFirst, type Choices, type ReviewedRow,
} from './documentReview';
import type { RowLink } from './documentLinks';

/** The first rows enter one after the other, 40 ms apart; the rest are simply there (brief D2 §4). */
const CASCADE = 8;

export interface CitationListProps {
  text: string;
  /** Every row of the analysis, with the user's choices (`reviewRows`), by `index`. */
  rows: readonly ReviewedRow[];
  /** The rows listed under an act, grouped (`groupCitationsByAct` with the rows' indices). */
  groups: readonly ActGroup[];
  selected: number | null;
  choices: Choices;
  /** Each row's link once «Prepara i link» has run (by `index`); null before. */
  links: readonly RowLink[] | null;
  /** The links are being prepared: the rows show «Conferma» and «Senza link». */
  linksOn: boolean;
  /** «Rivedile»: only these rows are shown. */
  only?: ReadonlySet<number> | null;
  onSelect: (index: number) => void;
  onOpen: (citation: CitationMatch) => void;
  /** «Completa» (a row to complete) or «Cambia atto» (a row with an act): the picker, anchored to `anchor`. */
  onPick: (index: number, mode: 'complete' | 'change', anchor: HTMLElement) => void;
  onDismiss: (index: number) => void;
  onRestore: (index: number) => void;
  onUncomplete: (index: number) => void;
  onConfirm: (index: number) => void;
  onLeaveOut: (index: number, leftOut: boolean) => void;
}

const ROW = 'relative flex items-stretch border-t border-slate-100 dark:border-slate-800/80';
const SELECT = cn('min-h-[44px] min-w-0 flex-1 py-2.5 pl-4 pr-2 text-left', TRANSITION, FOCUS_RING, 'focus-visible:ring-inset focus-visible:ring-offset-0');
const ACTION = cn(
  'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1 px-3 text-sm font-medium',
  'text-primary-700 hover:bg-primary-50 hover:text-primary-800 dark:text-primary-300 dark:hover:bg-primary-950/50 dark:hover:text-primary-200',
  TRANSITION, FOCUS_RING, 'focus-visible:ring-inset focus-visible:ring-offset-0',
);
const MENU_TRIGGER = cn(
  'inline-flex size-11 shrink-0 items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
  TRANSITION, FOCUS_RING, 'focus-visible:ring-inset focus-visible:ring-offset-0',
);
const TAG = 'mt-1 block text-[12px] leading-snug text-slate-600 [overflow-wrap:anywhere] dark:text-slate-400';

function Passage({ passage }: { passage: CitedPassage }) {
  const { before, match, after, cutBefore, cutAfter } = passage;
  return (
    <span className="mt-0.5 block truncate font-serif text-sm text-slate-600 dark:text-slate-400">
      {cutBefore && '…'}{before}<span className="text-slate-900 dark:text-slate-100">{match}</span>{after}{cutAfter && '…'}
    </span>
  );
}

/** The heading of a group of the list, with its count read as words. */
function GroupHeading({ id, children, count, noun, badge }: { id: string; children: ReactNode; count: number; noun: [string, string]; badge?: boolean }) {
  return (
    <h3 id={id} className="flex items-baseline gap-1.5 px-4 pb-1.5 pt-4 font-serif text-[1.0625rem] font-medium text-slate-900 dark:text-slate-50">
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>{' '}
      {badge ? (
        // The one colour the page adds (#376 §5.6): the count of what waits for the user.
        <span className="rounded-full bg-amber-50 px-2 py-0.5 font-sans text-[12px] font-medium tabular-nums text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {count}<span className="sr-only">{count === 1 ? ` ${noun[0]}` : ` ${noun[1]}`}</span>
        </span>
      ) : (
        <>
          <span aria-hidden="true" className="text-slate-400 dark:text-slate-500">·</span>{' '}
          <span className="font-sans text-sm tabular-nums text-slate-600 dark:text-slate-400">
            {count}<span className="sr-only">{count === 1 ? ` ${noun[0]}` : ` ${noun[1]}`}</span>
          </span>
        </>
      )}
    </h3>
  );
}

/** What the row says of its link, once the links are prepared. */
function linkLine(row: ReviewedRow, link: RowLink | undefined): ReactNode {
  if (!link) return null;
  if (link.linked) {
    const where = linksToAct(link) ? ' all’atto (EUR-Lex non ha un indirizzo per articolo)' : linksToFirst(row) ? ` all’art. ${link.norm.article}` : '';
    return <span className={cn(TAG, 'text-primary-800 dark:text-primary-300')}><Link2 aria-hidden size={12} className="mr-1 inline align-[-1px]" />Con link{where}</span>;
  }
  return <span className={TAG}><Link2Off aria-hidden size={12} className="mr-1 inline align-[-1px]" />Senza link: {NO_LINK_WORDS[link.reason]}</span>;
}

export const CitationList = memo(function CitationList(props: CitationListProps) {
  const { text, rows, groups, selected, choices, links, linksOn, only, onSelect, onOpen, onPick, onDismiss, onRestore, onUncomplete, onConfirm, onLeaveOut } = props;
  const [showDismissed, setShowDismissed] = useState(false);
  const shown = (index: number) => !only || only.has(index);
  const toComplete = rows.filter((r) => r.origin === 'incomplete' && !r.dismissed && shown(r.index));
  const dismissed = rows.filter((r) => r.dismissed && shown(r.index));
  const visibleGroups = groups.map((g) => ({ ...g, entries: g.entries.filter((e) => shown(e.index)) })).filter((g) => g.entries.length > 0);

  if (visibleGroups.length === 0 && toComplete.length === 0 && dismissed.length === 0) {
    return (
      <div className="px-5 py-6">
        <p className="font-serif text-lg text-slate-800 dark:text-slate-100">Non ho trovato citazioni di norme in questo documento.</p>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
          Riconosco, per esempio, {RECOGNISED_EXAMPLES.map((example, i) => (
            <span key={example}>{i > 0 && (i === RECOGNISED_EXAMPLES.length - 1 ? ' e ' : ', ')}«{example}»</span>
          ))}.
        </p>
      </div>
    );
  }

  let order = 0;
  const cascade = () => {
    const at = order++;
    return at < CASCADE
      ? { className: 'motion-safe:animate-in fade-in slide-in-from-bottom-1 duration-200', style: { animationDelay: `${at * 40}ms` } }
      : { className: '', style: undefined };
  };
  const selection = (index: number) => index === selected;
  const Stripe = ({ on }: { on: boolean }) => (on ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary-600 dark:bg-primary-400" /> : null);
  const selectClass = (on: boolean) => (on ? 'bg-primary-50 dark:bg-primary-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50');

  return (
    <div className="pb-2">
      {toComplete.length > 0 && (
        <div>
          <GroupHeading id="doc-to-complete" count={toComplete.length} noun={['da completare', 'da completare']} badge>Da completare</GroupHeading>
          <ul aria-labelledby="doc-to-complete">
            {toComplete.map((row) => {
              const on = selection(row.index);
              const motion = cascade();
              const label = articleLabel(row);
              return (
                <li key={row.key} data-cite-row={row.index} className={cn(ROW, motion.className)} style={motion.style}>
                  <Stripe on={on} />
                  <button type="button" aria-current={on || undefined} onClick={() => onSelect(row.index)} className={cn(SELECT, selectClass(on))}>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{label}</span>
                    <Passage passage={citedPassage(text, row.start, row.end)} />
                    {row.followedBy && <span className={TAG}>seguito da «{row.followedBy}»</span>}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => { onSelect(row.index); onPick(row.index, 'complete', event.currentTarget.closest('li') ?? event.currentTarget); }}
                    aria-label={`Completa ${label}`}
                    className={ACTION}
                  >
                    Completa <PencilLine aria-hidden="true" size={15} />
                  </button>
                  <MenuButton
                    label={`Altre azioni per ${label}`}
                    placement="auto"
                    triggerClassName={MENU_TRIGGER}
                    items={[{ label: 'Non è una norma', icon: XCircle, onSelect: () => onDismiss(row.index) }]}
                  >
                    <MoreHorizontal aria-hidden size={18} />
                  </MenuButton>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {visibleGroups.map((group, g) => (
        // Not a <section>: one landmark per act would crowd a screen reader's list of landmarks.
        <div key={group.key}>
          <GroupHeading id={`doc-act-${g}`} count={group.entries.length} noun={['citazione', 'citazioni']}>{group.heading}</GroupHeading>
          <ul aria-labelledby={`doc-act-${g}`}>
            {group.entries.map(entry => {
              const row = rows[entry.index];
              const on = selection(entry.index);
              const motion = cascade();
              const label = formatCitationLabel(entry.citation.parsed);
              const choice = choices.get(row.key);
              const waits = (row.origin === 'context' || row.chosenBy === 'bulk') && !choice?.confirmed && !choice?.leftOut;
              const items: MenuItem[] = [];
              if (row.origin === 'context' || row.origin === 'chosen') {
                items.push({ label: 'Cambia atto', icon: PencilLine, onSelect: (event) => onPick(row.index, 'change', (event.currentTarget.closest('li') as HTMLElement | null) ?? event.currentTarget) });
              }
              // A row the page had read (inherited) goes back to that act; one the page could not read, back to complete.
              if (row.origin === 'chosen') items.push({ label: row.analysedAct ? 'Rimetti l’atto di prima' : 'Torna da completare', icon: Undo2, onSelect: () => onUncomplete(row.index) });
              if (linksOn) {
                if (waits) items.push({ label: 'Conferma il link', icon: Check, onSelect: () => onConfirm(row.index), separatorBefore: items.length > 0 });
                items.push(choice?.leftOut
                  ? { label: 'Rimetti il link', icon: Link2, onSelect: () => onLeaveOut(row.index, false), separatorBefore: items.length > 0 && !waits }
                  : { label: 'Senza link', icon: Link2Off, onSelect: () => onLeaveOut(row.index, true), separatorBefore: items.length > 0 && !waits });
              }
              return (
                <li key={row.key} data-cite-row={entry.index} className={cn(ROW, motion.className)} style={motion.style}>
                  <Stripe on={on} />
                  <button type="button" aria-current={on || undefined} onClick={() => onSelect(entry.index)} className={cn(SELECT, selectClass(on))}>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{entry.article}</span>
                    <Passage passage={entry.passage} />
                    {row.origin === 'context' && row.act && <span className={TAG}>dal contesto: {actName(row.act)}</span>}
                    {row.origin === 'chosen' && <span className={TAG}>scelto da te{row.chosenBy === 'bulk' ? ' (applicato a più citazioni)' : ''}</span>}
                    {links && linkLine(row, links[entry.index])}
                  </button>
                  {linksOn && waits && (
                    <button type="button" onClick={() => onConfirm(row.index)} aria-label={`Conferma il link di ${label}`} className={ACTION}>
                      Conferma
                    </button>
                  )}
                  <button type="button" onClick={() => onOpen(entry.citation)} aria-label={`Apri ${label}`} className={ACTION}>
                    Apri <ArrowUpRight aria-hidden="true" size={15} />
                  </button>
                  {items.length > 0 && (
                    <MenuButton label={`Altre azioni per ${label}`} placement="auto" triggerClassName={MENU_TRIGGER} items={items}>
                      <MoreHorizontal aria-hidden size={18} />
                    </MenuButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {dismissed.length > 0 && (
        <div className="mt-2 border-t border-slate-200 dark:border-slate-800">
          {/* The accordion pattern (`DossierActBlock`): the toggle inside the heading, its name the heading's words. */}
          <h3 className="m-0">
            <button
              type="button"
              aria-expanded={showDismissed}
              aria-controls="doc-dismissed"
              onClick={() => setShowDismissed((v) => !v)}
              className={cn('flex min-h-[44px] w-full items-center gap-1.5 px-4 text-left font-serif text-[1.0625rem] font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50', TRANSITION, FOCUS_RING, 'focus-visible:ring-inset focus-visible:ring-offset-0')}
            >
              <span aria-hidden="true" className={cn('inline-block text-slate-400 transition-transform motion-reduce:transition-none', showDismissed && 'rotate-90')}>›</span>
              Non sono norme <span className="font-sans text-sm tabular-nums text-slate-600 dark:text-slate-400">({dismissed.length})</span>
            </button>
          </h3>
          {showDismissed && (
            <ul id="doc-dismissed">
              {dismissed.map((row) => {
                const label = articleLabel(row);
                return (
                  <li key={row.key} data-cite-row={row.index} className={ROW}>
                    <div className="min-w-0 flex-1 py-2.5 pl-4 pr-2">
                      <span className="block text-sm font-medium text-slate-600 line-through decoration-slate-400 dark:text-slate-400">{label}</span>
                      <Passage passage={citedPassage(text, row.start, row.end)} />
                    </div>
                    <button type="button" onClick={() => onRestore(row.index)} aria-label={`Ripristina ${label}`} className={ACTION}>
                      Ripristina <RotateCcw aria-hidden="true" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});
