import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DossierItem } from '../../../types';
import { DossierNoteList } from './DossierNoteList';

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
});
