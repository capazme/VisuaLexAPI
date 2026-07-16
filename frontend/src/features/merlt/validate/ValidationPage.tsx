import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, ScrollText } from 'lucide-react';
import type { SearchParams } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../../components/ui/Button';
import { Toast } from '../../../components/ui/Toast';
import { useMerltFeatures } from '../useMerltFeatures';
import { ValidationCard, type ValidationCardModel } from './ValidationCard';
import { ProvisionalReviewSection } from './ProvisionalReviewSection';
import {
  fetchPendingQueue,
  fetchProvisionalReview,
  adjudicateProvisional,
  voteEntity,
  voteRelation,
  type MerltVote,
  type PendingQueue,
  type ProvisionalReviewItem,
} from './validateApi';

type QueueState =
  | { status: 'loading' }
  | { status: 'success'; data: PendingQueue }
  | { status: 'error' };

type ProvisionalState =
  | { status: 'loading' }
  | { status: 'success'; items: ProvisionalReviewItem[] }
  | { status: 'error' };

interface VoteToast {
  message: string;
  action: { label: string; onClick: () => void };
}

/**
 * RLCF validation page (Slice 2c #8): vote on the community's pending entity /
 * relation proposals. Gated by full (validation) consent. setState lives in
 * handlers / promise callbacks (react-hooks/set-state-in-effect).
 */
export function ValidationPage() {
  const { canValidate, merltEnabled } = useMerltFeatures();
  const triggerSearch = useAppStore((s) => s.triggerSearch);
  const navigate = useNavigate();
  const [queue, setQueue] = useState<QueueState>({ status: 'loading' });
  const [provisional, setProvisional] = useState<ProvisionalState>({ status: 'loading' });
  // Items removed from view: voted (optimistic) OR skipped (deferred). Both hide
  // the card; only votes hit the server, so skip never reverts.
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  // Provisional nodes currently being adjudicated (in-flight → button spinner).
  const [adjudicating, setAdjudicating] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<VoteToast | null>(null);

  // Open the source norm in the reading view — the vanilla mechanism history /
  // dossiers use: navigate home, then park the params on the search trigger.
  const openNorm = (params: SearchParams): void => {
    navigate('/');
    triggerSearch(params);
  };

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
    fetchProvisionalReview()
      .then((res) => {
        if (!cancelled) setProvisional({ status: 'success', items: res.items });
      })
      .catch(() => {
        if (!cancelled) setProvisional({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [merltEnabled, canValidate]);

  const markResolved = (id: string): void => setResolved((prev) => new Set(prev).add(id));
  const unmarkResolved = (id: string): void =>
    setResolved((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  // "Salta": defer without voting. Removes the card locally (no server call, so
  // no revert bookkeeping); the item resurfaces on the next queue reload.
  const skip = (id: string): void => markResolved(id);

  // Optimistic removal with revert on failure: the item comes back into the
  // queue and a retry toast is offered (no silent catch — repo gotcha #18).
  // `reason` is only carried by rejects (quick-reasons from the card).
  const submitVote = async (
    kind: 'entity' | 'relation',
    id: string,
    vote: MerltVote,
    reason?: string,
  ): Promise<void> => {
    markResolved(id);
    try {
      if (kind === 'entity') {
        await voteEntity(id, vote, reason);
      } else {
        await voteRelation(id, vote, reason);
      }
    } catch (err) {
      console.error(`ValidationPage: ${kind} vote failed:`, err);
      unmarkResolved(id);
      setToast({
        message: 'Invio del voto non riuscito. La proposta è di nuovo in coda.',
        action: {
          label: 'Riprova',
          onClick: () => {
            setToast(null);
            void submitVote(kind, id, vote, reason);
          },
        },
      });
    }
  };

  // Adjudicate a provisional node: optimistic-on-success removal (the decision
  // applies immediately server-side, no consensus queue). Failure surfaces a
  // retry toast (no silent catch — repo gotcha #18) and leaves the card in view.
  const adjudicate = async (nodeId: string, decision: 'approve' | 'reject'): Promise<void> => {
    setAdjudicating((prev) => new Set(prev).add(nodeId));
    try {
      await adjudicateProvisional(nodeId, decision);
      setProvisional((prev) =>
        prev.status === 'success'
          ? { status: 'success', items: prev.items.filter((i) => i.node_id !== nodeId) }
          : prev,
      );
    } catch (err) {
      console.error('ValidationPage: adjudicate failed:', err);
      setToast({
        message:
          decision === 'approve'
            ? 'Conferma del nodo non riuscita.'
            : 'Rimozione del nodo non riuscita.',
        action: {
          label: 'Riprova',
          onClick: () => {
            setToast(null);
            void adjudicate(nodeId, decision);
          },
        },
      });
    } finally {
      setAdjudicating((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
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
                fonte: e.fonte,
                contributedBy: e.contributed_by,
                createdAt: e.created_at,
                votes: e.votes_count,
                normRef: e.articoli_correlati?.[0],
              }))}
            onVote={(id, v, reason) => void submitVote('entity', id, v, reason)}
            onSkip={skip}
            onOpenNorm={openNorm}
          />
          <ValidationSection
            title="Relazioni proposte"
            testId="pending-relations"
            items={queue.data.pending_relations
              .filter((r) => !resolved.has(r.id))
              .map((r) => ({
                id: r.id,
                title: r.relation_type ?? r.id,
                body: r.evidence,
                fonte: r.fonte,
                contributedBy: r.contributed_by,
                createdAt: r.created_at,
                votes: r.votes_count,
                normRef: r.source_urn,
              }))}
            onVote={(id, v, reason) => void submitVote('relation', id, v, reason)}
            onSkip={skip}
            onOpenNorm={openNorm}
          />
        </div>
      )}

      {provisional.status === 'success' && provisional.items.length > 0 && (
        <ProvisionalReviewSection
          items={provisional.items}
          pending={adjudicating}
          onAdjudicate={(nodeId, decision) => void adjudicate(nodeId, decision)}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          type="error"
          isVisible
          onClose={() => setToast(null)}
          duration={6000}
          action={toast.action}
        />
      )}
    </div>
  );
}

function ValidationSection({
  title,
  testId,
  items,
  onVote,
  onSkip,
  onOpenNorm,
}: {
  title: string;
  testId: string;
  items: ValidationCardModel[];
  onVote: (id: string, vote: MerltVote, reason?: string) => void;
  onSkip: (id: string) => void;
  onOpenNorm: (params: SearchParams) => void;
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
            <ValidationCard
              key={item.id}
              item={item}
              onVote={onVote}
              onSkip={onSkip}
              onOpenNorm={onOpenNorm}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
