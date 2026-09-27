import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { QaProcessTrace } from '../QaProcessTrace';
import type { QaAnswer } from '../types';

function answer(overrides: Partial<QaAnswer> = {}): QaAnswer {
  return {
    trace_id: 't1',
    synthesis: 'x',
    mode: 'convergent',
    sources: [],
    retrieved_sources: [{ urn: 'urn:x~art1453', provenance: 'seed', trust: 1 }],
    experts_used: ['literal', 'precedent'],
    confidence: 0.6,
    execution_time_ms: 1234,
    ...overrides,
  };
}

describe('QaProcessTrace (dev mode)', () => {
  it('summarises timing/confidence and exposes stage times + NER entities', () => {
    render(
      <QaProcessTrace
        answer={answer({
          pipeline_trace: {
            routing: { method: 'neural' },
            ner_result: { query_type: 'definition', entities: [{ text: 'art. 1453', type: 'NORM_REFERENCE' }] },
            stage_times_ms: { ner: 12.4, synthesis: 800 },
          },
        })}
      />,
    );
    expect(screen.getByText(/dettagli processo \(dev\)/i)).toBeInTheDocument();
    expect(screen.getByText('1234 ms')).toBeInTheDocument();
    expect(screen.getByText('neural')).toBeInTheDocument();
    expect(screen.getByText(/art\. 1453 · NORM_REFERENCE/)).toBeInTheDocument();
    expect(screen.getByText('synthesis')).toBeInTheDocument();
  });

  it('shows a graceful message when no trace is present', () => {
    render(<QaProcessTrace answer={answer()} />);
    expect(screen.getByText(/nessun trace disponibile/i)).toBeInTheDocument();
  });

  it('renders the raw JSON trace block', () => {
    render(<QaProcessTrace answer={answer({ pipeline_trace: { foo: 'bar' } })} />);
    fireEvent.click(screen.getByText(/trace grezzo \(json\)/i));
    expect(screen.getByText(/"foo": "bar"/)).toBeInTheDocument();
  });
});
