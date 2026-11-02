/**
 * «Rassegne»: a word searched in every review of the Massimario, without starting from an article
 * (spec 2026-11-01-rassegne-search-page, G-404). A field, the passages found newest review first,
 * the articles each cites opening in the reader as a search would. The words go in a POST's body
 * (`searchRassegne`), never in the address; the last search is kept in memory for the way back from
 * an article (`searchMemory`).
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { PageFrame } from '../../layout/PageFrame';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { cn } from '../../../lib/utils';
import { FOCUS_RING, TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { useAppStore } from '../../../store/useAppStore';
import type { SearchParams } from '../../../types';
import { RassegneError, searchRassegne } from '../../../services/rassegneService';
import { MAX_QUERY_CHARS, MAX_WORDS, searchWords } from './rassegnaFilters';
import { failureOf } from './useRassegne';
import { RassegnaResult } from './RassegnaResult';
import { rememberedSearch, rememberSearch, type RememberedSearch } from './searchMemory';

type Archivio = 'civile' | 'penale';

type View =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; search: RememberedSearch; more: 'idle' | 'loading' | 'failed' }
  | { kind: 'no_store' }
  | { kind: 'error'; busy: boolean };

const NOTICE = 'text-sm text-slate-600 dark:text-slate-400';
const UNAVAILABLE = 'Le rassegne non sono disponibili al momento.';
const TOO_MANY = 'Hai fatto molte ricerche in poco tempo: riprova tra qualche minuto.';
const ARCHIVES: { value: Archivio | null; label: string }[] = [
  { value: null, label: 'Tutti' },
  { value: 'civile', label: 'Civile' },
  { value: 'penale', label: 'Penale' },
];

const passi = (n: number): string => (n === 1 ? '1 passo' : `${n.toLocaleString('it-IT')} passi`);

/** What the field's words are not, said under it; nothing when they can be sent. */
function fieldProblem(text: string): string | undefined {
  const words = searchWords(text);
  if (words.kind === 'too_many') return `Al massimo ${MAX_WORDS} parole e ${MAX_QUERY_CHARS} caratteri.`;
  if (words.kind === 'none' && text.trim()) return 'Scrivi parole di almeno due lettere o cifre.';
  return undefined;
}

