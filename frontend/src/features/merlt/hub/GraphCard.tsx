import { Link } from 'react-router-dom';
import { Network } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { HubCard, StatusPill } from './HubCard';
import type { AsyncSlice, HubHealth } from './useHubData';

/**
 * Grafo card (§3.3). Visible to everyone the flag allows (reading is free, D2).
 * Shows a mini-stat when cheaply available from /health, else stays static.
 * "Esplora" → /grafo.
 */

export interface GraphCardProps {
  health: AsyncSlice<HubHealth>;
}

export function GraphCard({ health }: GraphCardProps) {
  const reachable = health.status === 'success' && health.data.reachable;
  const nodeCount = health.status === 'success' ? health.data.nodeCount : null;

  const pill =
    health.status === 'error' || (health.status === 'success' && !health.data.reachable) ? (
      <StatusPill tone="error">Non raggiungibile</StatusPill>
    ) : undefined;

  return (
    <HubCard testId="hub-card-graph" icon={Network} title="Grafo giuridico" pill={pill}>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Esplora le relazioni tra norme, principi e concetti.
      </p>
      {reachable && nodeCount != null && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <strong className="text-slate-700 dark:text-slate-200">{nodeCount.toLocaleString('it-IT')}</strong>{' '}
          nodi indicizzati.
        </p>
      )}
      <div className="mt-auto pt-3">
        <Link to="/grafo">
          <Button variant="primary" size="sm">
            Esplora
          </Button>
        </Link>
      </div>
    </HubCard>
  );
}
