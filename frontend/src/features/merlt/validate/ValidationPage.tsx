import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, ScrollText, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useMerltFeatures } from '../useMerltFeatures';
import {
  fetchPendingQueue,
  voteEntity,
  voteRelation,
  type MerltVote,
  type PendingQueue,
} from './validateApi';

type QueueState =
  | { status: 'loading' }
  | { status: 'success'; data: PendingQueue }
  | { status: 'error' };

/**
 * RLCF validation page (Slice 2c #8): vote on the community's pending entity /
 * relation proposals. Gated by full (validation) consent. setState lives in
 * handlers / promise callbacks (react-hooks/set-state-in-effect).
 */
export function ValidationPage() {
  const { canValidate, merltEnabled } = useMerltFeatures();
  const [queue, setQueue] = useState<QueueState>({ status: 'loading' });
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!merltEnabled || !canValidate) return;
    let cancelled = false;
    fetchPendingQueue()
      .then((data) => {
        if (!cancelled) setQueue({ status: 'success', data });
      })
      .catch(() => {
        if (!cancelled) setQueue({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [merltEnabled, canValidate]);

  const markResolved = (id: string): void => setResolved((prev) => new Set(prev).add(id));

  const handleEntityVote = async (id: string, vote: MerltVote): Promise<void> => {
    markResolved(id);
    try {
      await voteEntity(id, vote);
    } catch {
      // optimistic: a failed vote is recoverable on next load; keep UX snappy.
    }
  };
  const handleRelationVote = async (id: string, vote: MerltVote): Promise<void> => {
    markResolved(id);
    try {
      await voteRelation(id, vote);
    } catch {
      /* optimistic */
    }
  };

  if (!merltEnabled) return <p className="text-slate-600 dark:text-slate-300">MERL-T non è disponibile.</p>;
  if (!canValidate) {
    return (
      <div className="space-y-3">
        <p className="text-slate-600 dark:text-slate-300">
          Per validare le proposte della community serve il consenso <strong>Completo</strong>.
        </p>
        <Link to="/merlt">
          <Button variant="secondary" size="sm">Vai alle impostazioni MERL-T</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <Link to="/merlt" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> MERL-T
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
          <ScrollText className="text-primary-500" /> Validazione community
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
          Vota le proposte di nodi e relazioni in attesa. I voti sono pesati per la tua authority;
          al raggiungimento del consenso la proposta entra (o viene respinta) nel grafo.
        </p>
      </header>

      {queue.status === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} /> Caricamento proposte…
        </p>
      )}
      {queue.status === 'error' && (
        <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
          Coda di validazione non disponibile al momento.
        </p>
      )}

      {queue.status === 'success' && (
        <div className="space-y-6">
          <ValidationSection
            title="Entità proposte"
            testId="pending-entities"
            items={queue.data.pending_entities
              .filter((e) => !resolved.has(e.id))
              .map((e) => ({
                id: e.id,
                title: e.nome ?? e.id,
                body: e.descrizione,
                votes: e.votes_count,
              }))}
            onVote={(id, v) => void handleEntityVote(id, v)}
          />
          <ValidationSection
            title="Relazioni proposte"
            testId="pending-relations"
            items={queue.data.pending_relations
              .filter((r) => !resolved.has(r.id))
              .map((r) => ({
                id: r.id,
                title: r.tipo_relazione ?? r.id,
                body: r.descrizione,
                votes: r.votes_count,
              }))}
            onVote={(id, v) => void handleRelationVote(id, v)}
          />
        </div>
      )}
    </div>
  );
}

interface SectionItem {
  id: string;
  title: string;
  body?: string;
  votes?: number;
}

function ValidationSection({
  title,
  testId,
  items,
  onVote,
}: {
  title: string;
  testId: string;
  items: SectionItem[];
  onVote: (id: string, vote: MerltVote) => void;
}) {
  return (
    <section data-testid={testId}>
      <h2 className="mb-2 font-semibold text-slate-900 dark:text-white">
        {title} <span className="text-sm font-normal text-slate-400">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-1 text-sm text-slate-400">
          <Check size={14} /> Nessuna proposta in attesa.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white">{item.title}</p>
                {item.body && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{item.body}</p>}
                {typeof item.votes === 'number' && (
                  <p className="mt-1 text-xs text-slate-400">{item.votes} voti</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`Approva ${item.title}`}
                  onClick={() => onVote(item.id, 'approve')}
                  className="rounded-lg border border-emerald-200 p-2 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-900 dark:hover:bg-emerald-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <ThumbsUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Respingi ${item.title}`}
                  onClick={() => onVote(item.id, 'reject')}
                  className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <ThumbsDown size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
