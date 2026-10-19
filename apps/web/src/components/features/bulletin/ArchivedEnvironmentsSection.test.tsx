import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Environment } from '../../../types';
import { appStore } from '../../../store/useAppStore';
import { ArchivedEnvironmentsSection } from './ArchivedEnvironmentsSection';

const service = vi.hoisted(() => ({ recover: vi.fn() }));
vi.mock('../../../services/environmentService', () => ({ environmentService: service }));

const env: Environment = {
  id: 'e1', name: 'Privacy', createdAt: '', quickNorms: [], customAliases: [],
  dossiers: [{ id: 'd1', title: 'GDPR', createdAt: '', items: [] }],
  annotations: [{ id: 'a' } as Environment['annotations'][number]], highlights: [],
};

beforeEach(() => service.recover.mockReset().mockResolvedValue({ dossiers: [{ id: 'n', name: 'GDPR', entries: 0 }] }));

describe('ArchivedEnvironmentsSection', () => {
  it('is absent for a user with no environment', () => {
    appStore.setState({ environments: [] });
    const { container } = render(<ArchivedEnvironmentsSection onRecovered={vi.fn()} onMessage={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('recovers an environment\'s dossiers on the server, with the switches', async () => {
    appStore.setState({ environments: [env] });
    const onRecovered = vi.fn();
    render(<ArchivedEnvironmentsSection onRecovered={onRecovered} onMessage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recupera i dossier di «Privacy»' }));
    const dialog = screen.getByRole('dialog', { name: 'Recupera i dossier' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Le note (1)' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Recupera i dossier' }));
    await waitFor(() => expect(onRecovered).toHaveBeenCalled());
    expect(service.recover).toHaveBeenCalledWith('e1', { addNotes: false, addHighlights: false });
  });

  it('deletes only after a danger confirmation', async () => {
    const deleteEnvironment = vi.fn().mockResolvedValue(undefined);
    appStore.setState({ environments: [env], deleteEnvironment });
    render(<ArchivedEnvironmentsSection onRecovered={vi.fn()} onMessage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Elimina «Privacy»' }));
    expect(deleteEnvironment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    expect(deleteEnvironment).toHaveBeenCalledWith('e1');
  });
});
