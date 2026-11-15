import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../services/corsiService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/corsiService')>();
  return { ...actual, corsiService: { list: vi.fn() } };
});

import { corsiService } from '../../../../services/corsiService';
import { coursesSwitchStore } from './coursesSwitch';
import { TodayExam } from './TodayExam';
import { listed } from './__fixtures__/corsi';

const list = vi.mocked(corsiService.list);
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
});
