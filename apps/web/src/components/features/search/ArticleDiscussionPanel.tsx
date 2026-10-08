import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronDown, ChevronUp, LocateFixed, MessageCircle, Plus, Send, ThumbsUp, X } from 'lucide-react';
import { Z_INDEX } from '../../../constants/zIndex';
import type { ArticleDiscussionThread, ThreadPassage } from '../../../types';
import { articleDiscussionService, type DiscussionAnchor } from '../../../services/articleDiscussionService';
import { cn } from '../../../lib/utils';

interface Props {
  anchor: DiscussionAnchor;
  /** Short name of what is discussed, beside the heading (e.g. «Art. 1453»). */
  label?: string;
  /** The panel's heading; the article's by default. */
  heading?: string;
  /** Shown on a discussion opened on a different text than the one on screen; the article's sentence by default. */
  textChangedNotice?: string;
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
}

export function ArticleDiscussionPanel({
  anchor: anchorProp,
  label,
  heading = 'Discussioni sull’articolo',
  textChangedNotice = 'Il testo dell’articolo è cambiato da quando è stata aperta questa discussione.',
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
}: Props) {
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
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
    } catch {
      setError('Impossibile caricare le discussioni. Riprova tra poco.');
    } finally {
      setIsLoading(false);
    }
  }, [anchor, sort]);

  // Fetch only while the panel is shown.
  useEffect(() => { if (isOpen) void load(); }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

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
      };
      const newThread = await articleDiscussionService.create(
        anchor,
        title.trim(),
        body.trim(),
        extras,
      );

      setThreads(prev => [newThread, ...prev]);
      setExpanded(prev => {
        const next = new Set(prev);
        next.add(newThread.id);
        return next;
      });
      setTitle('');
      setBody('');
      setComposerOpen(false);

      if (draft) {
        onDraftConsumed?.();
      }
      onThreadCreated?.(newThread);
      if (newThread.passage !== null) {
        onFocusThread?.(newThread.id);
      }
    } catch {
      setError('Impossibile pubblicare la discussione.');
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

  const addReply = async (event: React.FormEvent, threadId: string) => {
    event.preventDefault();
    if (!replyBody.trim()) return;
    try {
      const comment = await articleDiscussionService.comment(threadId, replyBody.trim());
      setThreads(prev => prev.map(thread => thread.id === threadId ? { ...thread, comments: [...thread.comments, comment], updatedAt: comment.createdAt } : thread));
      setReplyBody('');
      setReplyingTo(null);
    } catch {
      setError('Impossibile pubblicare la risposta.');
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
    } catch {
      setError('Impossibile aggiornare il voto. Riprova.');
    }
  };

  const voteComment = async (threadId: string, commentId: string) => {
    try {
      const result = await articleDiscussionService.voteComment(commentId);
      setThreads(prev => prev.map(thread => thread.id === threadId ? {
        ...thread,
        comments: thread.comments.map(comment => comment.id === commentId ? { ...comment, userVoted: result.voted, voteCount: result.voteCount } : comment),
      } : thread));
    } catch {
      setError('Impossibile aggiornare il voto. Riprova.');
    }
  };

  if (!isOpen) return null;

  const truncateQuote = (q: string, maxLen = 120) => {
    if (q.length <= maxLen) return q;
    return q.slice(0, maxLen) + '…';
  };

  return createPortal(
    <motion.section
      drag
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.96, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="article-discussions-title"
      className={cn('fixed right-4 top-20 flex w-[min(36rem,calc(100vw-2rem))] max-h-[75vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900', Z_INDEX.structure)}
    >
      <div className="flex-1 overflow-y-auto p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <MessageCircle size={18} className="text-primary-500" />
          <h3 id="article-discussions-title" className="font-semibold text-slate-900 dark:text-white">{heading}</h3>
          {label && <span className="text-xs text-slate-400">{label}</span>}
        </div>
        <div className="flex items-center gap-2">
          <select value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5">
            <option value="recent">Recenti</option>
            <option value="active">Attive</option>
            <option value="popular">Più votate</option>
          </select>
          <button type="button" onClick={() => setComposerOpen(value => !value)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700">
            <Plus size={14} /> Nuova discussione
          </button>
          <button type="button" onClick={onClose} aria-label="Chiudi discussioni" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>
      </div>

      {composerOpen && (
        <form onSubmit={createThread} className="mb-4 rounded-xl border border-primary-200 dark:border-primary-900/50 bg-primary-50/50 dark:bg-primary-950/20 p-4 space-y-3">
          {draft && (
            <div className="rounded-lg border border-primary-300 dark:border-primary-800 bg-white/70 dark:bg-slate-900/70 p-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400">
                Discussione sul passo
              </span>
              <p className="mt-1 line-clamp-4 text-xs italic text-slate-700 dark:text-slate-300">
                «{draft.passage.quote}»
              </p>
            </div>
          )}
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            required={!draft}
            minLength={draft ? undefined : 3}
            maxLength={200}
            placeholder={draft ? "Titolo (facoltativo)" : "Titolo della discussione"}
            aria-label={draft ? "Titolo (facoltativo)" : "Titolo della discussione"}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          <textarea
            value={body}
            onChange={event => setBody(event.target.value)}
            required
            minLength={3}
            maxLength={10000}
            placeholder="Condividi una domanda o un'osservazione..."
            aria-label="Testo della discussione"
            rows={4}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancelComposer} className="px-3 py-1.5 text-xs text-slate-500">
              Annulla
            </button>
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white">
              <Send size={13} /> Pubblica
            </button>
          </div>
        </form>
      )}

      {error && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">{error}</div>}
      {passageThreadsLoading && (
        <p role="status" className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Aggiornamento discussioni sui passaggi…
        </p>
      )}
      {passageLoadError && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          <span>Impossibile caricare le discussioni sui passaggi. I segni potrebbero non mostrarle.</span>
          {onRetryPassageLoad && (
            <button type="button" onClick={onRetryPassageLoad} className="font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              Riprova
            </button>
          )}
        </div>
      )}
      {passageLoadError && threads.length === 0 && !isLoading && (
        <p className="mb-3 rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
          Le discussioni non sono disponibili al momento, quindi l’elenco potrebbe essere incompleto.
        </p>
      )}
      {notice && <div role="status" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">{notice}</div>}
      {isLoading ? <p className="text-sm text-slate-400">Caricamento discussioni…</p> : threads.length === 0 && (passageLoadError || passageThreadsLoading) ? null : threads.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-6 text-center text-sm text-slate-500">Nessuna discussione ancora. Puoi essere il primo a porre una domanda.</p> : (
        <div className="space-y-3">
          {threads.map(thread => {
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

            const headingText =
              passage && !thread.title.trim()
                ? `«${truncateQuote(passage.quote)}»`
                : thread.title;

            return (
              <article
                key={thread.id}
                id={`article-thread-${thread.id}`}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(thread)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <h4 className="font-semibold text-slate-900 dark:text-white">
                        {headingText}
                      </h4>
                      {passage && thread.title.trim() && (
                        <span className="mt-0.5 block text-xs italic text-slate-600 dark:text-slate-300">
                          Sul passo «{truncateQuote(passage.quote)}»
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-slate-400">
                        {thread.user.username} · {new Date(thread.createdAt).toLocaleDateString('it-IT')} · {thread.comments.length} risposte
                      </span>
                    </span>
                    {isExpanded ? <ChevronUp size={16} className="mt-1 shrink-0 text-slate-400" /> : <ChevronDown size={16} className="mt-1 shrink-0 text-slate-400" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void voteThread(thread)}
                    aria-label="Vota discussione"
                    className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs', thread.userVoted ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800')}
                  >
                    <ThumbsUp size={13} /> {thread.voteCount}
                  </button>
                </div>

                {isDetached && (
                  <div
                    role="note"
                    className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
                  >
                    <p className="font-medium">
                      Il passo discusso non si trova nel testo che stai leggendo.
                    </p>
                    <p className="mt-1 italic">
                      «{thread.passage?.quote}»
                    </p>
                  </div>
                )}

                {isTextDifferent && (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
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
                        <div key={comment.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
                          <div className="flex justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{comment.user.username}</span>
                            <button type="button" onClick={() => void voteComment(thread.id, comment.id)} className={cn('inline-flex items-center gap-1 text-xs', comment.userVoted ? 'text-primary-600' : 'text-slate-400')}>
                              <ThumbsUp size={12} /> {comment.voteCount}
                            </button>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{comment.body}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button type="button" onClick={() => setReplyingTo(replyingTo === thread.id ? null : thread.id)} className="text-xs text-primary-600 hover:underline">
                        Rispondi
                      </button>
                      <button type="button" onClick={() => void reportThread(thread.id)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-500">
                        <AlertTriangle size={12} /> Segnala
                      </button>
                      {isLocated && onGoToPassage && (
                        <button
                          type="button"
                          onClick={() => onGoToPassage(thread.id)}
                          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
                        >
                          <LocateFixed size={12} /> Vai al passo
                        </button>
                      )}
                    </div>
                    {replyingTo === thread.id && (
                      <form onSubmit={event => void addReply(event, thread.id)} className="mt-3 flex gap-2">
                        <textarea value={replyBody} onChange={event => setReplyBody(event.target.value)} required rows={2} placeholder="Scrivi una risposta…" className="min-w-0 flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                        <button type="submit" aria-label="Invia risposta" className="self-end rounded-lg bg-primary-600 p-2 text-white"><Send size={14} /></button>
                      </form>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      </div>
    </motion.section>,
    document.body,
  );
}
