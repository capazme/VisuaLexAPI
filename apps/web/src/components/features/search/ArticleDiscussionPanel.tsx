import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, LocateFixed, PenLine, Plus, Send, X } from 'lucide-react';
import { Z_INDEX } from '../../../constants/zIndex';
import type { ArticleDiscussionThread, ThreadPassage } from '../../../types';
import { articleDiscussionService, type DiscussionAnchor } from '../../../services/articleDiscussionService';
import { cn } from '../../../lib/utils';
import { useAuth } from '../../../hooks/useAuth';
import { ReplyForm, ReportButton, VoteButton } from './discussionControls';
import { AlignedGlosses, type GlossAlignment } from './AlignedGlosses';
import { voteFailure } from './voteFailure';
import { Select } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { MATERIA_LABEL } from '../studia/studiaLabels';
import type { Materia } from '../../../types/studia';

interface Props {
  anchor: DiscussionAnchor;
  /** Short name of what is discussed, beside the heading (e.g. «Art. 1453»). */
  label?: string;
  /** The panel's heading; the article's by default. */
  heading?: string;
  /** Shown on a discussion opened on a different text than the one on screen; the article's sentence by default. */
  textChangedNotice?: string;
  /** Said of a passage that is no longer in the text on screen; the article's sentence by default. */
  detachedPassageNotice?: string;
  /** With `withholdDetachedPassage` and no text to check against: why the quotation is not shown. */
  textUnavailableNotice?: string;
  isOpen: boolean;
  onClose: () => void;
  /** Recorded on every new discussion: the URN of what is discussed (none for a decision) and the SHA-256 of the text (projection) on screen. */
  articleUrn?: string;
  textHash?: string | null;
  /** Passage summaries are unavailable because their request failed. */
  passageLoadError?: boolean;
  /** Passage summaries are currently being refreshed. */
  passageThreadsLoading?: boolean;
  /** Retry loading passage summaries. */
  onRetryPassageLoad?: () => void;
  /** Where each passage discussion is in the text on screen (from locatePassage). */
  passageStates?: Record<string, 'exact' | 'moved' | 'detached'>;
  /** A discussion to show expanded and scroll to (from a sign's popover). */
  focusThreadId?: string | null;
  /** The passage discussion shown expanded changed (null: none): its words light up in the text. */
  onFocusThread?: (threadId: string | null) => void;
  /** Words selected with "Discuti": the composer opens on them. */
  draft?: { passage: ThreadPassage } | null;
  /** The composer consumed or dropped the draft. */
  onDraftConsumed?: () => void;
  /** A discussion was created (the host reloads what the signs count). */
  onThreadCreated?: (thread: ArticleDiscussionThread) => void;
  /** Scroll the text to a discussion's passage. */
  onGoToPassage?: (threadId: string) => void;
  /**
   * The caller's policy for a passage that no longer locates in the text on screen:
   * when true, its quotation is withheld from every reader but the thread's author and
   * the admins, until an admin releases it. Off by default: an article keeps showing it.
   */
  withholdDetachedPassage?: boolean;
  /**
   * With `withholdDetachedPassage`: false when the caller has no text to check a passage
   * against (a decision found without its text), so the note does not promise a check.
   */
  passageTextAvailable?: boolean;
  /**
   * `panel` (default): the side view over the page, a dialog (a decision's, until its margin). `margin` (LC74): the
   * article's margin, a region in the page's flow — the host places it beside or under the text; it loads at once, so
   * the count is known before it is opened, and holds no focus and no Esc of the whole page.
   */
  layout?: 'panel' | 'margin';
  /** The number of discussions on the article (`margin`): the «Glosse» button shows it. */
  onCountChange?: (count: number) => void;
  /** `margin` beside the text (LC90): the glosses on a passage at the height of their words. Under the text: a list. */
  align?: GlossAlignment;
  /** The gloss whose passage is lit in the text (chosen here or from the text): marked, and joined to its words. */
  litThreadId?: string | null;
}

/** The replies to a thread, as the Forum counts them (`replyCount`): not the comments under them, nor an emptied one. */
function replyCount(thread: ArticleDiscussionThread) {
  const n = thread.comments.filter(comment => !comment.parentId && !comment.deleted).length;
  return n === 1 ? '1 risposta' : `${n} risposte`;
}

