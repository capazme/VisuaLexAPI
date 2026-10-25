import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AiReviewControls, type AiReviewControlsProps } from './AiReviewControls';

function setup(over: Partial<AiReviewControlsProps> = {}) {
  const props: AiReviewControlsProps = {
    state: 'proposed', edited: false, original: null, reviewComment: null,
    onValidate: vi.fn(), onFlag: vi.fn(), onReviewComment: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(),
    editLabel: 'Modifica la nota del passaggio', removeLabel: 'Rimuovi il passaggio',
    ...over,
  };
  const utils = render(<AiReviewControls {...props} />);
  return { ...utils, props };
}
const tickOf = (box: HTMLElement) => box.nextElementSibling?.querySelector('svg') ?? null;

describe('AiReviewControls', () => {
  it('«da validare»: an unticked checkbox asks to confirm, the flag is off, no field', () => {
    setup();
    const box = screen.getByRole('checkbox', { name: "Proposto dall'IA, confermi?" });
    expect(box).not.toBeChecked();
    expect(tickOf(box)).toBeNull();
    expect(screen.getByRole('button', { name: 'Da rivedere' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('textbox', { name: 'Cosa non va?' })).toBeNull();
  });

  it('a tick validates; unticked, it goes back', () => {
    const { props, rerender } = setup();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(props.onValidate).toHaveBeenCalledWith(true);
    rerender(<AiReviewControls {...props} state="validated" />);
    const box = screen.getByRole('checkbox', { name: 'Validato' });
    expect(box).toBeChecked();
    expect(tickOf(box)).not.toBeNull();
    expect(screen.queryByText("Proposto dall'IA, confermi?")).toBeNull();
    fireEvent.click(box);
    expect(props.onValidate).toHaveBeenLastCalledWith(false);
  });

  it('a changed text, validated, says so', () => {
    setup({ state: 'validated', edited: true, original: 'La versione di Claude.' });
    expect(screen.getByRole('checkbox', { name: 'Validato, modificato da te' })).toBeChecked();
  });

  it('the flag marks it «Da rivedere», with its short field; pressed again, it goes back', () => {
    const { props, rerender } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Da rivedere' }));
    expect(props.onFlag).toHaveBeenCalledWith(true);
    rerender(<AiReviewControls {...props} state="review" />);
    const flag = screen.getByRole('button', { name: 'Da rivedere' });
    expect(flag).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Da rivedere', { selector: 'p' })).toBeInTheDocument();
    // Still unticked: the checkbox validates from here too.
    expect(screen.getByRole('checkbox', { name: "Proposto dall'IA, confermi?" })).not.toBeChecked();
    fireEvent.click(flag);
    expect(props.onFlag).toHaveBeenLastCalledWith(false);
  });

  it('«Cosa non va?» is saved as the field is left, or on Enter, only when changed', () => {
    const { props } = setup({ state: 'review', reviewComment: 'Manca il comma 2.' });
    const field = screen.getByRole('textbox', { name: 'Cosa non va?' });
    expect(field).toHaveValue('Manca il comma 2.');
    fireEvent.blur(field);
    expect(props.onReviewComment).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '  Manca il comma 3.  ' } });
    fireEvent.blur(field);
    expect(props.onReviewComment).toHaveBeenCalledWith('Manca il comma 3.');
  });

  it('«Cosa non va?» shows the server\'s words again when they change, and an emptied field sends nothing', () => {
    const { props, rerender } = setup({ state: 'review', reviewComment: null });
    expect(screen.getByRole('textbox', { name: 'Cosa non va?' })).toHaveValue('');
    rerender(<AiReviewControls {...props} state="review" reviewComment="Manca il comma 2." />);
    const field = screen.getByRole('textbox', { name: 'Cosa non va?' });
    expect(field).toHaveValue('Manca il comma 2.');
    expect(field).toHaveAttribute('maxLength', '500');
    fireEvent.change(field, { target: { value: '  ' } });
    fireEvent.blur(field);
    expect(props.onReviewComment).not.toHaveBeenCalled();
    // The words the server keeps come back: they were not cleared.
    expect(field).toHaveValue('Manca il comma 2.');
  });

  it('Enter in «Cosa non va?» saves it', () => {
    const { props } = setup({ state: 'review' });
    const field = screen.getByRole('textbox', { name: 'Cosa non va?' });
    field.focus();
    fireEvent.change(field, { target: { value: 'Non è il passo giusto.' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(props.onReviewComment).toHaveBeenCalledWith('Non è il passo giusto.');
  });

  it('the pencil and the bin, named after what they act on', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Modifica la nota del passaggio' }));
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi il passaggio' }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it('«Vedi la versione dell\'IA» only once the text was changed, and shows the original', () => {
    const { unmount } = setup();
    expect(screen.queryByRole('button', { name: "Vedi la versione dell'IA" })).toBeNull();
    unmount();
    setup({ state: 'validated', edited: true, original: 'La versione di Claude.' });
    const link = screen.getByRole('button', { name: "Vedi la versione dell'IA" });
    expect(link).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('La versione di Claude.')).toBeNull();
    fireEvent.click(link);
    expect(screen.getByText('La versione di Claude.')).toBeInTheDocument();
    const shown = screen.getByRole('button', { name: "Nascondi la versione dell'IA" });
    expect(shown).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(shown.getAttribute('aria-controls')!)).toContainElement(screen.getByText('La versione di Claude.'));
  });

  it('every control has a 44 px target at every width', () => {
    setup({ state: 'review', original: 'x' });
    const targets = [
      screen.getByRole('checkbox').closest('label')!,
      ...screen.getAllByRole('button'),
      screen.getByRole('textbox'),
    ];
    for (const el of targets) {
      expect(el.className, el.outerHTML.slice(0, 60)).toMatch(/(^| )min-h-\[44px\]( |$)/);
      expect(el.className).not.toMatch(/md:min-h-0/);
    }
  });
});
