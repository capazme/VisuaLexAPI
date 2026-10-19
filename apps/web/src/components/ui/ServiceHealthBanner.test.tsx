import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../hooks/useServiceHealth', () => ({
  useServiceHealth: () => ({
    snapshot: { overall: 'degraded', services: [], checkedAt: '2026-10-19T09:00:00Z' },
    refresh: vi.fn(),
  }),
}));

import { ServiceHealthBanner } from './ServiceHealthBanner';

describe('ServiceHealthBanner', () => {
  it('gives the pill 44 px on a phone and its own height from md', () => {
    render(<ServiceHealthBanner />);
    expect(screen.getByRole('button', { name: 'Alcune fonti non disponibili' })).toHaveClass('min-h-[44px]', 'md:min-h-0');
  });
});
