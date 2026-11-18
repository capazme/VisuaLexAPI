import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportDossierPanel } from './ImportDossierPanel';
import { validateImportedDossier } from './dossierUtils';

describe('ImportDossierPanel with a dossier that went through the check', () => {
  it('shows a dossier whose description is an object and whose tags are a string, without crashing', () => {
    const check = validateImportedDossier({ title: 'Da file', description: { a: 1 }, tags: 'uno,due', items: [] });
    expect(check).not.toBeNull();
    render(<ImportDossierPanel check={check} onClose={vi.fn()} onOpen={vi.fn()} showToast={vi.fn()} />);
    expect(screen.getByText('Da file')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
