import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TestoDaAccettare } from '../../../types/studia';
import { AcceptTextDialog } from './AcceptTextDialog';

// Made up on purpose: nothing of the notice's wording lives in the web app.
const TEXT: TestoDaAccettare = {
  id: 'v1',
  chiave: 'PROPOSTA_SCHEDA',
  versione: 1,
  titolo: 'Titolo di prova',
  corpo: 'Uno.\n\nDue.',
  conferma: 'Spunta di prova',
  azione: 'Vai di prova',
};

function renderDialog(text: TestoDaAccettare = TEXT) {
  const onAccept = vi.fn();
  const onCancel = vi.fn();
  const view = render(<AcceptTextDialog text={text} onAccept={onAccept} onCancel={onCancel} />);
  return { onAccept, onCancel, ...view };
}

describe('AcceptTextDialog', () => {
  it('draws the version it is given: title, checkbox label and button label', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Titolo di prova' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('checkbox', { name: 'Spunta di prova' })).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Vai di prova' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
  });

  it('splits the body into paragraphs on blank lines', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const paragraphs = Array.from(dialog.querySelectorAll('p')).map((p) => p.textContent);
    expect(paragraphs).toEqual(['Uno.', 'Due.']);
  });

  it('keeps a single line break inside a paragraph and ignores blank lines of spaces and CRLF', () => {
    renderDialog({ ...TEXT, corpo: 'A\r\nB\r\n  \r\n\r\nC' });
    const dialog = screen.getByRole('dialog');
    expect(Array.from(dialog.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['A\nB', 'C']);
  });

  it('renders markup in the body as literal text', () => {
    renderDialog({ ...TEXT, corpo: '<b>x</b>\n\n<img src=x onerror=alert(1)>' });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('<b>x</b>')).toBeInTheDocument();
    expect(dialog.querySelector('b')).toBeNull();
    expect(dialog.querySelector('img')).toBeNull();
  });

  it('renders markup in the title and in the labels as literal text', () => {
    renderDialog({ ...TEXT, titolo: '<i>t</i>', conferma: '<u>c</u>', azione: '<s>a</s>' });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: '<u>c</u>' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '<s>a</s>' })).toBeInTheDocument();
    expect(dialog.querySelector('i, u, s')).toBeNull();
  });

  it('keeps the button disabled until the box is ticked, then accepts that version', async () => {
    const user = userEvent.setup();
    const { onAccept } = renderDialog();
    const button = screen.getByRole('button', { name: 'Vai di prova' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onAccept).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: 'Spunta di prova' }));
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onAccept).toHaveBeenCalledWith('v1');
  });

  it('cancels with «Annulla»', async () => {
    const user = userEvent.setup();
    const { onCancel, onAccept } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('shows a newer version when one arrives and unticks the box', async () => {
    const user = userEvent.setup();
    const { rerender, onAccept, onCancel } = renderDialog();
    await user.click(screen.getByRole('checkbox', { name: 'Spunta di prova' }));
    expect(screen.getByRole('button', { name: 'Vai di prova' })).toBeEnabled();

    const second: TestoDaAccettare = { ...TEXT, id: 'v2', versione: 2, titolo: 'Seconda versione', corpo: 'Nuovo.', conferma: 'Spunta nuova', azione: 'Vai nuovo' };
    rerender(<AcceptTextDialog text={second} onAccept={onAccept} onCancel={onCancel} />);

    expect(screen.getByRole('dialog', { name: 'Seconda versione' })).toBeInTheDocument();
    expect(screen.getByText('Nuovo.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Spunta nuova' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Vai nuovo' })).toBeDisabled();
  });

  it('on a newer version moves the focus to the box and says the text changed, politely; not on first open', async () => {
    const user = userEvent.setup();
    const { rerender, onAccept, onCancel } = renderDialog();
    const note = 'Il testo è cambiato nel frattempo: rileggilo e conferma.';
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    await user.click(screen.getByRole('checkbox', { name: 'Spunta di prova' }));
    screen.getByRole('button', { name: 'Vai di prova' }).focus();

    const second: TestoDaAccettare = { ...TEXT, id: 'v2', versione: 2, conferma: 'Spunta nuova', azione: 'Vai nuovo' };
    rerender(<AcceptTextDialog text={second} onAccept={onAccept} onCancel={onCancel} />);

    expect(screen.getByRole('status')).toHaveTextContent(note);
    expect(screen.getByRole('checkbox', { name: 'Spunta nuova' })).toHaveFocus();
  });

  it('keeps the note when the same version is drawn again', () => {
    const { rerender, onAccept, onCancel } = renderDialog();
    rerender(<AcceptTextDialog text={{ ...TEXT }} onAccept={onAccept} onCancel={onCancel} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('gives its buttons a 44 px target at every width, the small button\'s 32 px from `md` replaced', () => {
    renderDialog();
    for (const name of ['Annulla', 'Vai di prova']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('min-h-[44px]', 'md:min-h-[44px]');
      expect(button).not.toHaveClass('md:min-h-8');
      expect(button).not.toHaveClass('md:min-h-0');
    }
  });

  it('disables the button while the acceptance is being sent', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<AcceptTextDialog text={TEXT} onAccept={onAccept} onCancel={vi.fn()} busy />);
    await user.click(screen.getByRole('checkbox', { name: 'Spunta di prova' }));
    expect(screen.getByRole('button', { name: 'Vai di prova' })).toBeDisabled();
  });
});
