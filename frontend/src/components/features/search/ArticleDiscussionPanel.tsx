import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronDown, ChevronUp, MessageCircle, Plus, Send, ThumbsUp, X } from 'lucide-react';
import { Z_INDEX } from '../../../constants/zIndex';
import type { ArticleDiscussionThread } from '../../../types';
import { articleDiscussionService, type DiscussionAnchor } from '../../../services/articleDiscussionService';
import { cn } from '../../../lib/utils';

interface Props {
  anchor: DiscussionAnchor;
  isOpen: boolean;
  onClose: () => void;
}

export function ArticleDiscussionPanel({ anchor, isOpen, onClose }: Props) {
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

  // Fetch only while the panel is shown. It is mounted for every rendered
  // article, so a load on mount cost one GET per article of a range whether
  // or not anyone opened it (a 20-article range: 20 requests).
  useEffect(() => { if (isOpen) void load(); }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const createThread = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    try {
      const thread = await articleDiscussionService.create(anchor, title.trim(), body.trim());
      setThreads(prev => [thread, ...prev]);
      setTitle('');
      setBody('');
      setComposerOpen(false);
    } catch {
      setError('Impossibile pubblicare la discussione.');
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
          <h3 id="article-discussions-title" className="font-semibold text-slate-900 dark:text-white">Discussioni sull’articolo</h3>
          <span className="text-xs text-slate-400">Art. {anchor.articleLabel ?? anchor.articleId}</span>
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
          <input value={title} onChange={event => setTitle(event.target.value)} required minLength={3} maxLength={200} placeholder="Titolo della discussione" aria-label="Titolo della discussione" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          <textarea value={body} onChange={event => setBody(event.target.value)} required minLength={3} maxLength={10000} placeholder="Condividi una domanda o un'osservazione..." aria-label="Testo della discussione" rows={4} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setComposerOpen(false)} className="px-3 py-1.5 text-xs text-slate-500">Annulla</button><button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white"><Send size={13} /> Pubblica</button></div>
        </form>
      )}

      {error && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">{error}</div>}
      {notice && <div role="status" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">{notice}</div>}
      {isLoading ? <p className="text-sm text-slate-400">Caricamento discussioni…</p> : threads.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-6 text-center text-sm text-slate-500">Nessuna discussione ancora. Puoi essere il primo a porre una domanda.</p> : (
        <div className="space-y-3">
          {threads.map(thread => {
            const isExpanded = expanded.has(thread.id);
            return <article key={thread.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <button type="button" onClick={() => setExpanded(prev => { const next = new Set(prev); if (next.has(thread.id)) next.delete(thread.id); else next.add(thread.id); return next; })} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                  <span className="min-w-0 flex-1"><h4 className="font-semibold text-slate-900 dark:text-white">{thread.title}</h4>
                    <span className="mt-1 block text-xs text-slate-400">{thread.user.username} · {new Date(thread.createdAt).toLocaleDateString('it-IT')} · {thread.comments.length} risposte</span>
                  </span>
                  {isExpanded ? <ChevronUp size={16} className="mt-1 shrink-0 text-slate-400" /> : <ChevronDown size={16} className="mt-1 shrink-0 text-slate-400" />}
                </button>
                <button type="button" onClick={() => void voteThread(thread)} aria-label="Vota discussione" className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs', thread.userVoted ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800')}><ThumbsUp size={13} /> {thread.voteCount}</button>
              </div>
              {isExpanded && <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3"><p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{thread.body}</p><div className="mt-4 space-y-2 pl-3 border-l-2 border-slate-100 dark:border-slate-800">{thread.comments.map(comment => <div key={comment.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3"><div className="flex justify-between gap-2"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{comment.user.username}</span><button type="button" onClick={() => void voteComment(thread.id, comment.id)} className={cn('inline-flex items-center gap-1 text-xs', comment.userVoted ? 'text-primary-600' : 'text-slate-400')}><ThumbsUp size={12} /> {comment.voteCount}</button></div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{comment.body}</p></div>)}</div><div className="mt-3 flex gap-2"><button type="button" onClick={() => setReplyingTo(replyingTo === thread.id ? null : thread.id)} className="text-xs text-primary-600 hover:underline">Rispondi</button><button type="button" onClick={() => void reportThread(thread.id)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-500"><AlertTriangle size={12} /> Segnala</button></div>{replyingTo === thread.id && <form onSubmit={event => void addReply(event, thread.id)} className="mt-3 flex gap-2"><textarea value={replyBody} onChange={event => setReplyBody(event.target.value)} required rows={2} placeholder="Scrivi una risposta…" className="min-w-0 flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" /><button type="submit" aria-label="Invia risposta" className="self-end rounded-lg bg-primary-600 p-2 text-white"><Send size={14} /></button></form>}</div>}
            </article>;
          })}
        </div>
      )}
      </div>
    </motion.section>,
    document.body,
  );
}
