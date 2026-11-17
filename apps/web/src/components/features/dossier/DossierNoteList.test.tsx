import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DossierItem } from '../../../types';
import { DossierNoteList } from './DossierNoteList';
import { DossierNotesSection } from './DossierNotesSection';

type NoteItem = Extract<DossierItem, { type: 'note' }>;
const note = (id: string, data: string): NoteItem => ({ id, type: 'note', data, addedAt: '2026-11-10T09:00:00Z', aboutItemId: 'a1' });

/** A row of «Fonti» around the notes: its toggle, then the list; a removal takes the note away at once. */
function Row({ initial }: { initial: NoteItem[] }) {
  const [notes, setNotes] = useState(initial);
  return (
    <div data-dossier-item="a1">
      <div role="button" tabIndex={0} aria-expanded="true">art. 1453</div>
      <DossierNoteList notes={notes} onRemoveNote={(n) => setNotes((all) => all.filter((x) => x.id !== n.id))} />
    </div>
  );
}

const bins = () => screen.getAllByRole('button', { name: 'Rimuovi nota' });

describe('DossierNoteList: the focus after a removal from the keyboard (LC61)', () => {
  it('goes to the next note, then to the one before, then to the row: never the body', () => {
    render(<Row initial={[note('n1', 'Prima'), note('n2', 'Seconda'), note('n3', 'Terza')]} />);
    bins()[1].focus();
    fireEvent.click(bins()[1]);
    expect(screen.queryByText('Seconda')).toBeNull();
    expect(bins()[1]).toHaveFocus(); // «Terza»'s bin, now the second
    fireEvent.click(bins()[1]);
    expect(bins()[0]).toHaveFocus(); // «Prima»'s
    fireEvent.click(bins()[0]);
    expect(screen.getByRole('button', { name: 'art. 1453' })).toHaveFocus();
  });

  it('a removal by the mouse, the focus elsewhere, moves nothing', () => {
    render(<Row initial={[note('n1', 'Prima'), note('n2', 'Seconda')]} />);
    fireEvent.click(bins()[0]);
    expect(document.body).toHaveFocus();
  });

  it('the free notes of «Fonti»: the last one gone takes the section away, the focus goes to the next section\'s title', () => {
    function Page() {
      const [notes, setNotes] = useState([note('n1', 'Libera')]);
      return (
        <>
          <DossierNotesSection notes={notes.map((n) => ({ ...n, aboutItemId: undefined }))} onRemove={(n) => setNotes((all) => all.filter((x) => x.id !== n.id))} />
          <h2>Norme</h2>
        </>
      );
    }
    render(<Page />);
    bins()[0].focus();
    fireEvent.click(bins()[0]);
    expect(screen.queryByText('Libera')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Norme' })).toHaveFocus();
  });

  it('with no row around (a window), the last note gone hands the focus to the next title', () => {
    function Window() {
      const [notes, setNotes] = useState([note('n1', 'Unica')]);
      return (
        <>
          {notes.length > 0 && <section><h4>Note della pratica</h4><DossierNoteList notes={notes} onRemoveNote={() => setNotes([])} /></section>}
          <h3>Giurisprudenza</h3>
        </>
      );
    }
    render(<Window />);
    bins()[0].focus();
    fireEvent.click(bins()[0]);
    expect(screen.getByRole('heading', { name: 'Giurisprudenza' })).toHaveFocus();
  });
});
