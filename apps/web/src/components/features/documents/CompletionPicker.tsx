/**
 * «Completa» and «Cambia atto» (spec 2026-10-29-document-analysis §5.2–§5.4, §5.6): the user names the act of a
 * citation the page could not settle, or changes the act a row was given.
 *
 * - **The field reads like the search** — the act alone, the client parser first (with the user's aliases), then
 *   `/parse_query_batch` with that one string 250 ms after typing stops (never `/parse_query`, whose URN step logs and
 *   reaches the network); with «Riconosci solo nel browser» on, or the server silent, the client alone, and it says so.
 *   The article never leaves: whether the citation can be searched is worked out here.
 * - **The document's acts first**, the nearest above the citation leading; then the palette's acts that name an act on
 *   their own (a code by its name).
 * - **Where it goes** («Solo a questa citazione», «Anche alle altre N …», «A tutte le N da completare»), the identical
 *   ones by default when there are any; a second Enter applies.
 *
 * A computer gets a dialog anchored to the row (`shadow-lg`, the text column in sight beside it), a phone a sheet from
 * the bottom (`Sheet`). The focus opens in the field and goes back to the row's button as it closes.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import {
  FloatingFocusManager, FloatingPortal, autoUpdate, flip, offset, shift, size,
  useDismiss, useFloating, useInteractions, useRole,
} from '@floating-ui/react';
import { Check, CloudOff, X } from 'lucide-react';
import type { CustomAlias } from '../../../types';
import { isSearchReady } from '../../../utils/citationParser';
import { citationFromServer, readNormQuery } from '../../../utils/normQuery';
import { identifiesAct } from '../../../utils/sources/numberedActTypes';
import { filterPaletteActs, queryMatches } from '../search/paletteActs';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { FIELD_TEXT, FOCUS_RING, TRANSITION } from '../../../constants/interactions';
import { Z_INDEX } from '../../../constants/zIndex';
import { useMediaQuery } from '../../../hooks/useIsDesktop';
import { cn } from '../../../lib/utils';
import { readOnServer } from './documentServer';
import {
  actIdentity, actName, articleLabel, completionScopes, documentActs, pickerPassage,
  type DocumentAct, type ReviewedRow,
} from './documentReview';
import type { DocumentAnalysis } from './documentCandidates';

/** How long the field waits after typing stops before it asks the server (as the search does). */
export const PICKER_DEBOUNCE_MS = 250;

export type CompletionScope = 'row' | 'identical' | 'all';

interface CompletionPickerProps {
  text: string;
  row: ReviewedRow;
  rows: readonly ReviewedRow[];
  analysis: Pick<DocumentAnalysis, 'actsNamed'>;
  /** «Completa» (with the scopes) or «Cambia atto» (this row only). */
  mode: 'complete' | 'change';
  localOnly: boolean;
  customAliases: CustomAlias[];
  /** The row, to anchor the dialog on a computer. */
  anchor: HTMLElement | null;
  onApply: (act: DocumentAct, indices: number[], scope: CompletionScope) => void;
  onClose: () => void;
}

interface Option {
  id: string;
  act: DocumentAct;
  label: string;
  group: 'typed' | 'document' | 'palette';
}

type Reading =
  | { state: 'empty' }
  | { state: 'reading' }
  | { state: 'act'; act: DocumentAct }
  | { state: 'none'; offline: boolean };

const actOf = (reading: { act_type?: string; act_number?: string; date?: string; annex?: string }): DocumentAct => ({
  act_type: reading.act_type!,
  ...(reading.act_number ? { act_number: reading.act_number } : {}),
  ...(reading.date ? { date: reading.date } : {}),
  ...(reading.annex ? { annex: reading.annex } : {}),
});

const OPTION = cn(
  'flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-800 [overflow-wrap:anywhere] dark:text-slate-100',
  TRANSITION,
);

/** The act the field names, read as the search reads it; the server only for what the client cannot settle. */
function useActReading(query: string, localOnly: boolean, customAliases: CustomAlias[]): Reading {
  const trimmed = query.trim();
  const local = useMemo(() => {
    if (!trimmed) return null;
    const { citation } = readNormQuery(trimmed, customAliases);
    return identifiesAct(citation) ? actOf(citation!) : null;
  }, [trimmed, customAliases]);
  const [server, setServer] = useState<{ query: string; reading: Reading } | null>(null);

  useEffect(() => {
    if (!trimmed || local || localOnly || trimmed.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setServer({ query: trimmed, reading: { state: 'reading' } });
      readOnServer([trimmed], controller.signal).then(({ answers, unanswered }) => {
        const citation = citationFromServer(answers.get(trimmed));
        setServer({
          query: trimmed,
          reading: identifiesAct(citation) ? { state: 'act', act: actOf(citation!) } : { state: 'none', offline: unanswered.length > 0 },
        });
      }, () => { /* aborted: a newer query asks */ });
    }, PICKER_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, local, localOnly]);

  if (!trimmed) return { state: 'empty' };
  if (local) return { state: 'act', act: local };
  if (localOnly || trimmed.length < 3) return { state: 'none', offline: false };
  if (server?.query === trimmed) return server.reading;
  return { state: 'reading' };
}

