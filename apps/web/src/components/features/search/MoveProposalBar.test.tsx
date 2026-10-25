import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { MoveProposalBar } from './MoveProposalBar';
import { rangeFromPlainOffsets } from '../../../utils/selectionOffset';

// D7b: a passage's new words, selected in the reader's text and read as a highlight of the user's is.
const TEXT = 'Qualunque fatto doloso o colposo, che cagiona ad altri un danno ingiusto, obbliga colui che ha commesso il fatto a risarcire il danno.';

function mount(startOffset = TEXT.indexOf('danno ingiusto'), text = 'danno ingiusto') {
  const root = document.createElement('div');
  root.innerHTML = `<div class="vlx-b">${TEXT}</div>`;
  document.body.append(root);
  const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
  ref.current = root;
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<MoveProposalBar textRootRef={ref} proposalId="p1" startOffset={startOffset} text={text} onSave={onSave} onCancel={onCancel} />);
  return { ...utils, root, onSave, onCancel };
}

/** Selects the projection's span, as the user would, and tells the bar (jsdom fires no `selectionchange`). */
function select(root: HTMLElement, start: number, end: number) {
  const range = rangeFromPlainOffsets(root, start, end)!;
  const selection = window.getSelection()!;
  act(() => {
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

const moveHere = () => screen.getByRole('button', { name: 'Sposta qui' });

afterEach(() => {
  // Unmounted first: the bar is portalled into the body this clears.
  cleanup();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('MoveProposalBar', () => {
  it('opens with the passage\'s words selected, the focus on it, «Sposta qui» waiting for a change', () => {
    mount();
    expect(window.getSelection()!.toString()).toBe('danno ingiusto');
    expect(screen.getByRole('group', { name: "Sposta l'evidenziazione" })).toHaveFocus();
    expect(screen.getByText(/“danno ingiusto”/)).toBeInTheDocument();
    expect(moveHere()).toBeDisabled();
  });

  it('saves the new words with their offset in the reader\'s projection, the text unchanged (root rule 23)', () => {
    const { root, onSave } = mount();
    const start = TEXT.indexOf('un danno ingiusto');
    select(root, start, start + 'un danno ingiusto'.length);
    expect(moveHere()).toBeEnabled();
    fireEvent.click(moveHere());
    expect(onSave).toHaveBeenCalledWith(start, 'un danno ingiusto');
    expect(TEXT.slice(start, start + 'un danno ingiusto'.length)).toBe('un danno ingiusto');
  });

  it('Enter saves, Esc leaves; Enter on a button is the button\'s', () => {
    const { root, onSave, onCancel } = mount();
    select(root, 0, 'Qualunque fatto'.length);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Annulla' }), { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith(0, 'Qualunque fatto');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Maiusc+frecce move the chosen edge, a word at a time with Ctrl, wherever the focus is', () => {
    const modify = vi.fn();
    const proto = Object.getPrototypeOf(window.getSelection()!) as { modify?: unknown };
    const had = proto.modify;
    proto.modify = modify;
    try {
      mount();
      fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
      expect(modify).toHaveBeenLastCalledWith('extend', 'forward', 'character');
      fireEvent.keyDown(screen.getByRole('button', { name: 'Sposta la fine' }), { key: 'ArrowLeft', shiftKey: true, ctrlKey: true });
      expect(modify).toHaveBeenLastCalledWith('extend', 'backward', 'word');
      fireEvent.keyDown(document.body, { key: 'ArrowDown', shiftKey: true });
      expect(modify).toHaveBeenLastCalledWith('extend', 'forward', 'line');
      // Without Shift the arrows are the page's.
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(modify).toHaveBeenCalledTimes(3);
    } finally {
      proto.modify = had;
    }
  });

  it('«Sposta l\'inizio» puts the selection\'s moving end at its start', () => {
    mount();
    const start = screen.getByRole('button', { name: "Sposta l'inizio" });
    expect(start).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(start);
    expect(start).toHaveAttribute('aria-pressed', 'true');
    const selection = window.getSelection()!;
    const at = TEXT.indexOf('danno ingiusto');
    expect(selection.focusOffset).toBe(at);
    expect(selection.anchorOffset).toBe(at + 'danno ingiusto'.length);
    expect(selection.toString()).toBe('danno ingiusto');
  });

  it('refuses a selection outside the entry\'s text, and nothing selected', () => {
    const { root } = mount();
    const outside = document.createElement('p');
    outside.textContent = 'Altro testo della pagina';
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    act(() => {
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(screen.getAllByText('Seleziona le parole nel testo di questa voce.').length).toBeGreaterThan(0);
    expect(moveHere()).toBeDisabled();
    act(() => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(screen.getAllByText('Nessuna parola selezionata.').length).toBeGreaterThan(0);
    expect(moveHere()).toBeDisabled();
    expect(root.textContent).toBe(TEXT);
  });

  it('selects nothing where the stored words are no longer at their offset (a lost passage), and saves nothing on Enter', () => {
    const { onSave } = mount(TEXT.indexOf('colposo'), 'parole che non ci sono');
    expect(window.getSelection()!.isCollapsed || window.getSelection()!.rangeCount === 0).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('leaves a field, a dialog and a key already taken alone', () => {
    const { onCancel, onSave, root } = mount();
    const field = document.createElement('input');
    document.body.append(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    taken.preventDefault();
    document.body.dispatchEvent(taken);
    expect(onCancel).not.toHaveBeenCalled();
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    select(root, 0, 9);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    dialog.remove();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith(0, 'Qualunque');
  });

  it('a click in the text opens nothing while the words are chosen (a drag ends with one, on the passage itself)', () => {
    const { root } = mount();
    const opened = vi.fn();
    root.parentElement!.addEventListener('click', opened);
    fireEvent.click(root.querySelector('.vlx-b')!);
    expect(opened).not.toHaveBeenCalled();
  });

  it('starts with nothing selected for a passage whose words no longer land', () => {
    mount(TEXT.length + 10, 'parole sparite');
    expect(window.getSelection()!.isCollapsed || window.getSelection()!.rangeCount === 0).toBe(true);
    expect(moveHere()).toBeDisabled();
  });
});
