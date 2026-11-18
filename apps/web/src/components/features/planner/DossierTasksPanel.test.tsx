import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const service = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../../services/taskService', () => ({ taskService: service }));

import { DossierTasksPanel } from './DossierTasksPanel';

afterEach(() => vi.restoreAllMocks());

describe('«Compiti» on a dossier', () => {
  it('draws the import and the quick add with keys of their own: no duplicate key on the dossier id (LC91)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.list.mockResolvedValue({ today: '2026-10-20', tasks: [], truncated: false });
    render(<MemoryRouter><DossierTasksPanel dossierId="d-new" /></MemoryRouter>);
    expect(await screen.findByText('Nessun compito in questa pratica.')).toBeInTheDocument();
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });
});
