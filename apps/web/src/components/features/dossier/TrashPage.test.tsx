import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TrashPage } from './TrashPage';
import type { TrashEntry } from '../../../services/trashService';

const trash = (entries: TrashEntry[] | null, error: string | null = null) => ({
  entries, error, reload: vi.fn(), restore: vi.fn(), purge: vi.fn(),
});
const entry: TrashEntry = {
  id: 't3', kind: 'DOSSIER', dossierId: 'd9', label: 'Vecchia pratica', itemCount: 2,
  clientName: 'Claude Code', byApplication: true, deletedAt: '2026-10-04T10:00:00Z', expiresAt: '2026-11-03T10:00:00Z',
};

describe('TrashPage', () => {
  it('says the trash is empty, and what it is for', () => {
    render(<TrashPage trash={trash([])} onBack={() => {}} showToast={() => {}} />);
    expect(screen.getByText('Il cestino è vuoto')).toBeInTheDocument();
    expect(screen.getByText(/resta qui 30 giorni/)).toBeInTheDocument();
  });
  it('says what the user removes passes through it too: dossiers, entries of a dossier and study cards (question 181)', () => {
    render(<TrashPage trash={trash([])} onBack={() => {}} showToast={() => {}} />);
    const note = screen.getByText(/resta qui 30 giorni/);
    expect(note).toHaveTextContent('come ciò che elimini tu: le pratiche, le voci che togli da una pratica, le schede di studio.');
    expect(note).not.toHaveTextContent('non passano di qui');
    expect(screen.getByText(/nessuna pratica, voce o scheda di studio eliminati da te/)).toBeInTheDocument();
  });
  it('lists every entry', () => {
    render(<TrashPage trash={trash([entry])} onBack={() => {}} showToast={() => {}} />);
    expect(screen.getByText('Pratica «Vecchia pratica»')).toBeInTheDocument();
  });
  it('says when the trash is out of reach', () => {
    render(<TrashPage trash={trash(null, 'Il cestino non è raggiungibile in questo momento.')} onBack={() => {}} showToast={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('non è raggiungibile');
  });
});

describe('TrashPage, «Elimina definitivamente» (LC85, Papiniano on #585)', () => {
  const second: TrashEntry = { ...entry, id: 't4', label: 'Altra pratica' };
  type Run = { el: Element; keyframes: Keyframe[] };
  let runs: Run[] = [];
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.restoreAllMocks();
  });
  function Page({ start = [entry, second] }: { start?: TrashEntry[] }) {
    const [entries, setEntries] = useState<TrashEntry[]>(start);
    const purge = vi.fn(async (e: TrashEntry) => {
      setEntries((now) => now.filter((x) => x.id !== e.id));
      return true;
    });
    return <TrashPage trash={{ entries, error: null, reload: vi.fn(), restore: vi.fn(), purge }} onBack={() => {}} showToast={() => {}} />;
  }
  function setup(start?: TrashEntry[]) {
    runs = [];
    Object.defineProperty(Element.prototype, 'animate', {
      value: function (this: Element, keyframes: Keyframe[]) {
        runs.push({ el: this, keyframes });
        return { cancel: () => {}, onfinish: null, effect: { target: this } };
      },
      configurable: true,
      writable: true,
    });
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const own = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      // The row's 27 × 27 icon at the right (Papiniano's numbers), the card 384 × 200 in the middle.
      if (this.getAttribute('aria-label') === 'Elimina definitivamente Pratica «Vecchia pratica»') return rect(1316, 246, 27, 27);
      if (this.getAttribute('role') === 'alertdialog') return rect(528, 350, 384, 200);
      return own.call(this);
    });
    render(<Page start={start} />);
    return screen.getByRole('button', { name: 'Elimina definitivamente Pratica «Vecchia pratica»' });
  }

  it('grows out of the button even when its click focused nothing (a screen reader, Safari), and gives it the focus back on «Annulla»', async () => {
    const button = setup();
    // `fireEvent.click` focuses nothing: the case Papiniano saw, the dialog centred and fading.
    fireEvent.click(button);
    const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare definitivamente?' });
    const shape = dialog.querySelector('[data-island-shape]')!;
    expect(runs.find((run) => run.el === shape)?.keyframes[0]).toMatchObject({ top: '-104px', left: '788px', right: '-431px', bottom: '277px' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('confirmed, the focus waits on the row, then goes to the next one once the row has left: never the body', async () => {
    const button = setup();
    fireEvent.click(button);
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Elimina definitivamente' }));
    });
    await waitFor(() => expect(screen.queryByText('Pratica «Vecchia pratica»')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ripristina Pratica «Altra pratica»' })).toHaveFocus());
  });

  // LC106: the list sits inside `PageFrame`, a level deeper than the way back.
  it('confirmed on the last entry, the focus goes to «Indietro»: never the body', async () => {
    const button = setup([entry]);
    fireEvent.click(button);
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Elimina definitivamente' }));
    });
    await waitFor(() => expect(screen.queryByText('Pratica «Vecchia pratica»')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Indietro' })).toHaveFocus());
  });
});

// LC106, the consultant on #640: one height for the trash's controls, and no focus left on the body after a restore.
describe('TrashPage, the controls and the restore (LC106)', () => {
  it('gives every control `Button`\'s height: 44 px on a phone, 36 from md', () => {
    render(<TrashPage trash={trash([entry])} onBack={() => {}} showToast={() => {}} />);
    for (const button of screen.getAllByRole('button')) {
      if (button.textContent?.includes('Indietro')) continue;
      expect(button).toHaveClass('min-h-11', 'md:min-h-9');
    }
  });

  it('restored, the entry leaves and the focus goes to the title, never the body', async () => {
    function Page() {
      const [entries, setEntries] = useState<TrashEntry[]>([entry]);
      const restore = vi.fn(async () => {
        setEntries([]);
        return { kind: 'restored' as const };
      });
      return <main><TrashPage trash={{ entries, error: null, reload: vi.fn(), restore, purge: vi.fn() }} onBack={() => {}} showToast={() => {}} /></main>;
    }
    render(<Page />);
    const button = screen.getByRole('button', { name: 'Ripristina Pratica «Vecchia pratica»' });
    button.focus();
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(screen.queryByText('Pratica «Vecchia pratica»')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Cestino' })).toHaveFocus());
  });
});
