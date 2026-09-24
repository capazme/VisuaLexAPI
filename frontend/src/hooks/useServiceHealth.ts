import { useCallback, useEffect, useRef, useState } from 'react';
import { getHealthSnapshot, type HealthSnapshot } from '../services/healthService';

const INITIAL: HealthSnapshot = { overall: 'checking', services: [], checkedAt: '' };

/**
 * How often a visible tab re-probes. The Python half of the probe
 * (`/health/detailed`) reaches Normattiva, EUR-Lex and Brocardi for real, so
 * the server caches its answer (`HEALTH_DETAILED_TTL`, two minutes) and the
 * client asks rarely: once on mount, every five minutes while the tab is
 * visible, and when the user presses "Ricontrolla". The first version asked
 * every sixty seconds per open tab, which multiplied by tabs and users into
 * a steady stream of hits on third-party sites and their circuit breakers.
 */
const POLL_INTERVAL_MS = 5 * 60_000;

export function useServiceHealth(enabled = true) {
  const [snapshot, setSnapshot] = useState<HealthSnapshot>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);

  // The poll never flips the banner to "checking": a spinner every five
  // minutes is noise, and the state is only ever set once the probe answers.
  const probe = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const next = await getHealthSnapshot(controller.signal);
      if (!controller.signal.aborted) setSnapshot(next);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('Service health probe failed:', error);
      setSnapshot(previous => ({ ...previous, overall: 'offline', checkedAt: new Date().toISOString() }));
    }
  }, []);

  // The manual "Ricontrolla" shows the spinner, because the user asked and
  // is looking.
  const refresh = useCallback(() => {
    setSnapshot(previous => ({ ...previous, overall: 'checking' }));
    return probe();
  }, [probe]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = () => { if (!cancelled) void probe(); };
    tick();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
      window.clearInterval(interval);
    };
  }, [enabled, probe]);

  return { snapshot, refresh };
}
