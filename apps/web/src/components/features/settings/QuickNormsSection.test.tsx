import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickNormsSection } from './QuickNormsSection';
import { appStore } from '../../../store/useAppStore';
import type { QuickNorm } from '../../../types';

const baseQuickNorm: QuickNorm = {
  id: 'qn1',
  label: 'Art. 2043 CC',
  searchParams: {
    act_type: 'codice civile',
    act_number: '',
    date: '',
    article: '2043',
    version: 'vigente',
  },
  createdAt: new Date().toISOString(),
  usageCount: 4,
  lastUsedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
};

describe('QuickNormsSection', () => {
  beforeEach(() => {
    appStore.setState({ quickNorms: [baseQuickNorm] });
  });

  it('renders usageCount and the lastUsedAt recency label', () => {
    render(<MemoryRouter><QuickNormsSection /></MemoryRouter>);
    expect(screen.getByText(/Usato 4x/)).toBeInTheDocument();
    expect(screen.getByText(/ultima .* fa/)).toBeInTheDocument();
  });

  it('omits the recency label when lastUsedAt is absent', () => {
    appStore.setState({ quickNorms: [{ ...baseQuickNorm, lastUsedAt: undefined }] });
    render(<MemoryRouter><QuickNormsSection /></MemoryRouter>);
    expect(screen.getByText(/Usato 4x/)).toBeInTheDocument();
    expect(screen.queryByText(/ultima/)).not.toBeInTheDocument();
  });
});
