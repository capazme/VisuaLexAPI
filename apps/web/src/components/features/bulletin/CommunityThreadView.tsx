import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { articleDiscussionService } from '../../../services/articleDiscussionService';
import type { CommunityItem, CommunityReply, CommunityThread } from '../../../types/community';
import { MATERIA_LABEL } from '../studia/studiaLabels';
import { ReplyForm, ReportButton, VoteButton } from '../search/discussionControls';
import { voteFailure } from '../search/voteFailure';
import { CommunityTarget } from './CommunityTarget';
import { FOCUS_RING } from '../../../constants/interactions';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { WireConfirm } from '../../ui/wireConfirm/WireConfirm';
import { getErrorMessage } from '../../../utils/errors';
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

const day = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

/** The author as the Forum shows a person (LC24, after LinkedIn's): an initial in a stone disc and the name. No
 *  qualification yet: the server does not send one (PRO-10). */
export function AuthorName({ name, when }: { name: string; when?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink-300 text-[11px] font-semibold uppercase text-slate-800 dark:bg-ink-700 dark:text-slate-100">
        {name.charAt(0)}
      </span>
      <span className="font-medium text-slate-800 dark:text-slate-200">{name}</span>
      {when && <span className="text-slate-600 dark:text-slate-400">· {when}</span>}
    </span>
  );
}

/** «Risposta accettata», in the states' green: the one functional colour of a discussion. */
export function AcceptedMark() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
      <Check size={12} strokeWidth={3} aria-hidden /> Risposta accettata
    </span>
  );
}
const statusOf = (error: unknown) => (error as { status?: number } | null)?.status;

/** What is left of an item its author emptied, or that moderation removed: a place, without the words. */
function itemText(item: CommunityItem) {
  if (item.deleted) return <p className="mt-1 text-sm italic text-slate-500 dark:text-slate-400">Cancellata dall’autore.</p>;
  if (item.removed) return <p className="mt-1 text-sm italic text-slate-500 dark:text-slate-400">Rimossa dalla moderazione.</p>;
  return <p className="mt-1.5 max-w-measure whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800 dark:text-slate-200">{item.body}</p>;
}

/**
 * The author's edit, in the item's place (LC114): the discussion's title and text, or a reply's or a comment's text.
 * The text takes the focus: the author asked to write. `onSave` resolves true once saved.
 */
function EditItem({ title, body, label, onSave, onCancel }: {
  title?: string;
  body: string;
  label: string;
  onSave: (edit: { title?: string; body: string }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [nextTitle, setNextTitle] = useState(title ?? '');
  const [nextBody, setNextBody] = useState(body);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await onSave({ ...(title !== undefined ? { title: nextTitle.trim() } : {}), body: nextBody.trim() });
    if (!ok) setSaving(false);
  };
  return (
    <form aria-label={label} onSubmit={(event) => void save(event)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }} className="mt-2 grid max-w-measure gap-3">
      {title !== undefined && <Input label="Titolo" value={nextTitle} onChange={(event) => setNextTitle(event.target.value)} maxLength={200} />}
      <Textarea ref={field} label="Testo" value={nextBody} onChange={(event) => setNextBody(event.target.value)} rows={4} required />
      <div className="flex justify-end gap-3">
        <Button type="button" variant="quiet" onClick={onCancel} disabled={saving}>Annulla</Button>
        <Button type="submit" loading={saving} disabled={!nextBody.trim()}>Salva</Button>
      </div>
    </form>
  );
}

/** «Modifica» and «Elimina», the author's own commands on what they wrote (LC114); never on another's. */
function OwnCommands({ what, onEdit, onDelete }: { what: string; onEdit: () => void; onDelete: (from: HTMLElement) => void }) {
  return (
    <>
      <Button type="button" variant="link" onClick={onEdit} aria-label={`Modifica ${what}`} className="text-xs">Modifica</Button>
      <Button type="button" variant="link" onClick={(event) => onDelete(event.currentTarget)} aria-label={`Elimina ${what}`} className="text-xs">Elimina</Button>
    </>
  );
}

interface Props {
  threadId: string;
  /** The discussion as read again (after a vote, a reply, an acceptance): the feed's row follows it. */
  onChanged: (thread: CommunityThread) => void;
  /** The author deleted the discussion and nothing of it stays: the feed drops its row and goes back to the list. */
  onDeleted?: (threadId: string) => void;
}

/**
 * One discussion of the Community, beside the list on a wide screen and the whole page on a phone: its text, its
 * votes, then the replies in the server's order (the accepted one first, labelled «Risposta accettata»), each with
 * its comments one level under it. Replying, voting and reporting use the controls of the panel under an article;
 * the discussion's author alone accepts a reply (never their own: the server refuses it).
 */