export function ArticleDiscussionPanel({
  anchor: anchorProp,
  label,
  heading = 'Glosse sull’articolo',
  textChangedNotice = 'Il testo dell’articolo è cambiato da quando è stata aperta questa glossa.',
  detachedPassageNotice = 'Il passo discusso non si trova nel testo che stai leggendo.',
  textUnavailableNotice = 'Il passo citato non è mostrato: il testo non è disponibile.',
  isOpen,
  onClose,
  articleUrn,
  textHash,
  passageLoadError = false,
  passageThreadsLoading = false,
  onRetryPassageLoad,
  passageStates,
  focusThreadId,
  onFocusThread,
  draft,
  onDraftConsumed,
  onThreadCreated,
  onGoToPassage,
  withholdDetachedPassage = false,
  passageTextAvailable = true,
  layout = 'panel',
  onCountChange,
  align,
  litThreadId = null,
}: Props) {
  const isMargin = layout === 'margin';
  const marginHeadingId = useId();
  const { isAdmin } = useAuth();
  // Keyed on the fields, not on the object: a caller may build the anchor inline.
  const { normaKey, articleId, articleLabel, version } = anchorProp;
  const anchor = useMemo(
    () => ({ normaKey, articleId, articleLabel, version }),
    [normaKey, articleId, articleLabel, version],
  );
  const [threads, setThreads] = useState<ArticleDiscussionThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sort, setSort] = useState<'recent' | 'active' | 'popular'>('recent');
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [materia, setMateria] = useState<Materia | ''>('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [releasing, setReleasing] = useState<Set<string>>(new Set());

  // Focus tracking state (derive during render when focusThreadId prop changes)
  const [prevFocusThreadId, setPrevFocusThreadId] = useState<string | null | undefined>(undefined);
  if (focusThreadId !== prevFocusThreadId) {
    setPrevFocusThreadId(focusThreadId);
    if (focusThreadId) {
      setExpanded(prev => {
        const next = new Set(prev);
        next.add(focusThreadId);
        return next;
      });
    }
  }

  // Draft tracking state (derive during render when draft changes)
  const [prevDraft, setPrevDraft] = useState<typeof draft>(undefined);
  if (draft !== prevDraft) {
    setPrevDraft(draft);
    if (draft) {
      setComposerOpen(true);
    }
  }

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await articleDiscussionService.list(anchor, sort);
      setThreads(response.data);
      // The list is a page: the count is the server's total.
      setTotal(response.pagination?.total ?? response.data.length);
    } catch {
      setError('Impossibile caricare le glosse. Riprova tra poco.');
    } finally {
      setIsLoading(false);
    }
  }, [anchor, sort]);

  // Fetch only while the panel is shown; the margin at once, for the button's count, and once.
  const fetching = isMargin || isOpen;
  useEffect(() => { if (fetching) void load(); }, [fetching, load]);
  const [total, setTotal] = useState<number | null>(null);
  const reportCount = useRef(onCountChange);
  useEffect(() => { reportCount.current = onCountChange; });
  useEffect(() => { if (total !== null) reportCount.current?.(total); }, [total]);

  // The focus goes into the side view when it opens and back to what opened it when it closes (Esc or «Chiudi»), or,
  // if that is gone (the margin's card redrawn), stays where the page puts it (R-32). Not the margin's: it is in the
  // page, the reader goes into it (the host gives the focus back to its button when it closes from inside).
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!isOpen || isMargin) return undefined;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [isOpen, isMargin]);

  useEffect(() => {
    if (!isOpen || isMargin) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, isMargin]);

  // The margin opened: the focus goes into it, so the keyboard does not cross the whole article to reach it (its slot
  // beside the text comes after it in the page); the composer's field takes it instead when that is what was asked.
  useEffect(() => {
    if (!isMargin || !isOpen || draft) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [isMargin, isOpen, draft]);

  // In the margin a notice («Segnalazione inviata…») is said, then goes by itself.
  useEffect(() => {
    if (!isMargin || !notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [isMargin, notice]);

  // In the margin the composer opens on a request (its line, or «Discuti» on words): the reader goes on writing in it.
  const composerRef = useRef<HTMLFormElement>(null);
  const writeLineRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isMargin || !isOpen || !composerOpen) return;
    composerRef.current?.querySelector<HTMLElement>(draft ? 'textarea' : 'input')?.focus({ preventScroll: true });
  }, [isMargin, isOpen, composerOpen, draft]);

  // In the margin the composer goes with the publication: the focus goes to the gloss published (on a passage, the one
  // chosen, its words lit), not to the page. After the margin's own focus above, which the draft consumed calls again.
  const published = useRef<string | null>(null);
  useEffect(() => {
    const id = published.current;
    const toggle = id ? document.getElementById(`article-thread-${id}`)?.querySelector<HTMLElement>('button') : null;
    if (!toggle) return;
    published.current = null;
    toggle.focus();
  }, [threads]);

  // The gloss the focus is on, in the margin: going from under the text to beside it, the glosses on a passage are drawn
  // again aligned (another list), and the one that had the focus takes it back.
  const focusedCard = useRef<string | null>(null);
  const aligned = !!align;
  useLayoutEffect(() => {
    const id = focusedCard.current;
    const at = document.activeElement;
    if (!id || (at && at !== document.body)) return;
    document.getElementById(id)?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [aligned]);

  // Scroll to focused thread when present in threads list
  useEffect(() => {
    if (!focusThreadId || isLoading) return;
    const found = threads.some(t => t.id === focusThreadId);
    if (found) {
      const el = document.getElementById(`article-thread-${focusThreadId}`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusThreadId, threads, isLoading]);

  const toggleExpand = (thread: ArticleDiscussionThread) => {
    const isCurrentlyExpanded = expanded.has(thread.id);
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(thread.id)) next.delete(thread.id);
      else next.add(thread.id);
      return next;
    });

    if (thread.passage !== null) {
      if (!isCurrentlyExpanded) {
        onFocusThread?.(thread.id);
      } else {
        onFocusThread?.(null);
      }
    }
  };

  const createThread = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft && !title.trim()) return;
    if (!body.trim()) return;

    try {
      const extras = {
        passage: draft?.passage,
        articleUrn,
        textHash: textHash ?? undefined,
        ...(materia ? { materia } : {}),
      };
      const newThread = await articleDiscussionService.create(
        anchor,
        title.trim(),
        body.trim(),
        extras,
      );

      setThreads(prev => [newThread, ...prev]);
      setTotal(prev => (prev ?? 0) + 1);
      setExpanded(prev => {
        const next = new Set(prev);
        next.add(newThread.id);
        return next;
      });
      setTitle('');
      setBody('');
      setMateria('');
      setComposerOpen(false);

      if (draft) {
        onDraftConsumed?.();
      }
      onThreadCreated?.(newThread);
      if (newThread.passage !== null) {
        onFocusThread?.(newThread.id);
      }
      if (isMargin) published.current = newThread.id;
    } catch {
      setError('Impossibile pubblicare la glossa.');
    }
  };

  const cancelComposer = () => {
    setComposerOpen(false);
    setTitle('');
    setBody('');
    if (draft) {
      onDraftConsumed?.();
    }
  };

  const addReply = async (threadId: string, replyBody: string) => {
    try {
      const comment = await articleDiscussionService.comment(threadId, replyBody);
      setThreads(prev => prev.map(thread => thread.id === threadId ? { ...thread, comments: [...thread.comments, comment], updatedAt: comment.createdAt } : thread));
      setReplyingTo(null);
      return true;
    } catch {
      setError('Impossibile pubblicare la risposta.');
      return false;
    }
  };

  const reportThread = async (threadId: string) => {
    try {
      await articleDiscussionService.report(threadId, 'segnalazione');
      setNotice('Segnalazione inviata ai moderatori.');
    } catch {
      setError('Impossibile inviare la segnalazione. Riprova.');
    }
  };

  const voteThread = async (thread: ArticleDiscussionThread) => {
    try {
      const result = await articleDiscussionService.voteThread(thread.id);
      setThreads(prev => prev.map(item => item.id === thread.id ? { ...item, userVoted: result.voted, voteCount: result.voteCount } : item));
    } catch (error) {
      setError(voteFailure(error));
    }
  };

  // Admin only, optimistic: flip `passageReleased` at once, put it back if the server refuses.
  // One request per thread at a time (the button is disabled meanwhile), and what stays is the
  // server's answer.
  const setPassageReleased = async (threadId: string, released: boolean) => {
    if (releasing.has(threadId)) return;
    const patch = (value: boolean) =>
      setThreads(prev => prev.map(item => item.id === threadId ? { ...item, passageReleased: value } : item));
    const busy = (on: boolean) =>
      setReleasing(prev => {
        const next = new Set(prev);
        if (on) next.add(threadId);
        else next.delete(threadId);
        return next;
      });
    busy(true);
    patch(released);
    try {
      const answer = await articleDiscussionService.setPassageReleased(threadId, released);
      patch(answer.passageReleased);
    } catch {
      patch(!released);
      setError('Impossibile aggiornare la visibilità del passo. Riprova.');
    } finally {
      busy(false);
    }
  };

  const voteComment = async (threadId: string, commentId: string) => {
    try {
      const result = await articleDiscussionService.voteComment(commentId);
      setThreads(prev => prev.map(thread => thread.id === threadId ? {
        ...thread,
        comments: thread.comments.map(comment => comment.id === commentId ? { ...comment, userVoted: result.voted, voteCount: result.voteCount } : comment),
      } : thread));
    } catch (error) {
      setError(voteFailure(error));
    }
  };

  if (!isOpen) return null;

  const truncateQuote = (q: string, maxLen = 120) => {
    if (q.length <= maxLen) return q;
    return q.slice(0, maxLen) + '…';
  };

  // The composer, the notices and a discussion's card: the side view's and the margin's.
  const composer = (
        <form onSubmit={createThread} ref={composerRef} className="mb-4 rounded-[8px] border border-primary-200 dark:border-primary-900/50 bg-primary-50/50 dark:bg-primary-950/20 p-4 space-y-3">
          {draft && (
            <div className="rounded-[8px] border border-primary-300 dark:border-primary-800 bg-white/70 dark:bg-slate-900/70 p-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400">
                Glossa sul passo
              </span>
              <p className="mt-1 line-clamp-4 text-xs italic text-slate-700 dark:text-slate-300">
                «{draft.passage.quote}»
              </p>
            </div>
          )}
          <Input
            value={title}
            onChange={event => setTitle(event.target.value)}
            required={!draft}
            minLength={draft ? undefined : 3}
            maxLength={200}
            placeholder={draft ? "Titolo (facoltativo)" : "Titolo della glossa"}
            aria-label={draft ? "Titolo (facoltativo)" : "Titolo della glossa"}
            className="px-3"
          />
          <textarea
            value={body}
            onChange={event => setBody(event.target.value)}
            required
            minLength={3}
            maxLength={10000}
            placeholder="Condividi una domanda o un'osservazione…"
            aria-label="Testo della glossa"
            rows={4}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          {/* Optional: the Forum's Community filters by it (the server keeps it only when sent). */}
          <Select
            aria-label="Materia (facoltativa)"
            value={materia}
            onChange={event => setMateria(event.target.value as Materia | '')}
          >
            <option value="">Materia (facoltativa)</option>
            {(Object.keys(MATERIA_LABEL) as Materia[]).map(key => <option key={key} value={key}>{MATERIA_LABEL[key]}</option>)}
          </Select>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={cancelComposer}>
              Annulla
            </Button>
            <Button type="submit" icon={<Send size={13} aria-hidden />}>
              Pubblica
            </Button>
          </div>
        </form>
  );

  const statuses = (
    <>
      {error && <div role="alert" className="mb-3 rounded-[8px] border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">{error}</div>}
      {passageThreadsLoading && (
        <p role="status" className="mb-3 rounded-[8px] border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Aggiornamento glosse sui passaggi…
        </p>
      )}
      {passageLoadError && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          <span>Impossibile caricare le glosse sui passaggi. I segni potrebbero non mostrarle.</span>
          {onRetryPassageLoad && (
            <Button type="button" variant="link" onClick={onRetryPassageLoad} className="font-semibold text-amber-900 decoration-amber-400 dark:text-amber-200">
              Riprova
            </Button>
          )}
        </div>
      )}
      {passageLoadError && threads.length === 0 && !isLoading && (
        <p className="mb-3 rounded-[8px] border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
          Le glosse non sono disponibili al momento, quindi l’elenco potrebbe essere incompleto.
        </p>
      )}
      {notice && <div role="status" className="mb-3 rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">{notice}</div>}
    </>
  );

  const renderThread = (thread: ArticleDiscussionThread) => {
            const isExpanded = expanded.has(thread.id);
            const passage = thread.passage;
            const isPassage = passage !== null;
            const passageState = isPassage ? passageStates?.[thread.id] : undefined;
            const isDetached = passageState === 'detached';
            const isLocated = passageState === 'exact' || passageState === 'moved';
            const isTextDifferent =
              Boolean(thread.textHash) &&
              Boolean(textHash) &&
              thread.textHash !== textHash;

            // The rule lives here, not in the API: the server still returns the stored
            // quotation to everyone (spec §8.7's stated limit), and this panel withholds it
            // from readers who are neither the author nor an admin, unless an admin released it.
            // The caller decides whether it applies (a decision does, an article does not).
            // Fails closed: until the passage is known to land in the text (loading, reloading,
            // a failed load, a thread missing from the list) it is withheld like a detached one.
            const isPrivileged = thread.isOwner || isAdmin;
            const quoteWithheld = withholdDetachedPassage && isPassage && !isLocated && !isPrivileged && !thread.passageReleased;
            // Unknown = not located and not detached (loading, failed, not in the list, no text).
            const isUnknown = isPassage && !isLocated && !isDetached;
            const canRelease = withholdDetachedPassage && isPassage && !isLocated && isAdmin;
            const shownQuote = passage && !quoteWithheld ? truncateQuote(passage.quote) : null;

            const headingText =
              passage && !thread.title.trim()
                ? (shownQuote !== null
                  ? `«${shownQuote}»`
                  : isDetached ? 'Glossa su un passo non più nel testo' : 'Glossa su un passo')
                : thread.title;

            return (
              <article
                key={thread.id}
                id={`article-thread-${thread.id}`}
                data-lit={isMargin && litThreadId === thread.id ? '' : undefined}
                className={cn(
                  'rounded-[8px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900',
                  isMargin ? 'p-3' : 'p-4',
                  // Its passage lit in the text: the same tint as the words' underline.
                  isMargin && litThreadId === thread.id && 'border-[hsl(var(--primary)/0.55)] dark:border-[hsl(var(--primary)/0.55)]',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* bare-button: the gloss's heading, a whole row that opens it (its title, passage and author). */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(thread)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <h4 className={cn('font-semibold text-slate-900 dark:text-white', isMargin && 'text-sm')}>
                        {headingText}
                      </h4>
                      {passage && thread.title.trim() && shownQuote !== null && (
                        <span className="mt-0.5 block text-xs italic text-slate-600 dark:text-slate-300">
                          Sul passo «{shownQuote}»
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-slate-400">
                        {thread.user.username} · {new Date(thread.createdAt).toLocaleDateString('it-IT')} · {replyCount(thread)}
                      </span>
                    </span>
                    {isExpanded ? <ChevronUp size={16} className="mt-1 shrink-0 text-slate-400" /> : <ChevronDown size={16} className="mt-1 shrink-0 text-slate-400" />}
                  </button>
                  <VoteButton voted={thread.userVoted} count={thread.voteCount} label="Vota glossa" own={thread.isOwner} onVote={() => void voteThread(thread)} />
                </div>

                {(isDetached || (withholdDetachedPassage && isUnknown)) && (
                  <div
                    role="note"
                    className="mt-2 rounded-[8px] border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
                  >
                    {quoteWithheld ? (
                      <p className="font-medium">
                        {isDetached
                          ? detachedPassageNotice
                          : passageTextAvailable
                            ? 'Il passo citato è in verifica: le parole compaiono quando il testo è stato controllato.'
                            : textUnavailableNotice}
                      </p>
                    ) : (
                      <>
                        <p className="font-medium">
                          {isUnknown && !thread.passageReleased
                            ? 'Gli altri lettori non vedono questo passo finché non è ritrovato nel testo.'
                            : detachedPassageNotice}
                        </p>
                        <p className="mt-1 italic">
                          «{thread.passage?.quote}»
                        </p>
                        {withholdDetachedPassage && (
                          <p className="mt-1">
                            {thread.passageReleased
                              ? 'Le parole sono visibili a tutti.'
                              : 'Le parole sono visibili solo all’autore e agli amministratori.'}
                          </p>
                        )}
                      </>
                    )}
                    {canRelease && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="lg"
                        onClick={() => void setPassageReleased(thread.id, !thread.passageReleased)}
                        loading={releasing.has(thread.id)}
                        className="mt-2 border-amber-300 bg-transparent px-3 text-xs font-semibold text-amber-900 hover:border-amber-400 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/30"
                      >
                        {thread.passageReleased ? 'Nascondi di nuovo' : 'Mostra a tutti'}
                      </Button>
                    )}
                  </div>
                )}

                {isTextDifferent && (
                  <div className="mt-2 rounded-[8px] border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                    {textChangedNotice}
                  </div>
                )}

                {isExpanded && (
                  <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                    <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                      {thread.body}
                    </p>
                    <div className="mt-4 space-y-2 pl-3 border-l-2 border-slate-100 dark:border-slate-800">
                      {thread.comments.map(comment => (
                        <div key={comment.id} className="rounded-[8px] bg-slate-50 dark:bg-slate-800/60 p-3">
                          <div className="flex justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{comment.user.username}</span>
                            <VoteButton voted={comment.userVoted} count={comment.voteCount} label={`Vota la risposta di ${comment.user.username}`} own={comment.isOwner} onVote={() => void voteComment(thread.id, comment.id)} />
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{comment.body}</p>
                        </div>
                      ))}
                    </div>
                    <div className={cn('mt-3 flex items-center gap-4 md:gap-2', isMargin && 'flex-wrap gap-y-2')}>
                      <Button type="button" variant="link" onClick={() => setReplyingTo(replyingTo === thread.id ? null : thread.id)}>
                        Rispondi
                      </Button>
                      {/* Never on one's own gloss (LC114): the server knows the author (`isOwner`). */}
                      {!thread.isOwner && <ReportButton label="Segnala la glossa" inline={isMargin} onReport={() => void reportThread(thread.id)} />}
                      {isLocated && onGoToPassage && (
                        <Button type="button" variant="link" onClick={() => onGoToPassage(thread.id)} icon={<LocateFixed size={12} aria-hidden />} className="ml-auto gap-1">
                          Vai al passo
                        </Button>
                      )}
                    </div>
                    {replyingTo === thread.id && (
                      <ReplyForm onSend={replyBody => addReply(thread.id, replyBody)} />
                    )}
                  </div>
                )}
              </article>
            );
  };

  if (isMargin) {
    const whole = threads.filter(thread => thread.passage === null);
    const onPassages = threads.filter(thread => thread.passage !== null);
    // Every row is one step of the opening (the host staggers `[data-gloss-row]`).
    const row = (thread: ArticleDiscussionThread) => <div key={thread.id} data-gloss-row="">{renderThread(thread)}</div>;
    return (
      // In the page's flow, beside or under the text (LC74): no portal, no veil, nothing over the page.
      <section
        ref={panelRef}
        tabIndex={-1}
        aria-labelledby={marginHeadingId}
        data-gloss-margin=""
        className="space-y-3 outline-none"
        onFocus={event => { focusedCard.current = (event.target as HTMLElement).closest('article[id^="article-thread-"]')?.id ?? null; }}
        onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focusedCard.current = null; }}
        onKeyDown={event => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          // Esc in two steps: the composer first (what is written stays), then the margin.
          if (composerOpen && composerRef.current?.contains(event.target as Node)) {
            setComposerOpen(false);
            requestAnimationFrame(() => writeLineRef.current?.focus({ preventScroll: true }));
            return;
          }
          onClose();
        }}
      >
        <div data-gloss-row="" className="flex items-center justify-between gap-2">
          <h3 id={marginHeadingId} className="font-serif text-lg leading-tight text-slate-900 dark:text-white">Glosse</h3>
          <IconButton size="sm" onClick={onClose} aria-label="Chiudi glosse" icon={<X aria-hidden />} className="-mr-2" />
        </div>
          {/* The order, small and in the page (L-73: no menu over it): three words, the chosen one pressed. */}
          <div data-gloss-row="" role="group" aria-label="Ordine delle glosse" className="-ml-1.5 -mt-2 flex flex-wrap items-center">
            {([['recent', 'Recenti'], ['active', 'Attive'], ['popular', 'Più votate']] as const).map(([value, name]) => (
              <Button
                key={value}
                type="button"
                variant="quiet"
                aria-pressed={sort === value}
                onClick={() => setSort(value)}
                className="px-1.5 font-normal text-slate-500 aria-pressed:font-semibold aria-pressed:text-slate-900 dark:text-slate-400 dark:aria-pressed:text-white"
              >
                {name}
              </Button>
            ))}
          </div>
        {/* L-8: the glosses are public; a private remark is a note. */}
        <p data-gloss-row="" className="text-xs text-slate-500 dark:text-slate-400">
          Le glosse sono pubbliche nel Forum: per un appunto privato usa una nota.
        </p>
        <div data-gloss-row="">
          {composerOpen ? composer : (
            // Closed until asked for: one line (Luca, 17-11: less in the way).
            // bare-button: the composer's closed line, drawn as the field it opens into.
            <button
              ref={writeLineRef}
              type="button"
              onClick={() => setComposerOpen(true)}
              className="flex min-h-11 w-full items-center gap-2 rounded-md border border-slate-200 px-3 text-left text-sm text-slate-500 hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-9 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
            >
              <PenLine size={14} aria-hidden /> Scrivi una glossa…
            </button>
          )}
        </div>
        {statuses}
        {isLoading ? (
          <p data-gloss-row="" className="text-sm text-slate-400">Caricamento glosse…</p>
        ) : threads.length === 0 ? (
          passageLoadError || passageThreadsLoading ? null : (
            <p data-gloss-row="" className="text-sm text-slate-500 dark:text-slate-400">Ancora nessuna glossa su quest’articolo</p>
          )
        ) : (
          <>
            {whole.map(row)}
            {onPassages.length > 0 && (
              <h4 data-gloss-row="" className="pt-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Sui passaggi</h4>
            )}
            {align ? (
              <AlignedGlosses threads={onPassages} {...align} litId={litThreadId} render={renderThread} />
            ) : onPassages.map(row)}
          </>
        )}
      </section>
    );
  }

  return createPortal(
    // A side view, not a box over the text (Luca, 15-11: «sarebbe meglio averlo in visualizzazione laterale»): the
    // window's right edge, its whole height, in from the right; the text stays where it is, in sight.
    // In from the right in CSS, on the motion tokens (`--dur-pop`, `--ease-out`): the keyframes end on the panel's own
    // style, so nothing is left to write at the end. Framer's entrance gave the opacity back to 0 for a frame once it
    // finished (Papiniano, #660).
    <section
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="article-discussions-title"
      className={cn(
        'fixed inset-y-0 right-0 flex w-full flex-col overflow-hidden border-l border-slate-200 bg-card shadow-lg outline-none sm:w-[24rem] dark:border-slate-800',
        'animate-in fade-in slide-in-from-right-6 duration-(--dur-pop) ease-(--ease-out)',
        Z_INDEX.structure,
      )}
    >
      <div className="flex-1 overflow-y-auto p-5 sm:p-6">
      {/* The title and its close on one line; the order and «Nuova glossa» under them. */}
      <div className="mb-4 grid gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 id="article-discussions-title" className="inline font-serif text-xl leading-tight text-slate-900 dark:text-white">{heading}</h3>
            {label && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{label}</span>}
          </div>
          <IconButton onClick={onClose} aria-label="Chiudi glosse" icon={<X aria-hidden />} className="-mr-2 -mt-1" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="w-36">
            <Select aria-label="Ordine delle glosse" value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
              <option value="recent">Recenti</option>
              <option value="active">Attive</option>
              <option value="popular">Più votate</option>
            </Select>
          </div>
          <Button type="button" onClick={() => setComposerOpen(value => !value)} icon={<Plus size={14} aria-hidden />}>
            Nuova glossa
          </Button>
        </div>
      </div>

      {composerOpen && composer}

      {statuses}
      {isLoading ? <p className="text-sm text-slate-400">Caricamento glosse…</p> : threads.length === 0 && (passageLoadError || passageThreadsLoading) ? null : threads.length === 0 ? <p className="rounded-[8px] border border-dashed border-slate-200 dark:border-slate-700 p-6 text-center text-sm text-slate-500">Nessuna glossa ancora. Puoi essere il primo a porre una domanda.</p> : (
        <div className="space-y-3">
          {threads.map(renderThread)}
        </div>
      )}
      </div>
    </section>,
    document.body,
  );
}
