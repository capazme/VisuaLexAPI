import { Network } from 'lucide-react';
import { HubAction, HubCard } from './HubCard';
import { HUB_NOTE, HUB_TEXT } from './hubStyles';
import type { AsyncSlice, HubHealth } from './useHubData';

/**
 * Grafo card (§3.3). Visible to everyone the flag allows (reading is free, D2).
 * Shows a mini-stat when cheaply available from /health, else stays static; a
 * MERL-T it cannot reach is said in its text (S7b). "Esplora il grafo" → /grafo.
 */

export interface GraphCardProps {
  health: AsyncSlice<HubHealth>;
}

export function GraphCard({ health }: GraphCardProps) {
  const reachable = health.status === 'success' && health.data.reachable;
  const nodeCount = health.status === 'success' ? health.data.nodeCount : null;
  const unreachable = health.status === 'error' || (health.status === 'success' && !health.data.reachable);

  return (
    <HubCard testId="hub-card-graph" icon={Network} title="Grafo giuridico" action={<HubAction to="/grafo">Esplora il grafo</HubAction>}>
      <p className={HUB_TEXT}>Esplora le relazioni tra norme, principi e concetti.</p>
      {reachable && nodeCount != null && (
        <p className={`mt-2 ${HUB_NOTE}`}>
          <strong className="text-slate-800 dark:text-slate-200">{nodeCount.toLocaleString('it-IT')}</strong> nodi indicizzati.
        </p>
      )}
      {unreachable && <p className={`mt-2 ${HUB_NOTE}`}>Grafo non raggiungibile al momento: riprova più tardi.</p>}
    </HubCard>
  );
}
