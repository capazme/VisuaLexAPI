import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { COMMUNITY_PAGE } from '../../../features/sections/pageNames';
import { PageFrame } from '../../layout/PageFrame';
import { articleDiscussionService } from '../../../services/articleDiscussionService';
import type { CommunityFeedItem, CommunityThread } from '../../../types/community';
import type { Materia } from '../../../types/studia';
import { MATERIA_LABEL, anchorLabel } from '../studia/studiaLabels';
import { AcceptedMark, AuthorName, COMMUNITY_PATH, CommunityThreadView } from './CommunityThreadView';
import { subjectHue } from '../studia/progress/tokens';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The source as it is cited, as the discussion's own link says it (`CommunityTarget`): «art. 2056 c.c.», «Cass. civ., n. …». */
function sourceLabel(item: CommunityFeedItem): string {
  if (item.target.kind === 'decision') return item.decisionLabel ?? 'una sentenza';
  return (item.articleUrn && anchorLabel({ urn: item.articleUrn })) || item.articleLabel || `art. ${item.articleId}`;
}

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
  const navigate = useNavigate();
  const choose = (next: Materia | '') => {
    setMateria(next);
    // A community chosen while a discussion is open goes back to the list, narrowed.
    if (threadId) navigate(COMMUNITY_PATH);
  };

  return (
    <PageFrame title={COMMUNITY_PAGE} kicker="forum" line="Le discussioni della comunità su norme e sentenze">
      {/* LC24, after Reddit's (Luca, 15 November): the list of discussions in the middle, each with its «utile» on the
          left, and the communities by subject beside it from lg; a discussion opens on a page of its own (the path
          says «Community › …»). On a phone the communities are a row of words over the list. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
        <div className="min-w-0">
          <Communities value={materia} onChange={choose} row />
          {threadId ? (
            <section aria-label="Discussione aperta" className="min-w-0">
              <CommunityThreadView key={threadId} threadId={threadId} onChanged={onChanged} />
            </section>
          ) : (
            <section aria-labelledby="community-feed-heading">
              <h2 id="community-feed-heading" className="sr-only">Discussioni</h2>
              {firstLoad && <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Caricamento delle discussioni…</p>}
              {failed && (
                <div role="alert" className="mb-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
                  Impossibile caricare le discussioni.{' '}
                  <button type="button" onClick={() => void load(items.length ? page + 1 : 1)} className={cn('font-semibold underline underline-offset-2', FOCUS_RING)}>Riprova</button>
                </div>
              )}
              {!loading && !failed && items.length === 0 && (
                <div className="py-12 text-center">
                  <p className="font-serif text-[22px] text-slate-900 dark:text-slate-50">{materia ? 'Nessuna discussione in questa materia.' : 'Nessuna discussione ancora.'}</p>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Le discussioni nascono dalle glosse sugli articoli e sulle sentenze.</p>
                </div>
              )}
              {items.length > 0 && (
                <ul aria-labelledby="community-feed-heading" className="border-t border-slate-200 dark:border-slate-800">
                  {items.map(item => <FeedRow key={item.id} item={item} />)}
                </ul>
              )}
              {items.length > 0 && page < pages && !failed && (
                <button
                  type="button"
                  onClick={() => void load(page + 1)}
                  disabled={loading}
                  className={cn('mt-4 min-h-[44px] w-full rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800', FOCUS_RING)}
                >
                  Altre discussioni
                </button>
              )}
            </section>
          )}
        </div>
        <aside aria-label="Comunità" className="hidden lg:block">
          <div className="sticky top-8">
            <Communities value={materia} onChange={choose} />
            <p className="mt-6 border-t border-slate-200 pt-4 text-[13px] leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-400">
              Le discussioni nascono sotto un articolo o una sentenza, dal pannello delle glosse. «Utile» porta in alto le risposte che servono; la risposta accettata dall’autore sta in cima.
            </p>
          </div>
        </aside>
      </div>
    </PageFrame>
  );
}

/** The communities, one per subject (Reddit's, on the Programme's taxonomy): a list beside the feed, a row of words on a phone. */
function Communities({ value, onChange, row = false }: { value: Materia | ''; onChange: (next: Materia | '') => void; row?: boolean }) {
  const all: Array<[Materia | '', string]> = [['', 'Tutte le materie'], ...(Object.keys(MATERIA_LABEL) as Materia[]).map((key) => [key, MATERIA_LABEL[key]] as [Materia, string])];
  return (
    <div role="group" aria-label="Materia" className={row ? '-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden' : 'grid gap-0.5'}>
      {!row && <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Comunità</p>}
      {all.map(([key, label]) => {
        const on = value === key;
        return (
          <button
            key={key || 'tutte'}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(key)}
            className={cn(
              'flex shrink-0 items-center gap-2 whitespace-nowrap text-left text-sm transition-colors',
              row ? 'min-h-[44px] rounded-full border px-4' : 'h-9 rounded-lg px-3',
              on
                ? cn('font-semibold text-slate-900 dark:text-slate-50', row ? 'border-slate-900 bg-ink-300/60 dark:border-slate-200 dark:bg-ink-700/60' : 'bg-ink-300/60 dark:bg-ink-700/60')
                : cn('font-medium text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800', row && 'border-slate-300 dark:border-slate-700'),
              FOCUS_RING,
            )}
          >
            {key && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: subjectHue(key) }} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** A discussion in the list, as Reddit's: its «utile» count on the left, then the subject, the author and the source, the title, the start of its text, the replies. */
function FeedRow({ item }: { item: CommunityFeedItem }) {
  return (
    <li className="border-b border-slate-200 dark:border-slate-800">
      <Link
        to={`${COMMUNITY_PATH}/${encodeURIComponent(item.id)}`}
        className={cn('flex gap-4 rounded-lg px-2 py-4 transition-colors hover:bg-slate-100 dark:hover:bg-slate-900', FOCUS_RING)}
      >
        <span aria-hidden className="flex w-10 shrink-0 flex-col items-center pt-0.5 text-slate-600 dark:text-slate-400">
          <span className="font-serif text-xl leading-none text-slate-900 tabular-nums dark:text-slate-50">{item.voteCount}</span>
          <span className="mt-1 text-[11px]">{item.voteCount === 1 ? 'utile' : 'utili'}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600 dark:text-slate-400">
            {item.materia && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: subjectHue(item.materia) }} />
                {MATERIA_LABEL[item.materia]}
              </span>
            )}
            {item.user.username && <AuthorName name={item.user.username} />}
            <span>su {sourceLabel(item)}</span>
          </span>
          <span className="mt-1 block font-serif text-[19px] leading-snug text-slate-900 dark:text-slate-50">{rowTitle(item)}</span>
          {!item.deleted && item.excerpt && <span className="mt-1 line-clamp-2 block text-sm text-slate-700 dark:text-slate-300">{item.excerpt}</span>}
          <span className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-slate-600 dark:text-slate-400">
            <span>{count(item.replyCount, 'risposta', 'risposte')}</span>
            <span className="sr-only">· {count(item.voteCount, 'voto utile', 'voti utili')}</span>
            {item.acceptedCommentId && <AcceptedMark />}
          </span>
        </span>
      </Link>
    </li>
  );
}
