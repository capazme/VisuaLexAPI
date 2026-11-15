import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { articleDiscussionService } from '../../../services/articleDiscussionService';
import type { CommunityItem, CommunityReply, CommunityThread } from '../../../types/community';
import { MATERIA_LABEL } from '../studia/studiaLabels';
import { ReplyForm, ReportButton, VoteButton } from '../search/discussionControls';
import { CommunityTarget } from './CommunityTarget';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';

export const COMMUNITY_PATH = '/forum/community';

/** A small label: the subject, or a reply's state. `strong`: the dark pill of the accepted reply. */
export function Pill({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', strong
      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
      : 'border border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300')}
    >
      {children}
    </span>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString('it-IT');
const statusOf = (error: unknown) => (error as { status?: number } | null)?.status;

/** What is left of an item its author emptied, or that moderation removed: a place, without the words. */
function itemText(item: CommunityItem) {
  if (item.deleted) return <p className="mt-1 text-sm italic text-slate-500 dark:text-slate-400">Cancellata dall’autore.</p>;
  if (item.removed) return <p className="mt-1 text-sm italic text-slate-500 dark:text-slate-400">Rimossa dalla moderazione.</p>;
  return <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{item.body}</p>;
}

interface Props {
  threadId: string;
  /** The discussion as read again (after a vote, a reply, an acceptance): the feed's row follows it. */
  onChanged: (thread: CommunityThread) => void;
}

/**
 * One discussion of the Community, beside the list on a wide screen and the whole page on a phone: its text, its
 * votes, then the replies in the server's order (the accepted one first, labelled «Risposta accettata»), each with
 * its comments one level under it. Replying, voting and reporting use the controls of the panel under an article;
 * the discussion's author alone accepts a reply (never their own: the server refuses it).
 */
