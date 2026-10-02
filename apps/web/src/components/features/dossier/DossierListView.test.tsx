import { beforeEach, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { appStore } from '../../../store/useAppStore';
import { DossierListView } from './DossierListView';
import type { Dossier, NormaVisitata } from '../../../types';

const CIVIL: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284' };
const PENAL: NormaVisitata = { tipo_atto: 'codice penale', numero_atto: '1398', data: '1930-10-19', numero_articolo: '575' };
const PAST: NormaVisitata = { ...CIVIL, versione: 'vigente', data_versione: '2007-12-29' };

const dossier = (data: NormaVisitata[]): Dossier => ({
  id: 'd1', title: 'Pratica Rossi', createdAt: '2026-08-01T10:00:00.000Z',
  items: data.map((d, i) => ({ id: `i${i}`, type: 'norma' as const, data: d, addedAt: '2026-08-01T10:00:00.000Z' })),
});

function open(items: NormaVisitata[]) {
  appStore.setState({ dossiers: [dossier(items)], workspaceTabs: [], searchTrigger: null, searchQueue: [] });
  render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Apri Pratica Rossi su Dashboard' }));
}

beforeEach(() => { appStore.setState({ workspaceTabs: [], searchTrigger: null, searchQueue: [] }); });

describe('DossierListView — the quick-open of a card', () => {
  it('opens a single past group as that text, without doctrine, in a tab named for it', () => {
    open([PAST]);
    const { searchTrigger, workspaceTabs } = appStore.getState();
    expect(searchTrigger).toMatchObject({
      article: '1284', version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false,
      tabLabel: 'Pratica Rossi — testo al 29/12/2007',
    });
    expect(workspaceTabs.map((t) => t.label)).toEqual(['Pratica Rossi — testo al 29/12/2007']);
    expect(searchTrigger?.targetTabId).toBe(workspaceTabs[0].id);
  });

  it('opens a single group in force as it always did', () => {
    open([CIVIL]);
    expect(appStore.getState().searchTrigger).toMatchObject({
      version: 'vigente', version_date: '', show_brocardi_info: true, tabLabel: 'Pratica Rossi',
    });
  });

  it('through the picker: "open all" keeps each version, and a past group has a tab of its own', () => {
    open([CIVIL, PAST]);
    fireEvent.click(screen.getByRole('button', { name: /Apri tutto/ }));
    const { searchQueue, workspaceTabs } = appStore.getState();
    expect(searchQueue).toHaveLength(2);
    expect(searchQueue[0]).toMatchObject({ version: 'vigente', version_date: '', show_brocardi_info: true });
    expect(searchQueue[1]).toMatchObject({ version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false });
    expect(workspaceTabs.map((t) => t.label)).toEqual(['Pratica Rossi', 'Pratica Rossi — testo al 29/12/2007']);
    expect(searchQueue.map((s) => s.targetTabId)).toEqual(workspaceTabs.map((t) => t.id));
  });

  it('through the picker: no empty shared tab when every group asks for a past text', () => {
    open([PAST, { ...PENAL, versione: 'originale' }]);
    fireEvent.click(screen.getByRole('button', { name: /Apri tutto/ }));
    expect(appStore.getState().workspaceTabs.map((t) => t.label)).toEqual([
      'Pratica Rossi — testo al 29/12/2007', 'Pratica Rossi — testo originale',
    ]);
  });

  it('through the picker: one group on its own keeps its version', () => {
    open([CIVIL, PAST]);
    fireEvent.click(screen.getByText('Testo al 29/12/2007'));
    expect(appStore.getState().searchTrigger).toMatchObject({
      version_date: '2007-12-29', show_brocardi_info: false, tabLabel: 'Pratica Rossi — testo al 29/12/2007',
    });
  });
});
