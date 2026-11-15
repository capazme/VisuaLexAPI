import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../services/corsiService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/corsiService')>();
  return { ...actual, corsiService: { list: vi.fn(), get: vi.fn() } };
});

import { corsiService } from '../../../../services/corsiService';
import { coursesSwitchStore } from './coursesSwitch';
import { TodayExam } from './TodayExam';
import { examOf, listed, page } from './__fixtures__/corsi';

const list = vi.mocked(corsiService.list);
const get = vi.mocked(corsiService.get);
const renderRow = () => render(<MemoryRouter><TodayExam /></MemoryRouter>);

beforeEach(() => coursesSwitchStore.setState({ state: 'on' }));
afterEach(() => {
  vi.clearAllMocks();
  coursesSwitchStore.setState({ state: 'unknown' });
});

describe('«Oggi»\'s «Simulazione d\'esame» (LC9)', () => {
  it('reads nothing and draws nothing while the switch is off or unknown', () => {
    for (const state of ['off', 'unknown'] as const) {
      coursesSwitchStore.setState({ state });
      const { container, unmount } = renderRow();
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    expect(list).not.toHaveBeenCalled();
  });

  it('offers the exam of a course whose next step is the exam, and takes there', async () => {
    list.mockResolvedValue([listed({ prossimo: { tipo: 'esame', id: 'e-1' } }), listed({ id: 'corso-2' })]);
    renderRow();
    expect(await screen.findByRole('heading', { name: 'Simulazione d’esame' })).toBeInTheDocument();
    expect(screen.getByText(/Proprietà intellettuale: i segni distintivi/)).toBeInTheDocument();
    const go = screen.getByRole('link', { name: 'Inizia la prova di «Proprietà intellettuale: i segni distintivi»' });
    expect(go).toHaveAttribute('href', '/learn/percorsi/corso-1/esami/e-1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('draws nothing when no course has an exam open', async () => {
    list.mockResolvedValue([listed(), listed({ id: 'corso-2', stato: 'superato', prossimo: null })]);
    const { container } = renderRow();
    await act(async () => {});
    expect(list).toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('says «Riprendi la prova» once the attempt is started, as the course page does (LC12)', async () => {
    list.mockResolvedValue([listed({ prossimo: { tipo: 'esame', id: 'e-1' } })]);
    get.mockResolvedValue(page({ esame: examOf({ stato: 'in-corso' }) }));
    renderRow();
    const go = await screen.findByRole('link', { name: 'Riprendi la prova di «Proprietà intellettuale: i segni distintivi»' });
    expect(go).toHaveTextContent('Riprendi la prova');
    expect(go).toHaveAttribute('href', '/learn/percorsi/corso-1/esami/e-1');
    expect(get).toHaveBeenCalledWith('corso-1');
  });
});
