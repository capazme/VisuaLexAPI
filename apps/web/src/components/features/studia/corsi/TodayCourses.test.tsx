import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../services/corsiService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/corsiService')>();
  return { ...actual, corsiService: { today: vi.fn() } };
});

import { corsiService } from '../../../../services/corsiService';
import { coursesSwitchStore } from './coursesSwitch';
import { TodayCourses } from './TodayCourses';

const today = vi.mocked(corsiService.today);

const renderRow = () => render(<MemoryRouter><TodayCourses /></MemoryRouter>);

beforeEach(() => coursesSwitchStore.setState({ state: 'on' }));
afterEach(() => {
  vi.clearAllMocks();
  coursesSwitchStore.setState({ state: 'unknown' });
});

describe('«Oggi»\'s row of the courses (§6.2)', () => {
  it('reads nothing and draws nothing while the switch is off or unknown', () => {
    for (const state of ['off', 'unknown'] as const) {
      coursesSwitchStore.setState({ state });
      const { container, unmount } = renderRow();
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    expect(today).not.toHaveBeenCalled();
  });

  it('suggests the day\'s module: «Modulo del giorno: <titolo> · <percorso>»', async () => {
    today.mockResolvedValue([{ corsoId: 'corso-1', titolo: 'Segni distintivi', modulo: { id: 'm-4', ordine: 4, titolo: 'Il marchio di fatto' }, schedeDovute: 0 }]);
    renderRow();
    const row = await screen.findByRole('link', { name: /Modulo del giorno: Il marchio di fatto/ });
    expect(row).toHaveTextContent('Modulo del giorno: Il marchio di fatto · Segni distintivi');
    expect(row).toHaveAttribute('href', '/studia/percorsi/corso-1');
  });

  it('offers the course\'s due cards first, the module after them', async () => {
    today.mockResolvedValue([{ corsoId: 'corso-1', titolo: 'Segni distintivi', modulo: { id: 'm-4', ordine: 4, titolo: 'Il marchio di fatto' }, schedeDovute: 5 }]);
    renderRow();
    const row = await screen.findByRole('link', { name: /Ripassa 5 schede di «Segni distintivi»/ });
    expect(row).toHaveAttribute('href', '/studia/ripasso/sessione?corso=corso-1');
    expect(row).toHaveTextContent('Prima del modulo del giorno: Il marchio di fatto');
    // One row a course: the module is named after the cards, not offered as a second link before them.
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /^Modulo del giorno/ })).toBeNull();
  });

  it('draws nothing for a course with nothing today, and nothing when the read fails', async () => {
    today.mockResolvedValue([{ corsoId: 'corso-1', titolo: 'Segni distintivi', modulo: null, schedeDovute: 0 }]);
    const { container, unmount } = renderRow();
    // The read answered and drawn: what is empty is what the answer gave.
    await act(async () => {});
    expect(today).toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    unmount();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    today.mockRejectedValue({ status: 500 });
    const failed = renderRow();
    await act(async () => {});
    expect(warn).toHaveBeenCalled();
    expect(failed.container).toBeEmptyDOMElement();
    warn.mockRestore();
  });
});