export function CompletionPicker(props: CompletionPickerProps) {
  const { text, row, rows, analysis, mode, localOnly, customAliases, onApply, onClose } = props;
  const desktop = useMediaQuery('(min-width: 1024px)');
  const fieldRef = useRef<HTMLInputElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const listId = useId();
  const [query, setQuery] = useState('');
  // The active option by its act, not its place: the server's reading may come and put a row above it.
  const [activeAct, setActiveAct] = useState<string | null>(null);
  const [chosen, setChosen] = useState<DocumentAct | null>(null);
  const reading = useActReading(query, localOnly, customAliases);

  const scopes = useMemo(() => completionScopes(text, rows, row.index), [text, rows, row.index]);
  const withScopes = mode === 'complete' && scopes.all.length > 1;
  const [scope, setScope] = useState<CompletionScope>(() => (scopes.identical.length > 1 ? 'identical' : 'row'));
  const passage = useMemo(() => pickerPassage(text, row.start, row.end), [text, row.start, row.end]);

  const options = useMemo<Option[]>(() => {
    const out: Option[] = [];
    const seen = new Set<string>();
    const push = (act: DocumentAct, group: Option['group']) => {
      const identity = actIdentity(act);
      if (seen.has(identity)) return;
      seen.add(identity);
      out.push({ id: `${listId}-${out.length}`, act, label: actName(act), group });
    };
    if (reading.state === 'act') push(reading.act, 'typed');
    for (const act of documentActs(rows, analysis, row.start)) {
      if (queryMatches(query, actName(act), act.act_type)) push(act, 'document');
    }
    for (const group of filterPaletteActs(query)) {
      for (const act of group.acts) {
        if (identifiesAct({ act_type: act.value })) push({ act_type: act.value }, 'palette');
      }
    }
    return out;
  }, [reading, rows, analysis, row.start, query, listId]);


  const active = activeAct === null ? -1 : options.findIndex((o) => actIdentity(o.act) === activeAct);
  const setActive = (index: number) => setActiveAct(index < 0 ? null : actIdentity(options[index].act));

  const pick = (act: DocumentAct) => {
    if (!withScopes) {
      onApply(act, [row.index], 'row');
      return;
    }
    setChosen(act);
  };
  // The scopes are drawn: «Applica» takes the focus, so a second Enter applies the default.
  useEffect(() => {
    if (chosen) applyRef.current?.focus();
  }, [chosen]);

  const apply = () => {
    if (!chosen) return;
    const indices = scope === 'identical' ? scopes.identical : scope === 'all' ? scopes.all : [row.index];
    onApply(chosen, indices, scope);
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((Math.max(active, step > 0 ? -1 : 0) + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option) pick(option.act);
      else if (reading.state === 'act') pick(reading.act);
    } else if (event.key === 'Home' && active >= 0) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End' && active >= 0) {
      event.preventDefault();
      setActive(options.length - 1);
    }
  };

  const searchable = chosen ? isSearchReady({ ...chosen, article: row.article, confidence: 1 }) : false;
  const groups: Array<{ key: Option['group']; heading: string }> = [
    { key: 'typed', heading: 'Riconosciuto' },
    { key: 'document', heading: 'Atti citati in questo documento' },
    { key: 'palette', heading: 'Scegli l’atto' },
  ];
  const title = mode === 'complete' ? `Completa «${articleLabel(row)}»` : `Cambia atto di «${articleLabel(row)}»`;

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The context: the sentence around the citation, the citation in bold (§5.2). */}
      <p className="shrink-0 border-b border-slate-100 px-4 py-3 font-serif text-[0.9375rem] leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:border-slate-800 dark:text-slate-300">
        {passage.cutBefore && '…'}{passage.before}<strong className="font-semibold text-slate-900 dark:text-slate-50">{passage.match}</strong>{passage.after}{passage.cutAfter && '…'}
      </p>
      {!chosen ? (
        <>
          <div className="shrink-0 px-4 pt-3">
            <label htmlFor={`${listId}-field`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">Atto</label>
            <input
              ref={fieldRef}
              id={`${listId}-field`}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={options[active]?.id}
              aria-describedby={`${listId}-reading`}
              autoComplete="off"
              spellCheck={false}
              value={query}
              // A new list starts with nothing active: Enter then takes what the field reads.
              onChange={(event) => { setQuery(event.target.value); setActive(-1); }}
              onKeyDown={onFieldKey}
              placeholder="es. l. 241/1990, gdpr, codice del consumo"
              className={cn(
                'mt-1 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-900 placeholder:text-slate-400',
                'dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500',
                FIELD_TEXT, FOCUS_RING,
              )}
            />
            <p id={`${listId}-reading`} aria-live="polite" className="min-h-6 pt-1 text-[13px] leading-snug text-slate-600 dark:text-slate-400">
              {reading.state === 'act' && <>Riconosco: <span className="font-medium text-slate-900 dark:text-slate-100">{actName(reading.act)}</span></>}
              {reading.state === 'reading' && 'Leggo…'}
              {reading.state === 'none' && (localOnly
                ? 'Non riconosco un atto: leggo solo nel browser, scegli dall’elenco o scrivi tipo, numero e anno.'
                : reading.offline
                  ? <><CloudOff aria-hidden size={13} className="mr-1 inline align-[-2px]" />VisuaLex non risponde: leggo solo nel browser.</>
                  : 'Non riconosco un atto in queste parole.')}
            </p>
          </div>
          <div id={listId} role="listbox" aria-label="Atti" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {groups.map(({ key, heading }) => {
              const inGroup = options.filter((o) => o.group === key);
              if (inGroup.length === 0) return null;
              return (
                <div key={key} role="group" aria-label={heading}>
                  <p aria-hidden="true" className="px-2 pb-1 pt-3 text-[12px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{heading}</p>
                  {inGroup.map((option) => {
                    const isActive = options[active]?.id === option.id;
                    return (
                      <div
                        key={option.id}
                        id={option.id}
                        role="option"
                        aria-selected={isActive}
                        // A pointer picks without taking the focus from the field.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => pick(option.act)}
                        className={cn(OPTION, 'cursor-pointer', isActive ? 'bg-primary-50 text-primary-900 dark:bg-primary-950/50 dark:text-primary-100' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60')}
                      >
                        {option.label}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Atto: <span className="font-medium text-slate-900 dark:text-slate-50">{actName(chosen)}</span>
            {!searchable && <span className="block pt-1 text-[13px] text-slate-600 dark:text-slate-400">Con questo atto la citazione non si può ancora aprire nel lettore.</span>}
          </p>
          <fieldset className="mt-3">
            <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">Dove lo applico?</legend>
            {([
              ['row', 'Solo a questa citazione', 1],
              ...(scopes.identical.length > 1 ? [['identical', `Anche alle altre ${scopes.identical.length - 1} «${articleLabel(row)}» da completare`, scopes.identical.length]] : []),
              ['all', `A tutte le ${scopes.all.length} da completare`, scopes.all.length],
            ] as Array<[CompletionScope, string, number]>).map(([value, label]) => (
              <label key={value} className={cn('mt-1 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60')}>
                <input
                  type="radio"
                  name={`${listId}-scope`}
                  value={value}
                  checked={scope === value}
                  onChange={() => setScope(value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }}
                  className="size-4 accent-primary-600"
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
        {chosen ? (
          <>
            <Button variant="ghost" onClick={() => { setChosen(null); requestAnimationFrame(() => fieldRef.current?.focus()); }} className="min-h-11">Indietro</Button>
            <Button ref={applyRef} variant="primary" icon={<Check size={15} />} onClick={apply} className="min-h-11">Applica</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} className="min-h-11">Annulla</Button>
            <Button
              variant="primary"
              disabled={reading.state !== 'act' && !options[active]}
              onClick={() => { const option = options[active]; if (option) pick(option.act); else if (reading.state === 'act') pick(reading.act); }}
              className="min-h-11"
            >
              Scegli
            </Button>
          </>
        )}
      </div>
    </div>
  );

  if (!desktop) {
    return (
      <Sheet title={title} onClose={onClose} initialFocusRef={fieldRef} closeOnEscape className="max-h-[85dvh]">
        {body}
      </Sheet>
    );
  }
  return (
    <AnchoredDialog anchor={props.anchor} titleId={titleId} title={title} onClose={onClose} initialFocus={fieldRef}>
      {body}
    </AnchoredDialog>
  );
}

/** A computer's dialog by the row: under it or over it, as room allows, never wider than 26 rem. */
function AnchoredDialog({ anchor, titleId, title, onClose, initialFocus, children }: {
  anchor: HTMLElement | null;
  titleId: string;
  title: string;
  onClose: () => void;
  initialFocus: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (next) => { if (!next) onClose(); },
    placement: 'bottom-end',
    // The anchor from the first render, so the first position is right (gotcha 13).
    elements: { reference: anchor },
    middleware: [
      offset(6),
      flip({ fallbackPlacements: ['top-end', 'left-start'] }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(260, Math.min(availableHeight, 560))}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);
  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal initialFocus={initialFocus} returnFocus>
        <div
          // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          aria-labelledby={titleId}
          className={cn('flex w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900', Z_INDEX.modal)}
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 py-1 pl-4 pr-1 dark:border-slate-800">
            <h2 id={titleId} className="min-w-0 text-base font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi"
              className={cn('inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200', FOCUS_RING)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          {children}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
