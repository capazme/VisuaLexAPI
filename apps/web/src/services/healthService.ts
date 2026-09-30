import { legalFetch } from './legalFetch';
import { DOCTRINE_LABEL } from '../utils/doctrineLabel';

export type ServiceHealthState = 'online' | 'degraded' | 'offline' | 'checking';

export interface ServiceHealth {
  name: string;
  state: ServiceHealthState;
  latencyMs?: number;
  detail?: string;
}

export interface HealthSnapshot {
  overall: ServiceHealthState;
  services: ServiceHealth[];
  checkedAt: string;
}

// The Python API names its sources by key; the reader sees their names.
const SOURCE_LABELS: Record<string, string> = {
  normattiva: 'Normattiva',
  eurlex: 'EUR-Lex',
  brocardi: DOCTRINE_LABEL,
};

function sourceLabel(key: string): string {
  return SOURCE_LABELS[key.toLowerCase()] ?? key;
}

async function probe(url: string, name: string, signal: AbortSignal): Promise<ServiceHealth> {
  const started = performance.now();
  try {
    const response = await legalFetch(url, { signal });
    const payload = await response.json().catch(() => ({})) as { status?: string; services?: Record<string, { status?: string; latency_ms?: number }> };
    const latencyMs = Math.round(performance.now() - started);
    // A 503 that still carries the services map is the API saying "I am up,
    // a source is not": degraded, not offline. Only a body without that map
    // is a dead service.
    if (payload.services) {
      const degraded = Object.entries(payload.services).filter(([, value]) => value.status !== 'ok');
      return { name, state: degraded.length > 0 ? 'degraded' : 'online', latencyMs, detail: degraded.length ? `Non disponibili: ${degraded.map(([key]) => sourceLabel(key)).join(', ')}` : undefined };
    }
    if (!response.ok) return { name, state: 'offline', latencyMs, detail: `HTTP ${response.status}` };
    return { name, state: payload.status === 'ok' ? 'online' : 'degraded', latencyMs };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return { name, state: 'offline', detail: 'Servizio non raggiungibile' };
  }
}

export async function getHealthSnapshot(signal: AbortSignal): Promise<HealthSnapshot> {
  const services = await Promise.all([
    probe('/api/health/detailed', 'Backend dati utente', signal),
    probe('/health/detailed', 'API normativa e fonti', signal),
  ]);
  const hasOffline = services.some(service => service.state === 'offline');
  const hasDegraded = services.some(service => service.state === 'degraded');
  return { overall: hasOffline ? 'offline' : hasDegraded ? 'degraded' : 'online', services, checkedAt: new Date().toISOString() };
}
