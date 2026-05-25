import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DepthSelector } from '../DepthSelector';

describe('DepthSelector', () => {
  it('marks the current depth as active', () => {
    render(
      <DepthSelector depth={2} layout="cose-bilkent" onDepthChange={vi.fn()} onLayoutChange={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onDepthChange when a depth button is clicked', () => {
    const onDepthChange = vi.fn();
    render(
      <DepthSelector depth={1} layout="cose-bilkent" onDepthChange={onDepthChange} onLayoutChange={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onDepthChange).toHaveBeenCalledWith(3);
  });

  it('calls onLayoutChange when the layout select changes', () => {
    const onLayoutChange = vi.fn();
    render(
      <DepthSelector depth={2} layout="cose-bilkent" onDepthChange={vi.fn()} onLayoutChange={onLayoutChange} />
    );
    fireEvent.change(screen.getByRole('combobox', { name: /layout/i }), {
      target: { value: 'dagre' },
    });
    expect(onLayoutChange).toHaveBeenCalledWith('dagre');
  });
});