export function CommunityThreadView({ threadId, onChanged }: Props) {
  const [thread, setThread] = useState<CommunityThread | null>(null);
  const [loadError, setLoadError] = useState<'missing' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [commenting, setCommenting] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);

  const read = useCallback(() => articleDiscussionService.get(threadId).then(
    (answer) => ({ answer, failure: null }),
    (err: unknown) => ({ answer: null, failure: statusOf(err) === 404 ? 'missing' as const : 'failed' as const }),
  ), [threadId]);

  const apply = useCallback(({ answer, failure }: Awaited<ReturnType<typeof read>>) => {
    if (answer) {
      setThread(answer);
      onChanged(answer);
    } else setLoadError(failure);
  }, [onChanged]);

  const load = useCallback(async () => apply(await read()), [read, apply]);

  // The first read; `load` reads again after a vote, a reply, an acceptance, or «Riprova».
  useEffect(() => {
    let live = true;
    void read().then(result => { if (live) apply(result); });
    return () => { live = false; };
  }, [read, apply]);

  // Once, as it is first drawn: on a phone the list it came from is gone.
  useEffect(() => {
    if (thread && !focused.current) {
      focused.current = true;
      heading.current?.focus();
    }
  }, [thread]);

  const act = async (run: () => Promise<unknown>, failure: string, reload = true) => {
    setError(null);
    setNotice(null);
    try {
      await run();
      if (reload) await load();
      return true;
    } catch {
      setError(failure);
      return false;
    }
  };

  const back = (
    <Link to={COMMUNITY_PATH} className={cn('mb-4 inline-flex min-h-[44px] items-center gap-1.5 rounded text-sm font-medium text-slate-700 dark:text-slate-300 lg:hidden', FOCUS_RING)}>
      <ArrowLeft size={16} aria-hidden /> Torna alle discussioni
    </Link>
  );

  if (loadError) {
    return (
      <div>
        {back}
        <div role="alert" className="rounded-xl border border-slate-200 p-6 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
          {loadError === 'missing' ? 'Questa discussione non c’è più.' : (
            <>
              Impossibile caricare la discussione.{' '}
              <button type="button" onClick={() => { setLoadError(null); void load(); }} className={cn('font-semibold underline underline-offset-2', FOCUS_RING)}>Riprova</button>
            </>
          )}
        </div>
      </div>
    );
  }
  if (!thread) return <div>{back}<p role="status" className="text-sm text-slate-500 dark:text-slate-400">Caricamento della discussione…</p></div>;

  const vote = () => act(async () => {
    const result = await articleDiscussionService.voteThread(thread.id);
    setThread({ ...thread, userVoted: result.voted, voteCount: result.voteCount });
    onChanged({ ...thread, userVoted: result.voted, voteCount: result.voteCount });
  }, 'Impossibile aggiornare il voto. Riprova.', false);

  const voteReply = (reply: CommunityReply) => act(
    () => articleDiscussionService.voteComment(reply.id), 'Impossibile aggiornare il voto. Riprova.',
  );

  const report = async (run: () => Promise<void>) => {
    if (await act(run, 'Impossibile inviare la segnalazione. Riprova.', false)) setNotice('Segnalazione inviata ai moderatori.');
  };

  const accept = (commentId: string | null) => act(
    () => articleDiscussionService.accept(thread.id, commentId), 'Impossibile aggiornare la risposta accettata. Riprova.',
  );

  const title = thread.deleted ? 'Discussione cancellata dall’autore' : thread.title || (thread.passage ? `«${thread.passage.quote}»` : 'Discussione su un passo');
  const canAccept = (reply: CommunityReply) => thread.isOwner && !thread.deleted && !reply.isOwner && !reply.deleted && !reply.removed && !reply.hidden;
  const visible = (item: CommunityItem) => !item.deleted && !item.removed;

  return (
    <article aria-labelledby="community-thread-title">
      {back}
      <h2 id="community-thread-title" ref={heading} tabIndex={-1} className="font-serif text-2xl font-medium tracking-tight text-slate-900 focus:outline-none dark:text-slate-50">
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {thread.user.username ? `Scritta da ${thread.user.username} · ` : ''}{day(thread.createdAt)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {thread.materia && <Pill>{MATERIA_LABEL[thread.materia]}</Pill>}
        <CommunityTarget {...thread} />
      </div>
      {!thread.deleted && <p className="mt-4 whitespace-pre-wrap text-slate-800 dark:text-slate-200">{thread.body}</p>}
      <div className="mt-4 flex items-center gap-3">
        <VoteButton voted={thread.userVoted} count={thread.voteCount} label="Vota la discussione" onVote={() => void vote()} />
        {!thread.isOwner && !thread.deleted && (
          <ReportButton label="Segnala la discussione" onReport={() => void report(() => articleDiscussionService.report(thread.id, 'segnalazione'))} />
        )}
      </div>

      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">{error}</div>}
      {notice && <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">{notice}</div>}

      <h3 id="community-replies" className="mt-8 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {thread.replyCount === 1 ? '1 risposta' : `${thread.replyCount} risposte`}
      </h3>
      {thread.replies.length > 0 && (
        <ul aria-labelledby="community-replies" className="mt-3 space-y-3">
          {thread.replies.map(reply => (
            <li key={reply.id}>
              <article className={cn('rounded-xl border p-4', reply.accepted ? 'border-slate-400 dark:border-slate-500' : 'border-slate-200 dark:border-slate-800')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{reply.user.username || '—'} · {day(reply.createdAt)}</span>
                  {reply.accepted && <Pill strong>Risposta accettata</Pill>}
                </div>
                {reply.hidden && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Nascosta dalla moderazione.</p>}
                {itemText(reply)}
                {visible(reply) && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <VoteButton voted={reply.userVoted} count={reply.voteCount} label={`Vota la risposta di ${reply.user.username}`} onVote={() => void voteReply(reply)} />
                    {!thread.locked && (
                      <button type="button" onClick={() => setCommenting(commenting === reply.id ? null : reply.id)} aria-expanded={commenting === reply.id} className={cn('rounded text-xs text-primary-700 hover:underline dark:text-primary-300', FOCUS_RING)}>
                        Commenta
                      </button>
                    )}
                    {!reply.isOwner && (
                      <ReportButton label={`Segnala la risposta di ${reply.user.username}`} onReport={() => void report(() => articleDiscussionService.reportComment(reply.id, 'segnalazione'))} />
                    )}
                    {canAccept(reply) && (
                      <button
                        type="button"
                        onClick={() => void accept(reply.accepted ? null : reply.id)}
                        aria-label={reply.accepted ? 'Ritira l’accettazione' : `Accetta la risposta di ${reply.user.username}`}
                        className={cn('ml-auto rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800', FOCUS_RING)}
                      >
                        {reply.accepted ? 'Ritira l’accettazione' : 'Accetta'}
                      </button>
                    )}
                  </div>
                )}
                {reply.comments.length > 0 && (
                  <ul aria-label="Commenti a questa risposta" className="mt-3 space-y-2 border-l-2 border-slate-100 pl-3 dark:border-slate-800">
                    {reply.comments.map(comment => (
                      <li key={comment.id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{comment.user.username || '—'} · {day(comment.createdAt)}</span>
                        {itemText(comment)}
                        {visible(comment) && !comment.isOwner && (
                          <div className="mt-1">
                            <ReportButton label={`Segnala il commento di ${comment.user.username}`} onReport={() => void report(() => articleDiscussionService.reportComment(comment.id, 'segnalazione'))} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {commenting === reply.id && (
                  <ReplyForm
                    placeholder="Scrivi un commento…"
                    sendLabel="Invia commento"
                    onSend={body => act(() => articleDiscussionService.comment(thread.id, body, reply.id), 'Impossibile pubblicare il commento.').then(ok => {
                      if (ok) setCommenting(null);
                      return ok;
                    })}
                  />
                )}
              </article>
            </li>
          ))}
        </ul>
      )}

      {thread.locked
        ? <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">La discussione è chiusa: non si possono aggiungere risposte.</p>
        : <ReplyForm onSend={body => act(() => articleDiscussionService.comment(thread.id, body, undefined), 'Impossibile pubblicare la risposta.')} />}
    </article>
  );
}
