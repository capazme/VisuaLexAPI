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

  it('starts after the desktop sidebar, whatever its width (the bar with words is 224 px)', () => {
    render(<ServiceHealthBanner />);
    const pill = screen.getByRole('button', { name: /Servizi operativi/ }).parentElement as HTMLElement;
    expect(pill).toHaveClass('lg:left-[calc(var(--sidebar-width,64px)+2rem)]');
    expect(pill).not.toHaveClass('lg:left-24');
  });
});
