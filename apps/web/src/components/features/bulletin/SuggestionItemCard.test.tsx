import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuggestionItemCard } from './SuggestionItemCard';
import type { SuggestionItem } from '../../../types';

const base: Omit<SuggestionItem, 'itemType' | 'payload'> = {
  id: 'i1', status: 'pending', reviewNote: null, reviewedAt: null,
  createdAt: new Date().toISOString(),
};

describe('SuggestionItemCard', () => {
  it('renders annotation preview with articleId + anchor', () => {
    render(<SuggestionItemCard item={{
      ...base, itemType: 'annotation',
      payload: { articleId: 'art-2043', anchorText: 'dolo', text: 'Il dolo richiede intenzione.' },
    }} />);
    expect(screen.getByText(/art-2043/)).toBeInTheDocument();
    expect(screen.getAllByText(/dolo/).length).toBeGreaterThan(0);
  });

  it('labels a decision\'s note by its citation, not by an empty article id', () => {
    render(<SuggestionItemCard item={{
      ...base, itemType: 'annotation',
      payload: { normaKey: 'cassazione:civile:10787:2024', articleId: '', anchorText: 'ricorso', text: 'Da rivedere.' },
    }} />);
    expect(screen.getByText(/Cass\. civ\., n\. 10787\/2024/)).toBeInTheDocument();
  });

  it('renders alias with trigger → expandTo', () => {
    render(<SuggestionItemCard item={{
      ...base, itemType: 'alias',
      payload: { trigger: 'cc', aliasType: 'shortcut', expandTo: 'codice civile' },
    }} />);
    expect(screen.getByText('cc')).toBeInTheDocument();
    expect(screen.getByText(/codice civile/)).toBeInTheDocument();
  });

  it('renders "Presa il DD/MM" chip for taken status', () => {
    render(<SuggestionItemCard item={{
      ...base, itemType: 'quickNorm',
      status: 'taken', reviewedAt: '2026-04-20T10:00:00Z',
      payload: { label: 'Test', searchParams: { act_type: 'cc' } },
    }} />);
    expect(screen.getByText(/Presa il 20\/04/)).toBeInTheDocument();
  });
});
