import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const resolveAct = vi.fn();
const legalFetch = vi.fn();
vi.mock('../../../utils/actUrn', () => ({ resolveAct: (...a: unknown[]) => resolveAct(...a) }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: (...a: unknown[]) => legalFetch(...a) }));

import { TreeNavigatorModal } from './TreeNavigatorModal';

beforeEach(() => {
  vi.clearAllMocks();
  resolveAct.mockResolvedValue({ urn: 'urn:l247', norma: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31' } });
  legalFetch.mockResolvedValue({ json: async () => ({ articles: ['1', '3'] }) });
});

describe('TreeNavigatorModal', () => {
  it("opens on an act's index at once, and imports with the act's identity", async () => {
    const onImport = vi.fn();
    render(<TreeNavigatorModal onClose={() => {}} onImport={onImport}
      initialAct={{ tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31' }} />);
    await screen.findByText('Art. 3');
    expect(resolveAct).toHaveBeenCalledWith({ act_type: 'legge', act_number: '247', date: '2012-12-31' });
    fireEvent.click(screen.getByText('Art. 3'));
    fireEvent.click(screen.getByRole('button', { name: /Importa/ }));
    expect(onImport).toHaveBeenCalledWith(
      [{ numero: '3', urn: undefined }],
      { tipo_atto: 'legge', data: '2012-12-31', numero_atto: '247' },
    );
  });

  it('stores the day as the source has it, not as it was typed, so the act is one block', async () => {
    const onImport = vi.fn();
    render(<TreeNavigatorModal onClose={() => {}} onImport={onImport} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'legge' } });
    fireEvent.change(screen.getByPlaceholderText('241'), { target: { value: '247' } });
    fireEvent.change(screen.getByPlaceholderText('aaaa o gg-mm-aaaa'), { target: { value: '31-12-2012' } });
    fireEvent.click(screen.getByRole('button', { name: /Cerca articoli/ }));
    await screen.findByText('Art. 1');
    fireEvent.click(screen.getByText('Art. 1'));
    fireEvent.click(screen.getByRole('button', { name: /Importa/ }));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0][1]).toEqual({ tipo_atto: 'legge', data: '2012-12-31', numero_atto: '247' });
  });

  it('shows an act type the list does not offer', async () => {
    render(<TreeNavigatorModal onClose={() => {}} onImport={() => {}}
      initialAct={{ tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016-04-27' }} />);
    expect(screen.getByRole('combobox')).toHaveValue('regolamento ue');
    await screen.findByText('Art. 1');
  });
});
