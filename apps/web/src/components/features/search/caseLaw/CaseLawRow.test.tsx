import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { appStore } from '../../../../store/useAppStore';
import { CaseLawRow } from './CaseLawRow';

vi.mock('../../../../utils/decisionFetchCache', () => ({
  fetchDecisionCached: () => Promise.resolve({ esito: 'non_trovata', motivo: 'inesistente' }),
}));

const show = (ui: React.ReactElement) => render(<MemoryRouter><ul>{ui}</ul></MemoryRouter>);
const CASS = { corte: 'cassazione', archivio: 'civile', numero: 31191, anno: 2025 };

describe('CaseLawRow', () => {
  it('names the decision by its short label, as a link to its address', () => {
    show(<CaseLawRow decision={CASS} source="Massimario" />);
    expect(screen.getByText('Cass. civ., n. 31191/2025').closest('a')).toHaveAttribute('href', '/sentenze/cassazione-civile/31191/2025');
    expect(screen.getByText('Massimario')).toBeInTheDocument();
  });

  it('previews the decision, then opens it beside the article and records the way back', async () => {
    const open = vi.fn(() => 'tab');
    const push = vi.fn();
    const saved = appStore.getState();
    appStore.setState({ openDecision: open, pushReadingBack: push, readingBackStack: [] } as never);
    const back = { tabId: 't1', blockId: 'b1', articleId: 'a1', label: 'art. 2043 c.c.' };
    render(<MemoryRouter initialEntries={['/']}><ul><CaseLawRow decision={CASS} besideId="t1" backEntry={back} /></ul></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByText('Cass. civ., n. 31191/2025')); });
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apri accanto' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ numero: 31191 }), { fromLink: true, besideId: 't1' });
    expect(push).toHaveBeenCalledExactlyOnceWith(back);
    appStore.setState({ openDecision: saved.openDecision, pushReadingBack: saved.pushReadingBack } as never);
  });

  it('is a plain label when the data cannot make an address', () => {
    show(<CaseLawRow decision={{ ...CASS, anno: null }} />);
    expect(screen.getByText('Cass. civ., n. 31191').closest('a')).toBeNull();
    show(<CaseLawRow label="Cons. Stato" detail="n. 10/2020" />);
    expect(screen.getByText('Cons. Stato').closest('a')).toBeNull();
    expect(screen.getByText('n. 10/2020')).toBeInTheDocument();
  });

  it('shows the exact date when known, else the year', () => {
    show(<CaseLawRow label="A" date="2026-09-01" year={2026} />);
    expect(screen.getByText('1 settembre 2026')).toHaveAttribute('datetime', '2026-09-01');
    show(<CaseLawRow label="B" year={2019} />);
    expect(screen.getByText('2019').tagName).toBe('TIME');
    show(<CaseLawRow label="C" />);
    expect(screen.getAllByRole('listitem')[2].querySelector('time')).toBeNull();
  });

  it('takes the date as the caller words it', () => {
    show(<CaseLawRow label="A" date="2026-09-01" whenLabel="Ordinanza depositata il 1 settembre 2026" />);
    expect(screen.getByText('Ordinanza depositata il 1 settembre 2026')).toBeInTheDocument();
  });

  it('shows the badges and the footer', () => {
    show(<CaseLawRow label="A" badges={['Conclusioni AG']} footer={<p>Fonte: X</p>} />);
    expect(screen.getByText('Conclusioni AG')).toBeInTheDocument();
    expect(screen.getByText('Fonte: X')).toBeInTheDocument();
  });

  it('colours the chip by court, one key for every source', () => {
    show(<CaseLawRow label="Cass. civ." /> );
    show(<CaseLawRow label="Corte cost." />);
    expect(screen.getByText('Cass. civ.')).toHaveClass('bg-primary-100');
    expect(screen.getByText('Corte cost.')).toHaveClass('bg-purple-100');
  });
});

describe('CaseLawRow — the cut text', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cuts the text at three lines', () => {
    show(<CaseLawRow label="A">Un testo breve.</CaseLawRow>);
    expect(screen.getByText('Un testo breve.')).toHaveClass('line-clamp-3');
    expect(screen.queryByRole('button', { name: 'Mostra tutto' })).toBeNull();
  });

  it('where nothing can be measured, a long text offers «Mostra tutto» and a short one does not', () => {
    show(<CaseLawRow label="A">{'parola '.repeat(60)}</CaseLawRow>);
    expect(screen.getByRole('button', { name: 'Mostra tutto' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens and closes the text, naming it for the screen reader', () => {
    show(<CaseLawRow label="A"><span data-testid="t">{'parola '.repeat(60)}</span></CaseLawRow>);
    const more = screen.getByRole('button', { name: 'Mostra tutto' });
    const paragraph = screen.getByTestId('t').parentElement!;
    expect(more).toHaveAttribute('aria-controls', paragraph.id);
    fireEvent.click(more);
    expect(paragraph).not.toHaveClass('line-clamp-3');
    const less = screen.getByRole('button', { name: 'Mostra meno' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(less);
    expect(paragraph).toHaveClass('line-clamp-3');
  });

  it('measures the cut where the browser can: a text that fits three lines has no button, however long', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(60);
    const view = show(<CaseLawRow label="A">{'parola '.repeat(60)}</CaseLawRow>);
    expect(screen.queryByRole('button', { name: 'Mostra tutto' })).toBeNull();
    view.unmount();
    scroll.mockReturnValue(120);
    show(<CaseLawRow label="A">Corto ma a capo.</CaseLawRow>);
    expect(screen.getByRole('button', { name: 'Mostra tutto' })).toBeInTheDocument();
  });

  it('makes the button a 44 px target on a phone', () => {
    show(<CaseLawRow label="A">{'parola '.repeat(60)}</CaseLawRow>);
    expect(screen.getByRole('button', { name: 'Mostra tutto' })).toHaveClass('min-h-[44px]', 'md:min-h-0');
  });
});
