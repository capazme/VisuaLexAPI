import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionReference } from '../../../types/decisions';

// The view reads the decision; its fetch, candidates and Cronologia are DecisionEntryView's tests.
const entryViews = vi.fn();
vi.mock('../decisions/DecisionEntryView', () => ({
  DecisionEntryView: (props: { practiceId: string; decisionId: string; reference: DecisionReference; hostId: string }) => {
    entryViews(props);
    return <div data-testid="entry-view">{props.decisionId}</div>;
  },
}));

import { appStore } from '../../../store/useAppStore';
import { decisionRowKey } from '../../../utils/practice';
import { PracticeDecisionsSection } from './PracticeDecisionsSection';

const s = () => appStore.getState();
const OLD: DecisionReference = { corte: 'cassazione', archivio: 'civile', numero: 577, anno: 2008 };
const NEW: DecisionReference = { corte: 'cassazione', archivio: 'civile', numero: 28994, anno: 2019 };
const UNREAD: DecisionReference = { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 };

beforeEach(() => {
  entryViews.mockReset();
  appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [] });
});

const rowNames = () => screen.getAllByRole('button', { name: /^(Espandi|Comprimi) / }).map((b) => b.getAttribute('aria-label'));

describe('PracticeDecisionsSection (spec §3.3)', () => {
  it('draws nothing when the practice holds no decision', () => {
    const practiceId = s().createPractice('Vuota');
    const { container } = render(<PracticeDecisionsSection practiceId={practiceId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('«Giurisprudenza (n)», the newest first: by the day of deposit when known, else by the year (T7)', () => {
    const { practiceId, decisionId: oldId } = s().openDecision(OLD, { open: false });
    const { decisionId: newId } = s().openDecision(NEW, { open: false });
    s().openDecision(UNREAD, { open: false });
    s().setDecisionEntryIdentity(practiceId, oldId, OLD, { tipo: 'sentenza', data_deposito: '2008-01-11', sezione: 'U' }, 'Cass. civ., sez. un., n. 577/2008');
    s().setDecisionEntryIdentity(practiceId, newId, NEW, { tipo: 'sentenza', data_deposito: '2019-11-11', sezione: '3' }, 'Cass. civ., sez. III, n. 28994/2019');
    render(<PracticeDecisionsSection practiceId={practiceId} />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Giurisprudenza (3)');
    expect(rowNames()).toEqual([
      'Espandi Cass. civ., n. 10787/2024',
      "Espandi Cass. civ., sez. III, n. 28994/2019, Sentenza depositata l'11 novembre 2019",
      "Espandi Cass. civ., sez. un., n. 577/2008, Sentenza depositata l'11 gennaio 2008",
    ]);
  });

  it('a row closed mounts nothing; opened, it reads the decision in place, hosted by the practice', () => {
    const { practiceId, decisionId } = s().openDecision(NEW, { open: false });
    render(<PracticeDecisionsSection practiceId={practiceId} />);
    expect(screen.queryByTestId('entry-view')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Espandi Cass. civ., n. 28994/2019' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(s().practiceRows[decisionRowKey(practiceId, decisionId)]).toBe(true);
    expect(screen.getByTestId('entry-view')).toBeInTheDocument();
    expect(entryViews).toHaveBeenLastCalledWith({ practiceId, decisionId, reference: NEW, hostId: practiceId });
    const open = screen.getByRole('button', { name: 'Comprimi Cass. civ., n. 28994/2019' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(open, { key: 'Enter' });
    expect(screen.queryByTestId('entry-view')).toBeNull();
  });

  it('a row opened by the store (a reveal) is open, and carries its key for the column to scroll to', () => {
    const { practiceId, decisionId } = s().openDecision(NEW, { beside: false });
    const { container } = render(<PracticeDecisionsSection practiceId={practiceId} />);
    expect(screen.getByTestId('entry-view')).toBeInTheDocument();
    expect(container.querySelector(`[data-practice-row="${decisionRowKey(practiceId, decisionId)}"]`)).not.toBeNull();
  });

  it('a found decision updates its row: the label with its section, the type and the day of deposit', () => {
    const { practiceId, decisionId } = s().openDecision({ corte: 'cassazione', numero: 28994, anno: 2019 }, { open: false });
    render(<PracticeDecisionsSection practiceId={practiceId} />);
    expect(screen.getByRole('button', { name: 'Espandi Cass., n. 28994/2019' })).toBeInTheDocument();
    expect(screen.queryByText(/depositata/)).toBeNull();
    act(() => {
      s().setDecisionEntryIdentity(practiceId, decisionId, NEW, { tipo: 'sentenza', data_deposito: '2019-11-11', sezione: '3' }, 'Cass. civ., sez. III, n. 28994/2019');
    });
    expect(screen.getByRole('button', { name: "Espandi Cass. civ., sez. III, n. 28994/2019, Sentenza depositata l'11 novembre 2019" })).toBeInTheDocument();
    expect(screen.getByText('Sentenza depositata l\'11 novembre 2019')).toBeInTheDocument();
    expect(s().practices[0].decisions[0].identified).toBe(true);
  });

  it('«Togli dal tavolo» takes the decision off, with no confirmation', () => {
    const { practiceId } = s().openDecision(NEW, { open: false });
    s().openDecision(OLD, { open: false });
    render(<PracticeDecisionsSection practiceId={practiceId} />);
    const section = screen.getByRole('region', { name: /Giurisprudenza/ });
    fireEvent.click(within(section).getByRole('button', { name: 'Togli dal tavolo Cass. civ., n. 28994/2019' }));
    expect(s().practices[0].decisions.map((d) => d.reference.numero)).toEqual([577]);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Giurisprudenza (1)');
  });

  it('names the toggle with the visible text, deposit included', () => {
    const { practiceId, decisionId } = s().openDecision(NEW, { open: false });
    act(() => { s().setDecisionEntryIdentity(practiceId, decisionId, NEW, { data_deposito: '2019-11-05', tipo: 'sentenza' }, 'Cass. civ., n. 28994/2019'); });
    render(<PracticeDecisionsSection practiceId={practiceId} />);
    const name = screen.getByRole('button', { name: /^Espandi / }).getAttribute('aria-label');
    expect(name).toContain('Cass. civ., n. 28994/2019');
    expect(name).toMatch(/Sentenza depositata/);
  });
});
