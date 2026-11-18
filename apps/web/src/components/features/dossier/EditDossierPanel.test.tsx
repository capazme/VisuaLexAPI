import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditDossierPanel } from './EditDossierPanel';
import type { Dossier } from '../../../types';

const dossier = (extra: Partial<Dossier> = {}): Dossier => ({ id: 'd', title: 'GDPR', createdAt: '2026-10-14', items: [], ...extra });

function Harness({ onSave = () => {}, value = dossier() }: { onSave?: (...args: unknown[]) => void; value?: Dossier }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Modifica</button>
      <EditDossierPanel dossier={open ? value : null} onClose={() => setOpen(false)} onSave={onSave} />
      <p>Le fonti</p>
    </>
  );
}

const open = () => {
  const command = screen.getByRole('button', { name: 'Modifica' });
  command.focus();
  fireEvent.click(command);
  return command;
};

describe('EditDossierPanel — the kind', () => {
  it('starts from the dossier\'s kind and saves the one chosen', () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} value={dossier({ kind: 'studio' })} />);
    open();
    expect(screen.getByRole('radio', { name: /Di studio/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Di lavoro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith('GDPR', '', [], 'lavoro');
  });

  it('reads a dossier with no kind as di lavoro', () => {
    render(<Harness />);
    open();
    expect(screen.getByRole('radio', { name: /Di lavoro/ })).toBeChecked();
  });
});

describe('EditDossierPanel — in the page (LC107, L-73)', () => {
  it('opens in the flow, before what follows, with the focus on its space and no dialog', () => {
    render(<Harness />);
    open();
    const region = screen.getByRole('region', { name: 'Modifica pratica' });
    expect(region).toHaveFocus();
    expect(region.compareDocumentPosition(screen.getByText('Le fonti')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Esc and gives the focus back to «Modifica»', () => {
    render(<Harness />);
    const command = open();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Titolo' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Modifica pratica' })).toBeNull();
    expect(command).toHaveFocus();
  });

  it('starts again from the dossier after «Annulla»', () => {
    render(<Harness />);
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Titolo' }), { target: { value: 'Altro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    open();
    expect(screen.getByRole('textbox', { name: 'Titolo' })).toHaveValue('GDPR');
  });
});
