import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ServiceHealthMenuEntry } from './ServiceHealthMenuEntry';
import { serviceHealthLabel, serviceHealthNeedsNotice } from '../../utils/serviceHealth';
import type { ServiceHealthReading } from '../../hooks/useServiceHealth';
import type { ServiceHealthState } from '../../services/healthService';

const ITEM = 'w-full flex items-center gap-3 px-4 py-2.5 min-h-[44px] md:min-h-0 text-sm';

function reading(overall: ServiceHealthState): ServiceHealthReading {
  return {
    snapshot: {
      overall,
      services: [
        { name: 'Backend dati utente', state: 'online', latencyMs: 12 },
        { name: 'API normativa e fonti', state: 'degraded', latencyMs: 340 },
      ],
      checkedAt: '',
    },
    refresh: vi.fn().mockResolvedValue(undefined),
  };
}

const renderEntry = (health: ServiceHealthReading) => render(<div role="menu"><ServiceHealthMenuEntry health={health} itemClassName={ITEM} /></div>);

describe('ServiceHealthMenuEntry', () => {
  it.each([
    ['online', 'Servizi operativi'],
    ['degraded', 'Alcune fonti non disponibili'],
    ['offline', 'Servizio non raggiungibile'],
    ['checking', 'Controllo servizi…'],
  ] as const)('says %s as the pill did: «%s»', (state, phrase) => {
    expect(serviceHealthLabel(state)).toBe(phrase);
    renderEntry(reading(state));
    expect(screen.getByRole('menuitem', { name: phrase })).toHaveAttribute('aria-expanded', 'false');
  });

  it('asks for the dot when a source or a service is down, not when all is well nor while checking', () => {
    expect(serviceHealthNeedsNotice('degraded')).toBe(true);
    expect(serviceHealthNeedsNotice('offline')).toBe(true);
    expect(serviceHealthNeedsNotice('online')).toBe(false);
    expect(serviceHealthNeedsNotice('checking')).toBe(false);
  });

  it('opens inside the menu: each service with its state and latency, and «Ricontrolla» that probes again', () => {
    const health = reading('degraded');
    renderEntry(health);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alcune fonti non disponibili' }));
    expect(screen.getByRole('menuitem', { name: 'Alcune fonti non disponibili' })).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('group', { name: 'Stato dei servizi' });
    expect(list.textContent).toContain('Backend dati utenteOK · 12 ms');
    expect(list.textContent).toContain('API normativa e fontiDegradato · 340 ms');
    // Read, never acted on: reachable with the arrows, as the menu's entries are.
    for (const row of screen.getAllByRole('menuitem', { name: /Backend|API/ })) expect(row).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ricontrolla' }));
    expect(health.refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alcune fonti non disponibili' }));
    expect(screen.queryByRole('group', { name: 'Stato dei servizi' })).toBeNull();
  });

  it('gives every row a 44 px touch target on a phone, and keeps them all out of the tab order', () => {
    renderEntry(reading('online'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Servizi operativi' }));
    const rows = screen.getAllByRole('menuitem');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toHaveClass('min-h-[44px]', 'md:min-h-0');
      expect(row).toHaveAttribute('tabindex', '-1');
    }
  });

  // It was a pill fixed at the bottom left, starting after the sidebar; it covered the foot of the page on a phone.
  it('is an entry of the menu, not a pill fixed over the page', () => {
    const { container } = renderEntry(reading('online'));
    expect(container.querySelector('.fixed')).toBeNull();
    expect(container.querySelector('[class*="--sidebar-width"]')).toBeNull();
  });

  it('turns and spins only when motion is allowed', () => {
    renderEntry(reading('checking'));
    const entry = screen.getByRole('menuitem', { name: 'Controllo servizi…' });
    const [icon, chevron] = [...entry.querySelectorAll('svg')];
    expect(icon).toHaveClass('motion-safe:animate-spin');
    expect(icon).not.toHaveClass('animate-spin');
    expect(chevron).toHaveClass('motion-safe:transition-transform');
  });
});
