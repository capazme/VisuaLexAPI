import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextAtDateDialog, type TextAtDateDialogProps } from './TextAtDateDialog';

function setup(over: Partial<TextAtDateDialogProps> = {}) {
    const props: TextAtDateDialogProps = {
        isOpen: true, onClose: vi.fn(), onConfirm: vi.fn(), euAct: false, today: '2026-10-01', ...over,
    };
    render(<TextAtDateDialog {...props} />);
    return props;
}

const dateField = () => screen.getByLabelText('Data') as HTMLInputElement;
const confirm = () => screen.getByRole('button', { name: /Mostra il testo/ });
const type = (value: string) => fireEvent.change(dateField(), { target: { value } });

describe('TextAtDateDialog', () => {
    it('renders nothing while closed', () => {
        setup({ isOpen: false });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says what the date means and what it does not', () => {
        setup();
        expect(screen.getByRole('dialog', { name: 'Testo alla data' })).toBeInTheDocument();
        expect(screen.getByText('Normattiva mostra il testo in vigore in quel giorno.')).toBeInTheDocument();
        expect(screen.getByText(/non dice quale disciplina si applichi al fatto/)).toBeInTheDocument();
    });

    it('asks for the text in force on the day chosen', () => {
        const { onConfirm } = setup();
        expect(confirm()).toBeDisabled();
        type('2007-12-29');
        fireEvent.click(confirm());
        expect(onConfirm).toHaveBeenCalledWith({ kind: 'date', date: '2007-12-29' });
    });

    it('can be submitted with the keyboard', () => {
        const { onConfirm } = setup();
        type('2007-12-29');
        fireEvent.submit(dateField().closest('form')!);
        expect(onConfirm).toHaveBeenCalledWith({ kind: 'date', date: '2007-12-29' });
    });

    it('starts from the day it is given', () => {
        setup({ initialDate: '2005-06-01' });
        expect(dateField().value).toBe('2005-06-01');
    });

    it('starts from a day written in Italian, as a shared link may carry it', () => {
        const { onConfirm } = setup({ initialDate: '12 ottobre 2007' });
        expect(dateField().value).toBe('2007-10-12');
        fireEvent.click(confirm());
        expect(onConfirm).toHaveBeenCalledWith({ kind: 'date', date: '2007-10-12' });
    });

    it.each(['non è una data', '31 febbraio 2007', '2007-02-31', '2007'])('starts empty, with nothing to confirm, from "%s"', (initialDate) => {
        const { onConfirm } = setup({ initialDate });
        expect(dateField().value).toBe('');
        expect(confirm()).toBeDisabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('refuses a day after today however it was written', () => {
        setup({ initialDate: '25 dicembre 2999' });
        expect(dateField().value).toBe('2999-12-25');
        expect(screen.getByRole('alert')).toHaveTextContent('La data non può essere futura');
        expect(confirm()).toBeDisabled();
    });

    it('asks for the original text instead of a day', () => {
        const { onConfirm } = setup();
        type('2007-12-29');
        fireEvent.click(screen.getByLabelText('Testo originale'));
        expect(dateField()).toBeDisabled();
        fireEvent.click(confirm());
        expect(onConfirm).toHaveBeenCalledWith({ kind: 'original' });
    });

    it('does not let a future day be chosen, and says why', () => {
        const { onConfirm } = setup();
        expect(dateField()).toHaveAttribute('max', '2026-10-01');
        type('2026-10-02');
        expect(screen.getByRole('alert')).toHaveTextContent('La data non può essere futura: Normattiva mostrerebbe il testo attuale.');
        expect(confirm()).toBeDisabled();
        fireEvent.submit(dateField().closest('form')!);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('accepts today', () => {
        const { onConfirm } = setup();
        type('2026-10-01');
        fireEvent.click(confirm());
        expect(onConfirm).toHaveBeenCalledWith({ kind: 'date', date: '2026-10-01' });
    });

    it('refuses an EUR-Lex act with the reason and sends nothing', () => {
        const { onConfirm } = setup({ euAct: true });
        expect(screen.getByRole('alert')).toHaveTextContent('Atti dell’Unione europea: il testo a una data non è disponibile.');
        expect(dateField()).toBeDisabled();
        expect(screen.getByLabelText('Testo originale')).toBeDisabled();
        expect(confirm()).toBeDisabled();
        fireEvent.submit(dateField().closest('form')!);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('keeps a 44px touch target on mobile on every control', () => {
        setup();
        const target = ['min-h-[44px]', 'md:min-h-0'];
        expect(dateField()).toHaveClass(...target);
        expect(screen.getByLabelText('Testo originale').closest('label')).toHaveClass(...target);
        expect(screen.getByRole('button', { name: 'Annulla' })).toHaveClass(...target);
        expect(confirm()).toHaveClass(...target);
    });

    it('closes on cancel', () => {
        const { onClose } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
        expect(onClose).toHaveBeenCalled();
    });
});
