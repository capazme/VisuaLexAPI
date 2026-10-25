import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../store/assistantProposals', () => ({
  setNoteEntryState: vi.fn(),
  editNoteEntryText: vi.fn(),
  // No write out: nothing busy.
  assistantProposalsStore: (select: (s: { busy: Record<string, true> }) => unknown) => select({ busy: {} }),
}));

import { setNoteEntryState, editNoteEntryText } from '../../../store/assistantProposals';
import { CurrentDossierContext } from './currentDossier';
import { DossierNotesSection } from './DossierNotesSection';
import type { AssistantNoteEntry, DossierItem } from '../../../types';

type NoteItem = Extract<DossierItem, { type: 'note' }>;
const review = (over: Partial<AssistantNoteEntry> = {}): AssistantNoteEntry => ({
  state: 'proposed', stateChangedAt: null, reviewComment: null, originalText: 'Sul danno.', edited: false, editedAt: null, editedBy: null, ...over,
});
const byApp: NoteItem = { id: 'n1', type: 'note', addedAt: '2026-10-25T09:00:00Z', data: 'Sul danno.', createdBy: { clientName: 'Claude Code' }, assistantNote: review() };
const mine: NoteItem = { id: 'n2', type: 'note', addedAt: '2026-10-25T09:00:00Z', data: 'Mia nota.', createdBy: null, assistantNote: null };

function renderNotes(notes: NoteItem[], onRemove = vi.fn()) {
  render(
    <CurrentDossierContext.Provider value="d1">
      <DossierNotesSection notes={notes} onRemove={onRemove} />
    </CurrentDossierContext.Provider>,
  );
  return onRemove;
}
const rowOf = (text: string) => screen.getByText(text).closest('li')!;

describe('the notes an application wrote in a dossier (D7b)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carry the checkbox, the flag, the pencil and the bin; the user\'s own keep their bin alone', () => {
    renderNotes([byApp, mine]);
    const app = within(rowOf('Sul danno.'));
    expect(app.getByRole('checkbox', { name: "Proposto dall'IA, confermi?" })).not.toBeChecked();
    expect(app.getByRole('button', { name: 'Da rivedere' })).toBeInTheDocument();
    expect(app.getByRole('button', { name: 'Modifica la nota' })).toBeInTheDocument();
    expect(app.getAllByRole('button', { name: 'Rimuovi nota' })).toHaveLength(1);
    // Who wrote it is not drawn: its validation says it (D7b).
    expect(app.queryByText(/Claude Code/)).toBeNull();
    const own = within(rowOf('Mia nota.'));
    expect(own.queryByRole('checkbox')).toBeNull();
    expect(own.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Rimuovi nota']);
  });

  it('validate and flag go through the entry\'s route', () => {
    renderNotes([byApp]);
    fireEvent.click(screen.getByRole('checkbox', { name: "Proposto dall'IA, confermi?" }));
    expect(setNoteEntryState).toHaveBeenCalledWith('d1', byApp, 'validated');
    fireEvent.click(screen.getByRole('button', { name: 'Da rivedere' }));
    expect(setNoteEntryState).toHaveBeenLastCalledWith('d1', byApp, 'review');
  });

  it('flagged, «Cosa non va?» goes with it', () => {
    renderNotes([{ ...byApp, assistantNote: review({ state: 'review' }) }]);
    const field = screen.getByRole('textbox', { name: 'Cosa non va?' });
    fireEvent.change(field, { target: { value: 'Il comma è un altro.' } });
    fireEvent.blur(field);
    expect(setNoteEntryState).toHaveBeenCalledWith('d1', expect.objectContaining({ id: 'n1' }), 'review', 'Il comma è un altro.');
  });

  it('the pencil edits the words in place; a changed text is saved', () => {
    renderNotes([byApp]);
    fireEvent.click(screen.getByRole('button', { name: 'Modifica la nota' }));
    const box = screen.getByRole('textbox', { name: 'Testo della nota' });
    expect(box).toHaveValue('Sul danno.');
    expect(screen.queryByText('Sul danno.', { selector: 'p' })).toBeNull();
    fireEvent.change(box, { target: { value: 'Sul danno ingiusto.' } });
    // Leaving the box saves nothing: «Salva» (or Enter) does.
    fireEvent.blur(box);
    expect(editNoteEntryText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(editNoteEntryText).toHaveBeenCalledWith('d1', byApp, 'Sul danno ingiusto.');
  });

  it('a changed text is not dropped by «Annulla» without asking', () => {
    renderNotes([byApp]);
    fireEvent.click(screen.getByRole('button', { name: 'Modifica la nota' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Testo della nota' }), { target: { value: 'Altro.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Scartare la modifica?');
    fireEvent.click(screen.getByRole('button', { name: 'Scarta' }));
    expect(screen.queryByRole('textbox', { name: 'Testo della nota' })).toBeNull();
    expect(editNoteEntryText).not.toHaveBeenCalled();
  });

  it('changed: «Validato, modificato da te», and the application\'s words one click away', () => {
    renderNotes([{ ...byApp, data: 'Mia versione.', assistantNote: review({ state: 'validated', edited: true }) }]);
    expect(screen.getByRole('checkbox', { name: 'Validato, modificato da te' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: "Vedi la versione dell'IA" }));
    expect(screen.getByText('Sul danno.')).toBeInTheDocument();
  });

  it('outside a dossier page, the words and the bin alone', () => {
    const onRemove = vi.fn();
    render(<DossierNotesSection notes={[byApp]} onRemove={onRemove} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi nota' }));
    expect(onRemove).toHaveBeenCalledWith(byApp);
  });

  it('its bin is the row\'s own removal', () => {
    const onRemove = renderNotes([byApp]);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi nota' }));
    expect(onRemove).toHaveBeenCalledWith(byApp);
  });
});
