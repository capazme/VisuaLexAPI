import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../../../constants/interactions';
import type { CompareArticle } from '../../../hooks/useCompare';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { compareArticles, summarySentence, type CompareSide } from '../../../utils/articleCompare';
import { buildItemKey } from '../../../utils/normaKeys';
import { describeVersion, versionKey } from '../../../utils/versionDisplay';
import { VersionBanner } from '../search/VersionBanner';
import { ArticleHeader } from './ArticleHeader';
import { CELL_TINT, layoutComparison, readSide, sideNames, tailRange, type Cell, type SideText, type ViewItem } from './compareLayout';
import { GapCell, LabelPill, TextCell } from './compareParts';
import { useCompareNotes } from './useCompareNotes';

interface CompareBodyProps {
  left: CompareArticle;
  right: CompareArticle;
  onRemove: (side: CompareSide) => void;
}

const identityOf = (a: CompareArticle): string => `${buildItemKey(a.article.norma_data)}|${versionKey(a.article.norma_data)}`;

const foldText = (count: number) => `${count} ${count === 1 ? 'comma invariato' : 'commi invariati'}`;

type Choice = 'left' | 'right' | 'diff';

/**
 * The comparison itself: the two articles' commi in rows (spec 2026-10-13-compare-articles-design.md).
 * Each cell is the reader's own structured text for that comma, so every column still spells its
 * article's text (root rule 23); the labels, the pills, the gaps and the diff's marks are elements
 * around it. One layout per breakpoint (gotcha 26): a grid on the desktop, a column of commi with a
 * switch between the versions on a phone.
 */
