import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { articleDiscussionService } from '../../../services/articleDiscussionService';
import { useAppStore } from '../../../store/useAppStore';
import { formatTimestampLong } from '../dossier/dossierUtils';
import { glossaDestination, glossaTargetLabel } from './glossaLinks';
import type { GlossaFeedItem, GlossaFeedSort } from '../../../types';

// A skeleton (spec 2026-10-19-glosse-forum): the feed, its orders and the way into the text.
// The look and the experience are Inchiostro's to design; keep the logic here and in glossaLinks.

const SORTS: { value: GlossaFeedSort; label: string }[] = [
  { value: 'recent', label: 'Più recenti' },
  { value: 'popular', label: 'Più votate' },
  { value: 'active', label: 'Più attive' },
  { value: 'unanswered', label: 'Senza risposta' },
];

const KINDS: { value: 'all' | 'article' | 'decision'; label: string }[] = [
  { value: 'all', label: 'Tutte' },
  { value: 'article', label: 'Sugli articoli' },
  { value: 'decision', label: 'Sulle decisioni' },
];

// A court is a prefix of the decision's key (the server's `court`): the whole court, or one archive.
const COURTS: { value: string; label: string }[] = [
  { value: '', label: 'Tutte le corti' },
  { value: 'cassazione', label: 'Cassazione' },
  { value: 'cassazione:civile', label: 'Cassazione civile' },
  { value: 'cassazione:penale', label: 'Cassazione penale' },
  { value: 'corte_costituzionale', label: 'Corte costituzionale' },
  { value: 'corte_giustizia_ue', label: 'Corte di giustizia UE' },
  { value: 'tribunale_ue', label: 'Tribunale UE' },
  { value: 'consiglio_di_stato', label: 'Consiglio di Stato' },
  { value: 'cgars', label: 'C.G.A.R.S.' },
  { value: 'tar', label: 'TAR' },
];

type FeedAnswer =
  | { key: string; status: 'error'; message: string }
  | { key: string; status: 'success'; items: GlossaFeedItem[]; page: number; pages: number; total: number };

export function ForumGlosseView() {
  const [sort, setSort] = useState<GlossaFeedSort>('recent');
  const [kind, setKind] = useState<'all' | 'article' | 'decision'>('all');
  const [court, setCourt] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<FeedAnswer | null>(null);
  const navigate = useNavigate();
  const triggerSearch = useAppStore((s) => s.triggerSearch);

  // The answer is kept with the query it answers: until the current one's arrives the view is
  // loading, and an answer to an older query never shows.
  const key = `${sort}|${kind}|${court}|${mine}|${page}|${attempt}`;
  useEffect(() => {
    let live = true;
    articleDiscussionService.feed({
      sort, page, kind: kind === 'all' ? undefined : kind, court: court || undefined, mine: mine || undefined,
    })
      .then((res) => {
        if (live) setAnswer({ key, status: 'success', items: res.data, page: res.pagination.page, pages: res.pagination.pages, total: res.pagination.total });
      })
      .catch((error: unknown) => {
        console.error('[ForumGlosseView] feed failed', error);
        if (live) setAnswer({ key, status: 'error', message: error instanceof Error ? error.message : 'Errore nel caricamento delle glosse' });
      });
    return () => { live = false; };
  }, [key, sort, kind, court, mine, page]);
  const state = answer && answer.key === key ? answer : { status: 'loading' as const };

  const open = (item: GlossaFeedItem) => {
    const destination = glossaDestination(item);
    if (!destination) return;
    if (destination.kind === 'decision') {
      navigate(destination.path);
      return;
    }
    navigate('/');
    triggerSearch(destination.params);
  };

  return (
    <section aria-labelledby="forum-glosse-heading" className="space-y-4">
      <h2 id="forum-glosse-heading" className="text-lg font-semibold">Glosse</h2>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          Ordina
          <select value={sort} onChange={(e) => { setSort(e.target.value as GlossaFeedSort); setPage(1); }} className="min-h-[44px] rounded border px-2 md:min-h-0">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Mostra
          <select
            value={kind}
            onChange={(e) => {
              const next = e.target.value as typeof kind;
              setKind(next);
              // a court has glosse on decisions only: the server refuses the two together
              if (next === 'article') setCourt('');
              setPage(1);
            }}
            className="min-h-[44px] rounded border px-2 md:min-h-0"
          >
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Corte
          <select
            value={court}
            onChange={(e) => {
              setCourt(e.target.value);
              if (e.target.value) setKind('decision');
              setPage(1);
            }}
            className="min-h-[44px] rounded border px-2 md:min-h-0"
          >
            {COURTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm md:min-h-0">
          <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} />
          Solo le mie glosse
        </label>
      </div>

      {state.status === 'loading' && <p role="status">Carico le glosse…</p>}
      {state.status === 'error' && (
        <div role="alert" className="space-y-2">
          <p>{state.message}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="min-h-[44px] rounded border px-3 md:min-h-0">Riprova</button>
        </div>
      )}
      {state.status === 'success' && state.items.length === 0 && <p>Nessuna glossa.</p>}
      {state.status === 'success' && state.items.length > 0 && (
        <>
          <ul className="space-y-3">
            {state.items.map((item) => {
              const destination = glossaDestination(item);
              return (
                <li key={item.id} className="space-y-1 rounded border p-3">
                  <p className="text-sm">{glossaTargetLabel(item)}</p>
                  {item.title && <h3 className="font-semibold">{item.title}</h3>}
                  {item.passage && (item.passage.quote !== null
                    ? <blockquote className="border-l-2 pl-2 italic">«{item.passage.quote}»</blockquote>
                    : <p className="text-sm italic">Il passo citato si legge nel testo della decisione.</p>)}
                  <p>{item.excerpt}</p>
                  <p className="text-sm">
                    @{item.user.username} · {item.voteCount} voti · {item.commentCount} risposte · ultima attività {formatTimestampLong(item.lastActivityAt)}
                  </p>
                  {destination
                    ? <button type="button" onClick={() => open(item)} className="min-h-[44px] rounded border px-3 md:min-h-0">Apri nel testo</button>
                    : <p className="text-sm">Questa glossa non registra l’indirizzo dell’articolo.</p>}
                </li>
              );
            })}
          </ul>
          <nav aria-label="Pagine delle glosse" className="flex items-center gap-3">
            <button type="button" disabled={state.page <= 1} onClick={() => setPage(state.page - 1)} className="min-h-[44px] rounded border px-3 md:min-h-0">Precedenti</button>
            <span className="text-sm">Pagina {state.page} di {state.pages} · {state.total} glosse</span>
            <button type="button" disabled={state.page >= state.pages} onClick={() => setPage(state.page + 1)} className="min-h-[44px] rounded border px-3 md:min-h-0">Successive</button>
          </nav>
        </>
      )}
    </section>
  );
}
