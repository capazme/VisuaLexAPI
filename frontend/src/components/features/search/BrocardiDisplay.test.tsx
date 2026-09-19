import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrocardiDisplay } from './BrocardiDisplay';
import type { BrocardiInfo } from '../../../types';

const empty: BrocardiInfo = {
  position: null, link: null, Brocardi: null, Ratio: null,
  Spiegazione: null, Massime: null,
};

/** The Glossario is a collapsible, collapsed by default like its siblings. */
function expandGlossario() {
  fireEvent.click(screen.getByRole('button', { name: /espandi il glossario/i }));
}

describe('BrocardiDisplay — Glossario', () => {
  it('renders the dictionary terms', () => {
    render(<BrocardiDisplay info={{
      ...empty,
      Glossario: [
        { termine: 'colpa', url: 'https://brocardi.it/dizionario/1.html', dizionario_id: '1' },
        { termine: 'dolo', url: 'https://brocardi.it/dizionario/2.html', dizionario_id: '2' },
      ],
    }} />);
    expandGlossario();
    expect(screen.getByText('colpa')).toBeInTheDocument();
    expect(screen.getByText('dolo')).toBeInTheDocument();
  });

  it('is keyboard operable and reports its state', () => {
    render(<BrocardiDisplay info={{
      ...empty,
      Glossario: [{ termine: 'colpa', url: 'https://brocardi.it/dizionario/1.html', dizionario_id: '1' }],
    }} />);
    const header = screen.getByRole('button', { name: /espandi il glossario/i });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(screen.getByRole('button', { name: /comprimi il glossario/i }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('colpa')).toBeInTheDocument();
  });

  it('does not fall through to the empty state when only the Glossario is present', () => {
    // The hasContent OR-chain is a silent failure mode: a field with a render
    // block but no gate entry shows the empty state on sparse articles.
    render(<BrocardiDisplay info={{
      ...empty,
      Glossario: [{ termine: 'colpa', url: 'https://brocardi.it/dizionario/1.html', dizionario_id: '1' }],
    }} />);
    expect(screen.queryByText(/nessun approfondimento/i)).not.toBeInTheDocument();
  });

  it('opens dictionary links in a new tab, safely', () => {
    render(<BrocardiDisplay info={{
      ...empty,
      Glossario: [{ termine: 'colpa', url: 'https://brocardi.it/dizionario/1.html', dizionario_id: '1' }],
    }} />);
    expandGlossario();
    const link = screen.getByRole('link', { name: 'colpa' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('BrocardiDisplay — RelatedArticles', () => {
  it('renders previous and next', () => {
    render(<BrocardiDisplay info={{
      ...empty,
      RelatedArticles: {
        previous: { numero: '2042', url: 'https://brocardi.it/a.html', titolo: 'Art. 2042' },
        next: { numero: '2044', url: 'https://brocardi.it/b.html', titolo: 'Art. 2044' },
      },
    }} />);
    expect(screen.getByText(/2042/)).toBeInTheDocument();
    expect(screen.getByText(/2044/)).toBeInTheDocument();
  });
});

describe('BrocardiDisplay — empty', () => {
  it('shows the empty state when nothing is present', () => {
    render(<BrocardiDisplay info={empty} />);
    expect(screen.queryByText('colpa')).not.toBeInTheDocument();
    expect(screen.getByText(/nessun approfondimento/i)).toBeInTheDocument();
  });
});