export function RassegneSearchPage() {
  const navigate = useNavigate();
  const triggerSearch = useAppStore((s) => s.triggerSearch);
  const [initial] = useState(rememberedSearch);
  const [text, setText] = useState(initial?.text ?? '');
  const [problem, setProblem] = useState<string | undefined>();
  const [view, setView] = useState<View>(initial ? { kind: 'ready', search: initial, more: 'idle' } : { kind: 'idle' });
  const [lastError, setLastError] = useState<number | undefined>();
  const request = useRef(0);
  const fieldRef = useRef<HTMLInputElement>(null);
  const problemId = useId();
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);
  const pending = useRef<{ text: string; q: string; archivio: Archivio | null } | null>(null);

  useEffect(() => {
    if (!initial) fieldRef.current?.focus();
  }, [initial]);

  // The list as it stands is the one the way back from an article finds.
  useEffect(() => {
    if (view.kind === 'ready') rememberSearch(view.search);
  }, [view]);

  // After «Altri passi», the first passage it brought takes the focus.
  useEffect(() => {
    if (focusIndex.current === null || view.kind !== 'ready') return;
    itemRefs.current[focusIndex.current]?.focus();
    focusIndex.current = null;
  }, [view]);

  const run = useCallback((asked: { text: string; q: string; archivio: Archivio | null }) => {
    const id = ++request.current;
    pending.current = asked;
    setView((prev) => (prev.kind === 'error' ? { kind: 'error', busy: true } : { kind: 'loading' }));
    searchRassegne({ q: asked.q, ...(asked.archivio ? { archivio: asked.archivio } : {}) }).then(
      (data) => {
        if (id !== request.current) return;
        if (data.volumi === 0) {
          rememberSearch(null);
          setView({ kind: 'no_store' });
          return;
        }
        setView({
          kind: 'ready',
          more: 'idle',
          search: { ...asked, total: data.total, archivi: data.archivi, items: data.items, next: data.next_cursor },
        });
      },
      (err: unknown) => {
        if (id !== request.current) return;
        console.error('[rassegne] search failed', { error: failureOf(err) });
        setLastError(err instanceof RassegneError ? err.status : undefined);
        setView({ kind: 'error', busy: false });
      },
    );
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const words = searchWords(text);
    const wrong = fieldProblem(text);
    setProblem(wrong);
    if (words.kind !== 'words') {
      if (!wrong) fieldRef.current?.focus();
      return;
    }
    const archivio = view.kind === 'ready' && view.search.q === words.q ? view.search.archivio : null;
    run({ text, q: words.q, archivio });
  };

  const chooseArchive = (archivio: Archivio | null) => {
    if (view.kind !== 'ready' || view.search.archivio === archivio) return;
    run({ text: view.search.text, q: view.search.q, archivio });
  };

  const loadMore = () => {
    if (view.kind !== 'ready' || !view.search.next || view.more === 'loading') return;
    const { search } = view;
    const id = request.current;
    setView({ kind: 'ready', search, more: 'loading' });
    searchRassegne({ q: search.q, cursor: search.next!, ...(search.archivio ? { archivio: search.archivio } : {}) }).then(
      (data) => {
        if (id !== request.current) return;
        focusIndex.current = search.items.length;
        setView({
          kind: 'ready',
          more: 'idle',
          search: { ...search, items: [...search.items, ...data.items], next: data.next_cursor },
        });
      },
      (err: unknown) => {
        if (id !== request.current) return;
        console.error('[rassegne] next page failed', { error: failureOf(err) });
        setView({ kind: 'ready', search, more: 'failed' });
      },
    );
  };

  const openArticle = useCallback((params: SearchParams) => {
    // The search runs on the reader page: navigate first, as «Analizza documento» does.
    navigate('/');
    triggerSearch(params);
  }, [navigate, triggerSearch]);

  const retry = () => {
    if (pending.current) run(pending.current);
  };

  const ready = view.kind === 'ready' ? view.search : null;
  const counts = new Map((ready?.archivi ?? []).map((a) => [a.archivio, a.passi]));
  const showArchives = ready !== null && (counts.get('civile') ?? 0) > 0 && (counts.get('penale') ?? 0) > 0;
  const allCount = [...counts.values()].reduce((sum, n) => sum + n, 0);

  return (
    <PageFrame title="Rassegne" line="Cerca una o più parole in tutte le rassegne del Massimario della Cassazione.">
      <div className="flex max-w-3xl flex-col gap-5">
        <form role="search" onSubmit={submit} className="flex flex-col gap-1.5">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                ref={fieldRef}
                type="search"
                label="Cerca nelle rassegne"
                icon={<Search size={16} aria-hidden="true" />}
                value={text}
                maxLength={MAX_QUERY_CHARS + 50}
                onChange={(e) => {
                  setText(e.target.value);
                  if (problem) setProblem(fieldProblem(e.target.value));
                }}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? problemId : undefined}
                placeholder="per esempio: danno da perdita di chance"
                enterKeyHint="search"
                autoComplete="off"
              />
            </div>
            <Button type="submit" loading={view.kind === 'loading'}>
              Cerca
            </Button>
          </div>
          {problem && <p id={problemId} className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
        </form>

        <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
          {view.kind === 'idle' && (
            <p className={NOTICE}>
              Ogni parola vale come inizio di parola, senza badare ad accenti e maiuscole; i passi devono contenerle
              tutte. Dal passo puoi aprire gli articoli che cita.
            </p>
          )}
          {view.kind === 'loading' && <p className={NOTICE}>Cerco nelle rassegne…</p>}
          {view.kind === 'no_store' && <p className={NOTICE}>Le rassegne non sono ancora caricate su questa installazione.</p>}
          {view.kind === 'error' && (
            <div className="flex flex-wrap items-center gap-3">
              <p className={NOTICE}>{lastError === 429 ? TOO_MANY : UNAVAILABLE}</p>
              <Button variant="secondary" size="sm" loading={view.busy} onClick={retry}>Riprova</Button>
            </div>
          )}
          {ready && ready.total === 0 && <p className={NOTICE}>Nessun passo contiene tutte queste parole.</p>}
          {ready && ready.total > 0 && (
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{passi(ready.total)}</p>
          )}
        </div>

        {ready && showArchives && (
          <div role="radiogroup" aria-label="Archivio" className="flex flex-wrap gap-2">
            {ARCHIVES.map(({ value, label }) => {
              const checked = ready.archivio === value;
              const count = value ? counts.get(value) ?? 0 : allCount;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => chooseArchive(value)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm ring-1 ring-inset',
                    checked
                      ? 'bg-primary-600 text-white ring-primary-600'
                      : 'text-slate-700 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800',
                    FOCUS_RING,
                    TOUCH_TARGET_RESPONSIVE,
                  )}
                >
                  {label} <span className={checked ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}>{count.toLocaleString('it-IT')}</span>
                </button>
              );
            })}
          </div>
        )}

        {ready && ready.items.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {ready.items.map((passo, i) => (
              <RassegnaResult
                key={passo.id}
                ref={(el) => { itemRefs.current[i] = el; }}
                passo={passo}
                q={ready.q}
                onOpenArticle={openArticle}
              />
            ))}
          </ul>
        )}

        {view.kind === 'ready' && view.more === 'failed' && <p className={NOTICE}>{UNAVAILABLE}</p>}
        {ready?.next && (
          <div>
            <Button variant="secondary" loading={view.kind === 'ready' && view.more === 'loading'} onClick={loadMore}>
              Altri passi
            </Button>
          </div>
        )}
      </div>
    </PageFrame>
  );
}
