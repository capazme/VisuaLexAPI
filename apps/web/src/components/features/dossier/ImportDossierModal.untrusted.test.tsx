import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportDossierModal } from './ImportDossierModal';
import { validateImportedDossier } from './dossierUtils';

describe('ImportDossierModal with a dossier that went through the check', () => {
  it('shows a dossier whose description is an object and whose tags are a string, without crashing', () => {
    const check = validateImportedDossier({ title: 'Da file', description: { a: 1 }, tags: 'uno,due', items: [] });
    expect(check).not.toBeNull();
    render(<ImportDossierModal dossier={check!.dossier} discarded={check!.discarded} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('Da file')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
