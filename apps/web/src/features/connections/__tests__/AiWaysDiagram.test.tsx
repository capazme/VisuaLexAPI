import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiWaysDiagram } from '../AiWaysDiagram';

describe('AiWaysDiagram', () => {
  it('names the three ways and says «in arrivo» only for the two not built yet', () => {
    render(<AiWaysDiagram />);
    const name = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(name).toContain('il tuo abbonamento, via mcp;');
    expect(name).toContain('un modello sul computer (in arrivo)');
    expect(name).toContain('la tua chiave (in arrivo)');
    expect(name.match(/in arrivo/g)).toHaveLength(2);
  });

  it('pauses the pulse with a toggle button', () => {
    const { container } = render(<AiWaysDiagram />);
    const button = screen.getByRole('button', { name: 'Ferma l’animazione' });
    const pulse = container.querySelector('.vlx-pulse') as SVGPathElement;
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(pulse.style.animationPlayState).toBe('running');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(pulse.style.animationPlayState).toBe('paused');
  });
});
