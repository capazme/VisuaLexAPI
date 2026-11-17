import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../services/corsiService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/corsiService')>();
  return { ...actual, corsiService: { list: vi.fn(), get: vi.fn() } };
});

import { corsiService } from '../../../../services/corsiService';
import { coursesSwitchStore } from './coursesSwitch';
import { CourseTrail } from './CourseTrail';
import { examOf, listed, moduleOf, page } from './__fixtures__/corsi';

// LC62: a course's unit on Learn's road — its modules, its review, its exam — drawn only while «Percorsi» is on.

const list = vi.mocked(corsiService.list);
const get = vi.mocked(corsiService.get);

const renderTrail = () => render(<MemoryRouter><CourseTrail /></MemoryRouter>);

beforeEach(() => coursesSwitchStore.setState({ state: 'on' }));
afterEach(() => {
  vi.clearAllMocks();
  coursesSwitchStore.setState({ state: 'unknown' });
});

describe('CourseTrail', () => {
  it('reads nothing and draws nothing while the switch is off or unknown', () => {
    for (const state of ['off', 'unknown'] as const) {
      coursesSwitchStore.setState({ state });
      const { container, unmount } = renderTrail();
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    expect(list).not.toHaveBeenCalled();
  });

  it('draws a course in progress as modules, its review and its exam, with the server\'s states', async () => {
    list.mockResolvedValue([listed(), listed({ id: 'corso-2', stato: 'superato' })]);
    get.mockResolvedValue(page());
    renderTrail();
    const unit = await screen.findByRole('region', { name: 'Proprietà intellettuale: i segni distintivi' });
    // Only the course in progress is read.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('corso-1');
    const nodes = within(unit).getAllByRole('listitem');
    expect(nodes.map((n) => n.textContent)).toEqual([
      expect.stringContaining('Titolo del modulo 1'),
      expect.stringContaining('Titolo del modulo 2'),
      expect.stringContaining('Titolo del modulo 3'),
      expect.stringContaining('Ripasso del percorso'),
      expect.stringContaining('Esame del percorso'),
    ]);
    expect(within(unit).getByRole('link', { name: /^Modulo 1: Titolo del modulo 1, fatto/ })).toHaveAttribute('href', '/learn/percorsi/corso-1/moduli/m-1');
    expect(within(unit).getByRole('link', { name: /^Modulo 3: Titolo del modulo 3, da fare/ })).toBeInTheDocument();
    expect(within(unit).getByRole('link', { name: /^Ripasso del percorso: 4 schede da ripassare/ })).toHaveAttribute('href', '/learn/ripasso/sessione?corso=corso-1');
    // The exam is closed while the server says so: no link.
    expect(within(unit).queryByRole('link', { name: /Esame/ })).toBeNull();
    // Closed, yet reachable with Tab, so the keyboard hears why.
    expect(within(unit).getByRole('group', { name: 'Esame del percorso, chiuso: prima i moduli che contano' })).toHaveAttribute('tabindex', '0');
  });

  it('opens the exam when the server does, and leaves out a withdrawn module', async () => {
    list.mockResolvedValue([listed()]);
    get.mockResolvedValue(page({ moduli: [moduleOf(1), moduleOf(2, { stato: 'ritirato' })], esame: examOf({ stato: 'aperto' }), schede: { dovute: 0, nuove: 0, inAttesa: 0, verifica: 0 } }));
    renderTrail();
    const unit = await screen.findByRole('region', { name: 'Proprietà intellettuale: i segni distintivi' });
    expect(within(unit).queryByText('Titolo del modulo 2')).toBeNull();
    expect(within(unit).getByRole('link', { name: /^Esame del percorso: aperto/ })).toHaveAttribute('href', '/learn/percorsi/corso-1/esami/e-1');
    // Nothing due: the review is not a link, and says so.
    expect(within(unit).queryByRole('link', { name: /Ripasso del percorso/ })).toBeNull();
    expect(within(unit).getByText('Niente da ripassare oggi')).toBeInTheDocument();
  });

  it('draws nothing when no course is in progress, and nothing when the read fails', async () => {
    list.mockResolvedValue([listed({ stato: 'superato' })]);
    const { container, unmount } = renderTrail();
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();
    list.mockRejectedValue(new Error('down'));
    const failed = renderTrail();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(failed.container).toBeEmptyDOMElement();
  });
});
