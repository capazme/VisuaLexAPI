import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Gavel, Search, SlidersHorizontal, Tag, Zap } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../../../constants/interactions';
import { useAppStore } from '../../../store/useAppStore';
import { citationSearchParams, useSearchQuery } from '../../../hooks/useSearchQuery';
import { useSearchActions } from '../../../hooks/useSearchActions';
import { SEARCH_FIELD_FORM_ID, subscribeSearchField } from '../../../utils/searchFieldControl';
import { defaultSearchFilters } from '../../../utils/searchFilters';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import { useIsDesktop } from '../../../hooks/useIsDesktop';

/**
 * The search page's field, always on screen above the practices (spec
 * `2026-10-13-fixed-search-design.md`). It reads what is typed as the palette does (`useSearchQuery`):
 * Enter opens a decision, searches a complete norm in the active practice, or searches a topic in the
 * Cassazione's decisions; a norm that still lacks its number, date or article goes on in the palette,
 * with the words already typed, which asks for the rest. «Opzioni» (⌘K) opens the palette with its
 * filters, aliases and the list of acts, which drops from this form on a computer. No practice is closed.
 */
export function SearchField() {
  const [value, setValue] = useState('');
  // Enter pressed while the server was still naming the act: the words it was pressed on.
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  // The line under the field shows while it has the focus: it never sits over the practice unasked.
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { decisionRef, parsedCitation, citationReady, citationPreview, resolvingRemotely, topic } = useSearchQuery(value);
  const actions = useSearchActions();
  // On a phone the examples do not fit: the placeholder says what the field takes, and stops there.
  const isDesktop = useIsDesktop();
  const trackAliasUsage = useAppStore((s) => s.trackAliasUsage);
  const openCommandPaletteWith = useAppStore((s) => s.openCommandPaletteWith);
  const openCommandPalette = useAppStore((s) => s.openCommandPalette);

  useEffect(() => subscribeSearchField(({ text }) => {
    if (text !== undefined) setValue(text);
    setPendingQuery(null);
    inputRef.current?.focus();
  }), []);

  const run = () => {
    const words = value.trim();
    setPendingQuery(null);
    if (!words) return;
    if (decisionRef) {
      actions.openDecision(decisionRef);
    } else if (resolvingRemotely) {
      // The server is still naming the act (the client's own reading, if any, is incomplete): the
      // search runs as soon as it has answered.
      setPendingQuery(value);
      return;
    } else if (parsedCitation) {
      if (citationReady) {
        // Counted when the alias runs; a norm handed to the palette is counted there.
        if (parsedCitation.fromAlias && parsedCitation.aliasId) trackAliasUsage(parsedCitation.aliasId);
        actions.search(citationSearchParams(parsedCitation, { filters: defaultSearchFilters() }));
      } else {
        // The act is named, its number, date or article is not: the palette asks for them.
        openCommandPaletteWith(words);
      }
    } else if (topic) {
      actions.openTopic(topic);
    } else {
      openCommandPaletteWith(words);
    }
    setValue('');
  };

  // The answer Enter was waiting for has come: run it, once. A change of the words drops the wait.
  const runWhenAnswered = useEffectEvent(() => run());
  useEffect(() => {
    if (pendingQuery !== null && pendingQuery === value && !resolvingRemotely) runWhenAnswered();
  }, [pendingQuery, value, resolvingRemotely]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value) {
      event.preventDefault();
      setValue('');
      setPendingQuery(null);
    }
  };

  const openOptions = () => {
    const words = value.trim();
    if (words) openCommandPaletteWith(words);
    else openCommandPalette();
    setValue('');
    setPendingQuery(null);
  };

  const waiting = pendingQuery !== null && pendingQuery === value;
  const hint = !value.trim() ? null
    : decisionRef ? { tone: 'ready' as const, icon: Gavel, text: `Sentenza → ${formatDecisionShort(decisionRef)}`, action: 'Invio apre' }
    : parsedCitation && citationPreview ? {
        tone: parsedCitation.fromAlias ? 'alias' as const : citationReady ? 'ready' as const : 'partial' as const,
        icon: parsedCitation.fromAlias ? Tag : Zap,
        text: `${parsedCitation.fromAlias ? 'tramite alias → ' : ''}${citationPreview}`,
        action: citationReady ? 'Invio cerca' : 'Invio completa',
      }
    : resolvingRemotely ? { tone: 'muted' as const, icon: Search, text: waiting ? 'Cerco l’atto… la ricerca parte appena lo trovo' : 'Cerco l’atto…', action: '' }
    : topic ? { tone: 'ready' as const, icon: Gavel, text: `Cerca «${topic}» nelle sentenze della Cassazione`, action: 'Invio cerca' }
    : null;
  const announcement = !hint ? '' : `${hint.text}.${hint.action ? ` ${hint.action}.` : ''}`;

  return (
    <div className="relative w-full max-w-3xl">
      <form id={SEARCH_FIELD_FORM_ID} role="search" aria-label="Ricerca" onSubmit={onSubmit} className="flex items-center gap-2">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search size={18} aria-hidden className="pointer-events-none absolute left-3 text-slate-400" />
          <input
            ref={inputRef}
            id="tour-search-field"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              // A wait belongs to the words Enter was pressed on: new words need a new Enter.
              setPendingQuery(null);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label="Cerca una norma, una sentenza o un tema"
            aria-describedby="search-field-status"
            placeholder={isDesktop ? 'Norma, sentenza o tema: art. 2043 c.c., Cass. civ. 10787/2024' : 'Norma, sentenza o tema'}
            className={cn(
              'h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 md:text-sm',
              'dark:border-slate-700 dark:bg-slate-900 dark:text-white',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30',
            )}
          />
        </div>
        <button
          type="button"
          onClick={openOptions}
          aria-label="Altre opzioni di ricerca (⌘K)"
          title="Filtri, alias e tutti gli atti (⌘K)"
          className={cn(
            'inline-flex h-11 min-w-[44px] flex-shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm transition-colors duration-150 hover:bg-slate-50',
            'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
            FOCUS_RING,
          )}
        >
          <SlidersHorizontal size={16} aria-hidden />
          <span className="hidden sm:inline">Opzioni</span>
          <kbd className="hidden rounded border border-slate-200 px-1 text-[11px] font-semibold text-slate-500 md:inline dark:border-slate-700 dark:text-slate-400">⌘K</kbd>
        </button>
      </form>

      {/* One live region for the field's life, its text changing; the visible line is aria-hidden. */}
      <p id="search-field-status" role="status" className="sr-only">{announcement}</p>

      {hint && (focused || waiting) && (
        <div
          aria-hidden
          data-testid="search-field-hint"
          className="absolute inset-x-0 top-full z-10 mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <hint.icon
            size={14}
            className={cn(
              'flex-shrink-0',
              hint.tone === 'ready' && 'text-emerald-600 dark:text-emerald-400',
              hint.tone === 'alias' && 'text-indigo-600 dark:text-indigo-400',
              hint.tone === 'partial' && 'text-amber-600 dark:text-amber-400',
              hint.tone === 'muted' && 'animate-pulse text-slate-400',
            )}
          />
          <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">{hint.text}</span>
          {hint.action && <span className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{hint.action}</span>}
        </div>
      )}
    </div>
  );
}
