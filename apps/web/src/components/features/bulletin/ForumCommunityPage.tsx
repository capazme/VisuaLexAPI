import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { COMMUNITY_PAGE } from '../../../features/sections/pageNames';
import { PageFrame } from '../../layout/PageFrame';
import { articleDiscussionService } from '../../../services/articleDiscussionService';
import type { CommunityFeedItem, CommunityThread } from '../../../types/community';
import type { Materia } from '../../../types/studia';
import { MATERIA_LABEL } from '../studia/studiaLabels';
import { COMMUNITY_PATH, CommunityThreadView, Pill } from './CommunityThreadView';
import { CommunityTarget } from './CommunityTarget';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function rowTitle(item: CommunityFeedItem) {
  if (item.deleted) return 'Discussione cancellata dall’autore';
  if (item.title) return item.title;
  return item.passage?.quote ? `«${item.passage.quote}»` : 'Discussione su un passo';
}

/**
 * The Forum's «Community» (`/forum/community`, one discussion at `/forum/community/:threadId`): the feed of every
 * discussion on a norm or a decision (`GET /article-discussions/feed`, by last activity), filtered by subject on the
 * server, and the discussion opened beside it from `lg` (two panes), the whole page on a phone. In the sections' frame
 * (`PageFrame`, W2).
 */
export function ForumCommunityPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const [materia, setMateria] = useState<Materia | ''>('');
  const [items, setItems] = useState<CommunityFeedItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (next: number) => {
    setLoading(true);
    setFailed(false);
    try {
      const answer = await articleDiscussionService.feed({ page: next, ...(materia ? { materia } : {}) });
      setItems(prev => (next === 1 ? answer.data : [...prev, ...answer.data.filter(item => !prev.some(p => p.id === item.id))]));
      setPage(answer.pagination.page);
      setPages(answer.pagination.pages);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [materia]);

  useEffect(() => { void load(1); }, [load]);

  // The open discussion, read again, brings its row up to date.
  const onChanged = useCallback((thread: CommunityThread) => {
    setItems(prev => prev.map(item => item.id === thread.id ? {
      ...item,
      voteCount: thread.voteCount,
      userVoted: thread.userVoted,
      replyCount: thread.replyCount,
      acceptedCommentId: thread.acceptedCommentId,
    } : item));
  }, []);

  const firstLoad = loading && items.length === 0;

  return (
    <PageFrame title={COMMUNITY_PAGE} kicker="forum" line="Le discussioni della comunità su norme e sentenze">
      <div className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
        <section aria-labelledby="community-feed-heading" className={cn(threadId && 'hidden lg:block')}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="community-feed-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Discussioni</h2>
            <select
              aria-label="Materia"
              value={materia}
              onChange={event => setMateria(event.target.value as Materia | '')}
              className={cn('min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 md:min-h-0 md:py-1.5', FOCUS_RING)}
            >
              <option value="">Tutte le materie</option>
              {(Object.keys(MATERIA_LABEL) as Materia[]).map(key => <option key={key} value={key}>{MATERIA_LABEL[key]}</option>)}
            </select>
          </div>

          {firstLoad && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Caricamento delle discussioni…</p>}
          {failed && (
            <div role="alert" className="mb-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
              Impossibile caricare le discussioni.{' '}
              <button type="button" onClick={() => void load(items.length ? page + 1 : 1)} className={cn('font-semibold underline underline-offset-2', FOCUS_RING)}>Riprova</button>
            </div>
          )}
          {!loading && !failed && items.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
              <p className="font-medium text-slate-800 dark:text-slate-200">{materia ? 'Nessuna discussione in questa materia.' : 'Nessuna discussione ancora.'}</p>
              <p className="mt-1">Le discussioni nascono dalle glosse sugli articoli e sulle sentenze.</p>
            </div>
          )}

          {items.length > 0 && (
            <ul aria-labelledby="community-feed-heading" className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {items.map(item => {
                const open = item.id === threadId;
                return (
                  <li key={item.id} className={cn('px-4 py-3', open && 'bg-slate-50 dark:bg-slate-800/60')}>
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        to={`${COMMUNITY_PATH}/${encodeURIComponent(item.id)}`}
                        aria-current={open ? 'page' : undefined}
                        className={cn('min-w-0 flex-1 rounded', FOCUS_RING)}
                      >
                        <span className="block font-medium text-slate-900 dark:text-slate-50">{rowTitle(item)}</span>
                        <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                          {item.user.username ? `Scritta da ${item.user.username} · ` : ''}
                          {count(item.replyCount, 'risposta', 'risposte')} · {count(item.voteCount, 'voto', 'voti')}
                        </span>
                      </Link>
                      {item.acceptedCommentId && <Pill strong>Risposta accettata</Pill>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {item.materia && <Pill>{MATERIA_LABEL[item.materia]}</Pill>}
                      <CommunityTarget {...item} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {items.length > 0 && page < pages && !failed && (
            <button
              type="button"
              onClick={() => void load(page + 1)}
              disabled={loading}
              className={cn('mt-3 min-h-[44px] w-full rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800', FOCUS_RING)}
            >
              Altre discussioni
            </button>
          )}
        </section>

        {threadId ? (
          <section aria-label="Discussione aperta" className="min-w-0">
            <CommunityThreadView key={threadId} threadId={threadId} onChanged={onChanged} />
          </section>
        ) : (
          <p className="hidden self-start rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400 lg:block">
            Scegli una discussione per leggerla.
          </p>
        )}
      </div>
    </PageFrame>
  );
}