export function CommunityThreadView({ threadId, onChanged, onDeleted }: Props) {
  const [thread, setThread] = useState<CommunityThread | null>(null);
  const [loadError, setLoadError] = useState<'missing' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [commenting, setCommenting] = useState<string | null>(null);
  // The item being edited in its place (the discussion's id, or a reply's or a comment's).
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'thread' | 'comment'; id: string; what: string; from: HTMLElement } | null>(null);
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

  const act = async (run: () => Promise<unknown>, failure: string | ((error: unknown) => string), reload = true) => {
    setError(null);
    setNotice(null);
    try {
      await run();
      if (reload) await load();
      return true;
    } catch (error) {
      setError(typeof failure === 'string' ? failure : failure(error));
      return false;
    }
  };

  const back = (
    <Link to={COMMUNITY_PATH} className={cn('mb-4 inline-flex min-h-[44px] items-center gap-1.5 rounded text-sm font-medium text-slate-700 dark:text-slate-300', FOCUS_RING)}>
      <ArrowLeft size={16} aria-hidden /> Torna alle discussioni
    </Link>
  );

  if (loadError) {
    return (
      <div>
        {back}
        <div role="alert" className="rounded-[8px] border border-slate-200 p-6 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
          {loadError === 'missing' ? 'Questa discussione non c’è più.' : (
            <>
              Impossibile caricare la discussione.{' '}
              <Button type="button" variant="link" onClick={() => { setLoadError(null); void load(); }} className="font-semibold">Riprova</Button>
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
  }, voteFailure, false);

  const voteReply = (reply: CommunityReply) => act(
    () => articleDiscussionService.voteComment(reply.id), voteFailure,
  );

  const report = async (run: () => Promise<void>) => {
    if (await act(run, 'Impossibile inviare la segnalazione. Riprova.', false)) setNotice('Segnalazione inviata ai moderatori.');
  };

  const accept = (commentId: string | null) => act(
    () => articleDiscussionService.accept(thread.id, commentId), 'Impossibile aggiornare la risposta accettata. Riprova.',
  );

  // The server's words on a refusal (a text too short, the day's limit), else ours.
  const saved = (run: () => Promise<unknown>) => act(run, (failure) => getErrorMessage(failure) || 'Impossibile salvare la modifica. Riprova.').then((ok) => {
    if (ok) setEditing(null);
    return ok;
  });

  const remove = async (target: typeof deleting) => {
    if (!target) return;
    const { kind, id } = target;
    setDeleting(null);
    setError(null);
    setNotice(null);
    try {
      const { outcome } = kind === 'thread' ? await articleDiscussionService.deleteThread(id) : await articleDiscussionService.deleteComment(id);
      // Nothing of the discussion stays: back to the list, its row gone. Emptied, its place stays: read it again.
      if (kind === 'thread' && outcome === 'deleted') onDeleted?.(id);
      else await load();
    } catch (failure) {
      setError(getErrorMessage(failure) || 'Impossibile eliminare. Riprova.');
    }
  };

  const title = thread.deleted ? 'Discussione cancellata dall’autore' : thread.title || (thread.passage ? `«${thread.passage.quote}»` : 'Discussione su un passo');
  const canAccept = (reply: CommunityReply) => thread.isOwner && !thread.deleted && !reply.isOwner && !reply.deleted && !reply.removed && !reply.hidden;
  const visible = (item: CommunityItem) => !item.deleted && !item.removed;

  return (
    <article aria-labelledby="community-thread-title">
      {back}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-600 dark:text-slate-400">
        {thread.materia && <span className="font-semibold text-slate-800 dark:text-slate-200">{MATERIA_LABEL[thread.materia]}</span>}
        {thread.user.username ? <AuthorName name={thread.user.username} when={day(thread.createdAt)} /> : <span>{day(thread.createdAt)}</span>}
      </div>
      <h2 id="community-thread-title" ref={heading} tabIndex={-1} className="mt-2 font-serif text-[28px] font-normal leading-tight text-slate-900 focus:outline-none dark:text-slate-50">
        {title}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <CommunityTarget {...thread} />
      </div>
      {editing === thread.id ? (
        <EditItem
          label="Modifica la discussione"
          title={thread.title}
          body={thread.body}
          onCancel={() => setEditing(null)}
          onSave={(edit) => saved(() => articleDiscussionService.editThread(thread.id, edit))}
        />
      ) : !thread.deleted && <p className="mt-4 max-w-measure whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800 dark:text-slate-200">{thread.body}</p>}
      <div className="mt-4 flex items-center gap-4 border-b border-slate-200 pb-4 md:gap-3 dark:border-slate-800">
        {/* One's own discussion: its count only, no «Segnala» (G-476); «Modifica» and «Elimina» instead (LC114). */}
        <VoteButton voted={thread.userVoted} count={thread.voteCount} label="Vota la discussione" own={thread.isOwner} onVote={() => void vote()} />
        {!thread.isOwner && !thread.deleted && (
          <ReportButton label="Segnala la discussione" onReport={() => void report(() => articleDiscussionService.report(thread.id, 'segnalazione'))} />
        )}
        {thread.isOwner && !thread.deleted && editing !== thread.id && (
          <OwnCommands what="la discussione" onEdit={() => setEditing(thread.id)} onDelete={(from) => setDeleting({ kind: 'thread', id: thread.id, what: 'la discussione', from })} />
        )}
      </div>

      {error && <div role="alert" className="mt-4 rounded-[8px] border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">{error}</div>}
      {notice && <div role="status" className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">{notice}</div>}

      <h3 id="community-replies" className="mt-6 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">
        {thread.replyCount === 1 ? '1 risposta' : `${thread.replyCount} risposte`}
      </h3>
      {thread.replies.length > 0 && (
        <ul aria-labelledby="community-replies" className="mt-2 divide-y divide-slate-200 dark:divide-slate-800">
          {thread.replies.map(reply => (
            <li key={reply.id}>
              {/* A reply as a row, not a card (LC24); «Risposta accettata» says the accepted one (no green edge besides it). */}
              <article className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <AuthorName name={reply.user.username || 'utente senza nome'} when={day(reply.createdAt)} />
                  {reply.accepted && <AcceptedMark />}
                </div>
                {reply.hidden && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Nascosta dalla moderazione.</p>}
                {editing === reply.id ? (
                  <EditItem
                    label="Modifica la tua risposta"
                    body={reply.body}
                    onCancel={() => setEditing(null)}
                    onSave={({ body }) => saved(() => articleDiscussionService.editComment(reply.id, body))}
                  />
                ) : itemText(reply)}
                {visible(reply) && editing !== reply.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-4 md:gap-3">
                    <VoteButton voted={reply.userVoted} count={reply.voteCount} label={`Vota la risposta di ${reply.user.username}`} own={reply.isOwner} onVote={() => void voteReply(reply)} />
                    {!thread.locked && (
                      // LC113: the common link, 36 px on a computer and 44 on a phone (it was 16 from md).
                      <Button type="button" variant="link" onClick={() => setCommenting(commenting === reply.id ? null : reply.id)} aria-expanded={commenting === reply.id} aria-label={`Commenta la risposta di ${reply.user.username}`} className="text-xs">
                        Commenta
                      </Button>
                    )}
                    {!reply.isOwner && (
                      <ReportButton label={`Segnala la risposta di ${reply.user.username}`} onReport={() => void report(() => articleDiscussionService.reportComment(reply.id, 'segnalazione'))} />
                    )}
                    {reply.isOwner && (
                      <OwnCommands what="la tua risposta" onEdit={() => setEditing(reply.id)} onDelete={(from) => setDeleting({ kind: 'comment', id: reply.id, what: 'la tua risposta', from })} />
                    )}
                    {canAccept(reply) && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void accept(reply.accepted ? null : reply.id)}
                        aria-label={reply.accepted ? 'Ritira l’accettazione' : `Accetta la risposta di ${reply.user.username}`}
                        className="ml-auto px-3 text-xs"
                      >
                        {reply.accepted ? 'Ritira l’accettazione' : 'Accetta'}
                      </Button>
                    )}
                  </div>
                )}
                {reply.comments.length > 0 && (
                  <ul aria-label="Commenti a questa risposta" className="mt-3 space-y-3 border-l border-slate-300 pl-4 dark:border-slate-700">
                    {reply.comments.map(comment => (
                      <li key={comment.id}>
                        <span className="text-[13px]"><AuthorName name={comment.user.username || 'utente senza nome'} when={day(comment.createdAt)} /></span>
                        {editing === comment.id ? (
                          <EditItem
                            label="Modifica il tuo commento"
                            body={comment.body}
                            onCancel={() => setEditing(null)}
                            onSave={({ body }) => saved(() => articleDiscussionService.editComment(comment.id, body))}
                          />
                        ) : itemText(comment)}
                        {visible(comment) && editing !== comment.id && (
                          <div className="mt-1 flex flex-wrap items-center gap-4 md:gap-3">
                            {comment.isOwner
                              ? <OwnCommands what="il tuo commento" onEdit={() => setEditing(comment.id)} onDelete={(from) => setDeleting({ kind: 'comment', id: comment.id, what: 'il tuo commento', from })} />
                              : <ReportButton label={`Segnala il commento di ${comment.user.username}`} onReport={() => void report(() => articleDiscussionService.reportComment(comment.id, 'segnalazione'))} />}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {commenting === reply.id && (
                  <ReplyForm
                    focusOnOpen
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

      <WireConfirm
        open={deleting !== null}
        origin={deleting?.from ?? null}
        variant="danger"
        title={deleting ? `Eliminare ${deleting.what}?` : 'Eliminare?'}
        message="Se altri hanno risposto, resta il posto con «Cancellata dall’autore» e le loro risposte restano; altrimenti sparisce. Il testo non si recupera."
        confirmLabel="Elimina"
        onConfirm={() => remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </article>
  );
}