export function CompareBody({ left, right, onRemove }: CompareBodyProps) {
  const isDesktop = useIsDesktop();
  const articles = useMemo(() => ({ left: left.article, right: right.article }), [left.article, right.article]);
  const texts = useMemo(() => ({ left: readSide(left.article), right: readSide(right.article) }), [left.article, right.article]);
  const comparison = useMemo(() => compareArticles(left.article, right.article), [left.article, right.article]);
  const names = useMemo(() => sideNames(comparison, articles), [comparison, articles]);

  const [onlyChanges, setOnlyChanges] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});

  const items = useMemo(
    () => layoutComparison(comparison, texts, { onlyChanges, expanded }),
    [comparison, texts, onlyChanges, expanded],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const resetKey = `${identityOf(left)}#${identityOf(right)}`;
  const contentKey = `${resetKey}:${isDesktop ? 'd' : 'p'}:${onlyChanges}:${[...expanded].join(',')}:${JSON.stringify(choices)}`;
  const { updatesOpen, notePopover } = useCompareNotes(rootRef, resetKey, contentKey, texts);

  const versions = comparison.kind === 'versions';
  const defaultChoice: Choice = versions ? (comparison.older === 'left' ? 'right' : 'left') : 'left';
  // After «mostra» the button is gone: focus goes to the first comma it unfolded, not to the body.
  const focusAfterUnfold = useRef<string | null>(null);
  const unfold = (key: string) => {
    focusAfterUnfold.current = `row-${key.slice('fold-'.length)}`;
    setExpanded((prev) => new Set(prev).add(key));
  };
  useEffect(() => {
    const target = focusAfterUnfold.current;
    focusAfterUnfold.current = null;
    if (target) rootRef.current?.querySelector<HTMLElement>(`[data-focus-key="${target}"]`)?.focus();
  }, [expanded]);
  const toggleOnlyChanges = () => {
    setOnlyChanges((v) => !v);
    setExpanded(new Set());
  };

  const sentence = summarySentence(comparison.summary);
  // A side the source did not give as asked (its window misses the day, or the article did not exist
  // yet) is not labelled against the other (`compareKindOf`); its banner says why (gotcha 32).
  const warnings = (['left', 'right'] as const).flatMap((side) => {
    const { article } = side === 'left' ? left : right;
    const display = describeVersion(article.validity, {
      versione: article.norma_data.versione,
      data_versione: article.norma_data.data_versione,
    }, article.upcoming);
    // An article that will change says so too (V1), above its column; it is still compared.
    const says = !display.canCite || display.banner?.kind === 'upcoming';
    return says && display.banner ? [{ side, banner: display.banner, hidden: !display.textVisible }] : [];
  });
  // An article that did not exist yet has no text to read (the reader hides it): nothing is compared.
  const nothingToCompare = warnings.some((w) => w.hidden);
  const tails = { left: tailRange(texts.left), right: tailRange(texts.right) };

  return (
    <div
      ref={rootRef}
      data-testid="compare-body"
      data-kind={comparison.kind}
      className={cn('vlx-compare flex-1 min-h-0 overflow-y-auto bg-white dark:bg-slate-900', updatesOpen && 'vlx-updates-open')}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <p data-testid="compare-summary" className="min-w-0 flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {sentence}
        </p>
        {versions && (
          <button
            type="button"
            role="switch"
            aria-checked={onlyChanges}
            onClick={toggleOnlyChanges}
            className={cn(
              'inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm font-medium md:min-h-0 md:py-1.5',
              'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
              FOCUS_RING,
            )}
          >
            <span
              aria-hidden
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors',
                onlyChanges ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600',
              )}
            >
              <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform', onlyChanges && 'translate-x-[0.975rem]')} />
            </span>
            Solo le modifiche
          </button>
        )}
      </div>

      {warnings.length > 0 && (
        <div data-testid="compare-warnings" className="border-b border-slate-100 px-4 pt-3 dark:border-slate-800">
          {warnings.map(({ side, banner, hidden }) => (
            <div key={side}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{names[side]}</p>
              <VersionBanner banner={banner} variant={hidden ? 'state' : 'banner'} />
              {hidden && (
                <button
                  type="button"
                  onClick={() => onRemove(side)}
                  className={cn('mb-4 min-h-[44px] rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 md:min-h-0 md:py-1.5 dark:text-slate-200 dark:hover:bg-slate-800', FOCUS_RING)}
                >
                  Scegli un altro articolo
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {nothingToCompare ? null : isDesktop ? (
        <DesktopRows
          left={left}
          right={right}
          onRemove={onRemove}
          items={items}
          texts={texts}
          tails={tails}
          names={names}
          onUnfold={unfold}
        />
      ) : (
        <PhoneRows
          items={items}
          texts={texts}
          tails={tails}
          names={names}
          defaultChoice={defaultChoice}
          choices={choices}
          onChoose={(key, choice) => setChoices((prev) => ({ ...prev, [key]: choice }))}
          onUnfold={unfold}
        />
      )}
      {notePopover}
    </div>
  );
}

const COLUMNS = 'grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)]';

type Tails = Record<CompareSide, { start: number; end: number } | null>;

function FoldRow({ item, onUnfold, className }: { item: Extract<ViewItem, { type: 'fold' }>; onUnfold: (key: string) => void; className?: string }) {
  return (
    <button
      type="button"
      data-testid="compare-fold"
      onClick={() => onUnfold(item.key)}
      className={cn(
        'flex w-full min-h-[44px] items-center justify-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400 dark:hover:bg-slate-800',
        FOCUS_RING,
        className,
      )}
    >
      <ChevronRight size={14} aria-hidden />
      {foldText(item.count)} · mostra
    </button>
  );
}

function rowName(item: Extract<ViewItem, { type: 'row' }>): string {
  if (item.part === 'head') return 'Intestazione';
  if (item.part === 'rubric') return 'Rubrica';
  return item.number ? `Comma ${item.number}` : 'Comma';
}

function DesktopRows({
  left, right, onRemove, items, texts, tails, names, onUnfold,
}: {
  left: CompareArticle;
  right: CompareArticle;
  onRemove: (side: CompareSide) => void;
  items: ViewItem[];
  texts: Record<CompareSide, SideText>;
  tails: Tails;
  names: Record<CompareSide, string>;
  onUnfold: (key: string) => void;
}) {
  return (
    <div role="table" aria-label="Confronto dei commi">
      <div role="row" className={cn(COLUMNS, 'sticky top-0 z-10 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900')}>
        <div role="columnheader" aria-label="Comma" />
        <div role="columnheader" className="min-w-0">
          <ArticleHeader article={left} side="left" onRemove={() => onRemove('left')} />
        </div>
        <div role="columnheader" className="min-w-0 border-l border-slate-200 dark:border-slate-700">
          <ArticleHeader article={right} side="right" onRemove={() => onRemove('right')} />
        </div>
      </div>

      {items.map((item) =>
        item.type === 'fold' ? (
          <div key={item.key} role="row" className={COLUMNS}>
            <div role="cell" className="col-span-3">
              <FoldRow item={item} onUnfold={onUnfold} />
            </div>
          </div>
        ) : (
          <div
            key={item.key}
            role="row"
            data-compare-row={item.part}
            data-label={item.label ?? ''}
            className={cn(COLUMNS, 'border-b border-slate-100 dark:border-slate-800')}
          >
            <div
              role="rowheader"
              tabIndex={-1}
              data-focus-key={item.key}
              className={cn('flex flex-col items-start gap-1.5 px-3 py-3 text-xs text-slate-500 dark:text-slate-400', FOCUS_RING)}
            >
              {item.part !== 'head' && <span className="font-semibold text-slate-700 dark:text-slate-200">{rowName(item)}</span>}
              {item.label && <LabelPill label={item.label} tooLong={item.tooLong} />}
            </div>
            {(['left', 'right'] as const).map((side) => {
              const cell: Cell | undefined = item.cells[side];
              return cell ? (
                <TextCell
                  key={side}
                  side={side}
                  text={texts[side]}
                  cell={cell}
                  className={cn(side === 'right' && 'border-l border-slate-100 dark:border-slate-800', item.label && CELL_TINT[item.label])}
                />
              ) : (
                <div key={side} role="cell" className={cn('flex', side === 'right' && 'border-l border-slate-100 dark:border-slate-800')}>
                  <GapCell side={side} part={item.part} name={names[side]} />
                </div>
              );
            })}
          </div>
        ),
      )}

      {(tails.left || tails.right) && (
        <div role="row" data-compare-row="tail" className={cn(COLUMNS, 'border-t border-slate-200 dark:border-slate-700')}>
          <div role="rowheader" />
          {(['left', 'right'] as const).map((side) => {
            const range = tails[side];
            return range ? (
              <TextCell
                key={side}
                side={side}
                text={texts[side]}
                cell={{ range, changes: [] }}
                className={cn(side === 'right' && 'border-l border-slate-100 dark:border-slate-800')}
              />
            ) : (
              <div key={side} role="cell" />
            );
          })}
        </div>
      )}
    </div>
  );
}

function PhoneRows({
  items, texts, tails, names, defaultChoice, choices, onChoose, onUnfold,
}: {
  items: ViewItem[];
  texts: Record<CompareSide, SideText>;
  tails: Tails;
  names: Record<CompareSide, string>;
  defaultChoice: Choice;
  choices: Readonly<Record<string, Choice>>;
  onChoose: (key: string, choice: Choice) => void;
  onUnfold: (key: string) => void;
}) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((item) => {
        if (item.type === 'fold') return <FoldRow key={item.key} item={item} onUnfold={onUnfold} />;

        const sides = (['left', 'right'] as const).filter((s) => item.cells[s]);
        const wanted = choices[item.key] ?? defaultChoice;
        const hasDiff = item.label === 'modificato' && sides.length === 2;
        // A comma on one side only has one thing to show; a choice the row cannot honour falls back.
        const choice: Choice =
          wanted === 'diff' && hasDiff ? 'diff'
            : wanted !== 'diff' && item.cells[wanted] ? wanted
              : sides[0] ?? defaultChoice;
        const options: Array<{ choice: Choice; text: string }> = [
          ...(sides.length === 2 ? sides.map((s) => ({ choice: s as Choice, text: names[s] })) : []),
          ...(hasDiff ? [{ choice: 'diff' as Choice, text: 'Differenze' }] : []),
        ];
        const shown: CompareSide[] = choice === 'diff' ? ['left', 'right'] : [choice];

        return (
          <section
            key={item.key}
            data-compare-row={item.part}
            data-label={item.label ?? ''}
            aria-label={rowName(item)}
            tabIndex={-1}
            data-focus-key={item.key}
            className={cn('py-2', FOCUS_RING)}
          >
            <div className="flex flex-wrap items-center gap-2 px-4 pt-1">
              {item.part !== 'head' && <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{rowName(item)}</span>}
              {item.label && <LabelPill label={item.label} tooLong={item.tooLong} />}
            </div>
            {options.length > 0 && (
              <div role="group" aria-label="Versione da mostrare" className="mx-4 mt-2 flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {options.map((o) => (
                  <button
                    key={o.choice}
                    type="button"
                    aria-pressed={choice === o.choice}
                    onClick={() => onChoose(item.key, o.choice)}
                    className={cn(
                      'min-h-[44px] flex-1 rounded-md px-2 text-xs font-medium',
                      choice === o.choice
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                        : 'text-slate-600 dark:text-slate-300',
                      FOCUS_RING,
                    )}
                  >
                    {o.text}
                  </button>
                ))}
              </div>
            )}
            {shown.map((side) => {
              const cell = item.cells[side];
              if (!cell) return null;
              const drawn = choice === 'diff' ? cell : { ...cell, changes: [] };
              return (
                <div key={side}>
                  {choice === 'diff' && (
                    <p className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{names[side]}</p>
                  )}
                  <TextCell side={side} text={texts[side]} cell={drawn} className={item.label && CELL_TINT[item.label]} />
                </div>
              );
            })}
            {sides.length === 1 && (
              <p className="px-4 text-[11px] text-slate-400 dark:text-slate-500">
                Solo in: {names[sides[0]]}
              </p>
            )}
          </section>
        );
      })}

      {(['left', 'right'] as const).map((side) => {
        const range = tails[side];
        return range ? (
          <section key={side} aria-label={`Note di aggiornamento: ${names[side]}`} data-compare-row="tail">
            <p className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{names[side]}</p>
            <TextCell side={side} text={texts[side]} cell={{ range, changes: [] }} />
          </section>
        ) : null;
      })}
    </div>
  );
}
