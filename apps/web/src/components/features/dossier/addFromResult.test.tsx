import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    getAll: vi.fn(async () => []), getById: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 'srv-new', name: 'Nuovo', items: [], created_at: '2026-11-16T00:00:00Z', updated_at: '2026-11-16T00:00:00Z' })),
    update: vi.fn(async () => ({})), delete: vi.fn(async () => {}),
    addItem: vi.fn(async () => ({ id: 'item-srv' })),
    updateItem: vi.fn(async () => ({})),
    reorderItems: vi.fn(async () => {}),
  },
}));
vi.mock('../../../utils/decisionFetchCache', () => ({
  fetchDecisionCached: () => Promise.resolve({ esito: 'non_trovata', motivo: 'inesistente' }),
}));

import { appStore } from '../../../store/useAppStore';
import { PracticeRowShell } from '../practice/PracticeRowShell';
import { CaseLawRow } from '../search/caseLaw/CaseLawRow';
import type { Dossier, DossierSentenzaData, NormaVisitata } from '../../../types';

const NORMA: NormaVisitata = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043' };
const SENTENZA: DossierSentenzaData = { corte: 'cassazione', archivio: 'civile', numero: 24908, anno: 2026, etichetta: 'Cass. civ., n. 24908/2026' };

const dossier = (id: string, title: string, items: Dossier['items'] = []): Dossier =>
  ({ id, title, createdAt: '2026-11-01T00:00:00Z', items });
const normaItem = (data: NormaVisitata) => ({ id: `n-${Math.random()}`, type: 'norma' as const, data, addedAt: '2026-11-02T00:00:00Z' });
const sentenzaItem = (data: DossierSentenzaData) => ({ id: `s-${Math.random()}`, type: 'sentenza' as const, data, addedAt: '2026-11-02T00:00:00Z' });

const row = (corpusItem: { norma: NormaVisitata } | { sentenza: DossierSentenzaData }, name = 'art. 2043 c.c.') => (
  <PracticeRowShell
    rowKey="p/act/2043"
    isOpen={false}
    onToggle={vi.fn()}
    name={name}
    removeName={name}
    onRemove={vi.fn()}
    header={<span>{name}</span>}
    corpusItem={corpusItem}
  >
    <div />
  </PracticeRowShell>
);

beforeEach(() => {
  appStore.setState({ dossiers: [dossier('a', 'Sinistro Rossi'), dossier('b', 'Studio GDPR')] });
});

describe('«Aggiungi alla pratica» on a row of the Ricerca (LC59)', () => {
  it('an article row has the command, with its name, and it opens the dossier choice', () => {
    render(row({ norma: NORMA }));
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi alla pratica art. 2043 c.c.' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Aggiungi alla pratica')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Sinistro Rossi/ }));
    const held = appStore.getState().dossiers.find((d) => d.id === 'a')!.items;
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ type: 'norma', data: expect.objectContaining({ numero_articolo: '2043' }) });
  });

  it('a decision row adds the decision', () => {
    render(row({ sentenza: SENTENZA }, 'Cass. civ., n. 24908/2026'));
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi alla pratica Cass. civ., n. 24908/2026' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Studio GDPR/ }));
    expect(appStore.getState().dossiers.find((d) => d.id === 'b')!.items[0]).toMatchObject({ type: 'sentenza', data: expect.objectContaining({ numero: 24908 }) });
  });

  it('says in words the one dossier that holds it, and still lets it be added to another', () => {
    appStore.setState({ dossiers: [dossier('a', 'Sinistro Rossi', [normaItem(NORMA)]), dossier('b', 'Studio GDPR')] });
    render(row({ norma: NORMA }));
    expect(screen.getByText('Nella pratica «Sinistro Rossi»')).toBeInTheDocument();
    // The toggle's name replaces its content: the mark's words are in it.
    expect(screen.getByRole('button', { name: 'Espandi art. 2043 c.c., nella pratica «Sinistro Rossi»' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi alla pratica art. 2043 c.c.' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Studio GDPR/ }));
    expect(screen.getByText('In 2 pratiche')).toBeInTheDocument();
  });

  it('counts the dossiers that hold a decision', () => {
    appStore.setState({ dossiers: [dossier('a', 'Sinistro Rossi', [sentenzaItem(SENTENZA)]), dossier('b', 'Studio GDPR', [sentenzaItem(SENTENZA)])] });
    render(row({ sentenza: SENTENZA }, 'Cass. civ., n. 24908/2026'));
    expect(screen.getByText('In 2 pratiche')).toBeInTheDocument();
  });

  it('a past text is not the text in force: the mark agrees with the popover', () => {
    appStore.setState({ dossiers: [dossier('a', 'Sinistro Rossi', [normaItem(NORMA)])] });
    render(row({ norma: { ...NORMA, data_versione: '2007-12-29' } }));
    expect(screen.queryByText(/Nella pratica/)).toBeNull();
  });

  it('on a phone the row\'s «⋯» names it, beside «Togli dal tavolo»', () => {
    render(row({ norma: NORMA }));
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su art. 2043 c.c.' }));
    expect(screen.getByRole('menuitem', { name: /Togli dal tavolo/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Aggiungi alla pratica/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('writes nothing in the browser: no practice made or changed, the saved workspace untouched', () => {
    const before = appStore.getState();
    const saved = localStorage.getItem('visualex-storage');
    expect(saved).not.toBeNull();
    render(row({ norma: NORMA }));
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi alla pratica art. 2043 c.c.' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sinistro Rossi/ }));
    const after = appStore.getState();
    expect(after.practices).toBe(before.practices);
    expect(after.activePracticeId).toBe(before.activePracticeId);
    expect(localStorage.getItem('visualex-storage')).toBe(saved);
  });

  it('a row of a dossier\'s «Lettura» keeps its own commands (LC55): no popover command beside them', () => {
    render(
      <PracticeRowShell
        rowKey="p/act/2043" isOpen={false} onToggle={vi.fn()} name="art. 2043 c.c." removeName="art. 2043 c.c." onRemove={vi.fn()}
        header={<span>art. 2043 c.c.</span>}
        dossier={{ inDossier: true, remove: vi.fn(), important: false, toggleImportant: vi.fn(), notes: 0, moveTo: vi.fn(), itemIds: [] }}
      >
        <div />
      </PracticeRowShell>,
    );
    expect(screen.queryByRole('button', { name: /^Aggiungi alla pratica/ })).toBeNull();
  });
});

describe('«Aggiungi alla pratica» on a hit of case law (LC59)', () => {
  const hit = () => render(
    <MemoryRouter><ul><CaseLawRow decision={SENTENZA} dossierItem={SENTENZA} source="Archivio della Cassazione" /></ul></MemoryRouter>,
  );

  it('has the command with its name, and adds the decision', () => {
    hit();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi alla pratica Cass. civ., n. 24908/2026' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sinistro Rossi/ }));
    expect(appStore.getState().dossiers.find((d) => d.id === 'a')!.items[0]).toMatchObject({ type: 'sentenza' });
    expect(screen.getByText('Nella pratica «Sinistro Rossi»')).toBeInTheDocument();
  });

  it('a row with nothing to add draws no command', () => {
    render(<MemoryRouter><ul><CaseLawRow decision={SENTENZA} source="Massimario" /></ul></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Aggiungi alla pratica/ })).toBeNull();
  });
});
