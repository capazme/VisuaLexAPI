import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProposalCard, type ProposalCardProps } from './ProposalCard';
import type { AssistantNote } from '../../../types';
import { aiNote } from '../../../utils/__fixtures__/assistantNote';

/** `note: null`: a mark with no note. */
function setup(over: Partial<AssistantNote> | { note: null } = {}) {
  const note = 'note' in over && over.note === null ? null : aiNote('Il danno da inadempimento.', 'proposed', over as Partial<AssistantNote>);
  const props: ProposalCardProps = {
    highlight: {
      id: 'p1', normaKey: 'k', articleId: '1', rangeSerialized: '', text: 'risarcimento del danno', color: 'green', startOffset: 10,
      proposal: { clientName: 'Claude Code', note },
    },
    onValidate: vi.fn(), onFlag: vi.fn(), onReviewComment: vi.fn(), onEditNote: vi.fn(), onRemove: vi.fn(),
  };
  const utils = render(<ProposalCard {...props} />);
  return { ...utils, props };
}

describe('ProposalCard', () => {
  it('shows the passage, the note on it and what to do with it', () => {
    const { props } = setup();
    expect(screen.getByText(/risarcimento del danno/)).toBeInTheDocument();
    expect(screen.getByText('Il danno da inadempimento.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: "Proposto dall'IA, confermi?" }));
    expect(props.onValidate).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Da rivedere' }));
    expect(props.onFlag).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi il passaggio' }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it('the pencil edits the note in place; a changed text is saved, trimmed', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Modifica la nota del passaggio' }));
    const box = screen.getByRole('textbox', { name: 'Nota del passaggio' });
    expect(box).toHaveValue('Il danno da inadempimento.');
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: ' Il danno contrattuale. ' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(props.onEditNote).toHaveBeenCalledWith('Il danno contrattuale.');
    expect(screen.queryByRole('textbox', { name: 'Nota del passaggio' })).toBeNull();
  });

  it('an unchanged or empty text, or Esc, saves nothing', () => {
    const { props } = setup();
    const edit = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Modifica la nota del passaggio' }));
      return screen.getByRole('textbox', { name: 'Nota del passaggio' });
    };
    fireEvent.blur(edit());
    let box = edit();
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.blur(box);
    box = edit();
    fireEvent.change(box, { target: { value: 'Altro' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(props.onEditNote).not.toHaveBeenCalled();
    expect(screen.getByText('Il danno da inadempimento.')).toBeInTheDocument();
  });

  it('a passage without a note is a mark of known origin: no checkbox, no flag, no pencil, only the bin', () => {
    const { props } = setup({ note: null });
    expect(screen.getByText(/risarcimento del danno/)).toBeInTheDocument();
    expect(screen.getByText("Evidenziato dall'IA")).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Rimuovi il passaggio']);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi il passaggio' }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it('a note the user emptied is still the application\'s, with its state', () => {
    setup({ text: '', edited: true, state: 'validated' });
    expect(screen.getByRole('checkbox', { name: 'Validato, modificato da te' })).toBeChecked();
  });

  it('a note the user changed: «Validato, modificato da te» and the application\'s own one click away', () => {
    setup({ state: 'validated', text: 'La mia nota.', edited: true });
    expect(screen.getByRole('checkbox', { name: 'Validato, modificato da te' })).toBeChecked();
    expect(screen.getByText('La mia nota.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Vedi la versione dell'IA" }));
    expect(screen.getByText('Il danno da inadempimento.')).toBeInTheDocument();
  });
});
