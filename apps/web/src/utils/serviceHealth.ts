import type { ServiceHealthState } from '../services/healthService';

const LABELS: Record<ServiceHealthState, string> = {
  online: 'Servizi operativi',
  degraded: 'Alcune fonti non disponibili',
  offline: 'Servizio non raggiungibile',
  checking: 'Controllo servizi…',
};

/**
 * The phrase that says how the services are: the user menu's «Stato dei servizi» writes it, the user button's
 * name (and, on a phone, the drawer button's) repeats it when `serviceHealthNeedsNotice`.
 */
export function serviceHealthLabel(state: ServiceHealthState): string {
  return LABELS[state];
}

/** Something is wrong (not while a check is running): the user button carries a dot. */
export function serviceHealthNeedsNotice(state: ServiceHealthState): boolean {
  return state === 'degraded' || state === 'offline';
}
