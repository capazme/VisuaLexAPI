import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AliasManager } from './AliasManager';
import { appStore } from '../../../store/useAppStore';
import type { CustomAlias } from '../../../types';

const baseAlias: CustomAlias = {
  id: 'a1',
  trigger: 'gdpr',
  type: 'reference',
  expandTo: 'GDPR',
  searchParams: { act_type: 'Regolamento UE', act_number: '679', date: '2016' },
  createdAt: new Date().toISOString(),
  usageCount: 7,
  lastUsedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
};

describe('AliasManager', () => {
  beforeEach(() => {
    appStore.setState({ aliasManagerOpen: true, customAliases: [baseAlias] });
  });

  it('renders usageCount and the lastUsedAt recency label', () => {
    render(<AliasManager />);
    expect(screen.getByText(/7×/)).toBeInTheDocument();
    expect(screen.getByText(/ultima .* fa/)).toBeInTheDocument();
  });

  it('omits the recency label when lastUsedAt is absent', () => {
    appStore.setState({ aliasManagerOpen: true, customAliases: [{ ...baseAlias, lastUsedAt: undefined }] });
    render(<AliasManager />);
    expect(screen.getByText(/7×/)).toBeInTheDocument();
    expect(screen.queryByText(/ultima/)).not.toBeInTheDocument();
  });
});
