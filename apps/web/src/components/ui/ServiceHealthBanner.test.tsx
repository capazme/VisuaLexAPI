import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServiceHealthBanner } from './ServiceHealthBanner';

vi.mock('../../hooks/useServiceHealth', () => ({
  useServiceHealth: () => ({ snapshot: { overall: 'online', services: [] }, refresh: vi.fn() }),
}));

describe('ServiceHealthBanner', () => {
  it('gives its toggle a 44 px touch target on a phone', () => {
    render(<ServiceHealthBanner />);
    expect(screen.getByRole('button', { name: /Servizi operativi/ })).toHaveClass('min-h-[44px]', 'md:min-h-0');
  });
});
