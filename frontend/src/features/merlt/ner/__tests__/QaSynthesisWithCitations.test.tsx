import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QaSynthesisWithCitations } from '../QaSynthesisWithCitations';

const TEXT = 'La risoluzione per inadempimento è disciplinata dall’art. 1453 c.c. e seguenti.';

describe('QaSynthesisWithCitations (surface: qa_chip)', () => {
  it('renders plain text (no markers) when disabled', () => {
    render(<QaSynthesisWithCitations text={TEXT} enabled={false} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /citazione:/i })).toBeNull();
    expect(screen.getByText(/La risoluzione per inadempimento/)).toBeInTheDocument();
  });

  it('marks detected citations as interactive buttons when enabled', () => {
    render(<QaSynthesisWithCitations text={TEXT} enabled onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /citazione:/i }).length).toBeGreaterThan(0);
  });

  it('clicking a citation opens the NER feedback affordance and emits a qa_chip payload', () => {
    const onSubmit = vi.fn();
    render(<QaSynthesisWithCitations text={TEXT} enabled onSubmit={onSubmit} />);

    fireEvent.click(screen.getAllByRole('button', { name: /citazione:/i })[0]);
    // feedback bar appears
    const confirm = screen.getByRole('button', { name: /conferma la citazione/i });
    fireEvent.click(confirm);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.surface).toBe('qa_chip');
    expect(payload.feedbackType).toBe('confirmation');
    expect(typeof payload.contextWindow).toBe('string');
    expect(payload.contextWindow).toContain('1453');
  });

  it('renders markdown bold/heading/list without literal markers', () => {
    const md = '## Sintesi\n\nLa **risoluzione** è disciplinata:\n- da *norme* speciali\n- da principi generali';
    render(<QaSynthesisWithCitations text={md} enabled={false} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Sintesi' })).toBeInTheDocument();
    expect(screen.getByText('risoluzione').tagName).toBe('STRONG');
    expect(screen.getByText('norme').tagName).toBe('EM');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('**');
    expect(document.body.textContent).not.toContain('##');
  });

  it('keeps citation chips working inside markdown and strips markers from the context window', () => {
    const onSubmit = vi.fn();
    const md = '### Analisi\n\nSi applica l’**art. 1453 c.c.** in tema di inadempimento.';
    render(<QaSynthesisWithCitations text={md} enabled onSubmit={onSubmit} />);

    const chip = screen.getAllByRole('button', { name: /citazione:/i })[0];
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('button', { name: /conferma la citazione/i }));

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.surface).toBe('qa_chip');
    expect(payload.contextWindow).toContain('1453');
    expect(payload.contextWindow).not.toContain('**');
    expect(payload.contextWindow).not.toContain('###');
  });

  it('detects citations inside list items and renders chips there', () => {
    render(
      <QaSynthesisWithCitations
        text={'Fonti:\n- art. 1453 c.c.\n- dottrina'}
        enabled
        onSubmit={vi.fn()}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /citazione:/i }).length).toBeGreaterThan(0);
  });
});
