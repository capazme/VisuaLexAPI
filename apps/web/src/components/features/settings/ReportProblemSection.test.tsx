import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportProblemSection } from './ReportProblemSection';

const submitFeedback = vi.hoisted(() => vi.fn());
vi.mock('../../../services/feedbackService', () => ({ submitFeedback: (data: unknown) => submitFeedback(data) }));

describe('ReportProblemSection (LC92)', () => {
  // Braces: a function returned by beforeEach is run as its teardown.
  beforeEach(() => {
    submitFeedback.mockReset();
  });

  it('names the type group «Tipo di segnalazione», with «Bug» chosen', () => {
    render(<ReportProblemSection />);
    const group = screen.getByRole('group', { name: 'Tipo di segnalazione' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Bug', 'Suggerimento', 'Altro']);
    expect(within(group).getByRole('button', { name: 'Bug' })).toHaveAttribute('aria-pressed', 'true');
  });

  // jsdom cannot measure: the classes are the check. At 390 px the three buttons did not fit on one row.
  it('lets the three type buttons wrap instead of overflowing a narrow column', () => {
    render(<ReportProblemSection />);
    const group = screen.getByRole('group', { name: 'Tipo di segnalazione' });
    expect(group).toHaveClass('flex-wrap');
    for (const button of within(group).getAllByRole('button')) expect(button).toHaveClass('flex-auto');
  });

  it('tells a screen reader which type is chosen', () => {
    render(<ReportProblemSection />);
    const group = screen.getByRole('group', { name: 'Tipo di segnalazione' });
    const pressed = () => within(group).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'));
    fireEvent.click(within(group).getByRole('button', { name: 'Suggerimento' }));
    expect(pressed()).toEqual(['false', 'true', 'false']);
  });

  it('sends the report and confirms it in the page, with no dialog', async () => {
    submitFeedback.mockResolvedValue({ id: '1', type: 'bug', message: 'x', status: 'new', created_at: '' });
    render(<ReportProblemSection />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByLabelText('Descrizione'), { target: { value: '  La ricerca non risponde  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia' }));
    const confirmation = await screen.findByRole('status');
    expect(confirmation).toHaveTextContent('Grazie, la segnalazione è arrivata.');
    // The focus follows the flow: to the confirmation, then back to the text, never the body.
    // It comes in a passive effect, which may run after the confirmation is drawn (a busy machine): wait for it.
    await waitFor(() => expect(confirmation).toHaveFocus());
    expect(submitFeedback).toHaveBeenCalledWith({ type: 'bug', message: 'La ricerca non risponde' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "Scrivi un'altra segnalazione" }));
    expect(screen.getByLabelText('Descrizione')).toHaveValue('');
    expect(screen.getByLabelText('Descrizione')).toHaveFocus();
  });

  it('says what went wrong when the report is not sent, and keeps the text', async () => {
    submitFeedback.mockRejectedValue({ status: 503, message: 'Rete assente' });
    render(<ReportProblemSection />);
    fireEvent.change(screen.getByLabelText('Descrizione'), { target: { value: 'La ricerca non risponde' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invia' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Rete assente');
    expect(screen.getByLabelText('Descrizione')).toHaveValue('La ricerca non risponde');
  });
});
