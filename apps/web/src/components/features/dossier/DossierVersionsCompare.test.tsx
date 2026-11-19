import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DossierVersionsCompare } from './DossierVersionsCompare';
import { dossierService } from '../../../services/dossierService';

const CC = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16' };
const norm = (id: string, art: string) => ({ id, itemType: 'norm', title: 'codice civile', content: { ...CC, numero_articolo: art } });
const snap = (id: string, version: number, items: { id: string; itemType: string; title: string; content: unknown }[]) =>
  ({ id, version, label: null, createdAt: '2026-11-18T10:00:00Z', content: { items: items.map((i) => ({ ...i, position: 0 })) } });

afterEach(() => vi.restoreAllMocks());

describe('DossierVersionsCompare', () => {
  it('says each difference in words, a note that went by its text', async () => {
    vi.spyOn(dossierService, 'getSnapshots').mockResolvedValue([
      snap('s2', 2, [norm('a', '2043'), norm('c', '1227'), { id: 'n', itemType: 'note', title: 'Nota', content: 'Termine di cinque giorni.' }]),
      snap('s1', 1, [norm('a', '2043'), norm('b', '1117'), { id: 'n', itemType: 'note', title: 'Nota', content: 'Termine di tre giorni.' }, { id: 'm', itemType: 'note', title: 'Nota', content: 'Chiedere le delibere.' }]),
    ] as never);
    render(<DossierVersionsCompare dossierId="d1" open onClose={() => {}} />);
    expect(await screen.findByText('1 entrata, 2 uscite, 1 cambiata')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Differenze' });
    expect([...list.querySelectorAll('li > p:first-child > span:first-child')].map((e) => e.textContent)).toEqual(['Entrata', 'Cambiata', 'Uscita', 'Uscita']);
    expect(screen.getByText('art. 1227 c.c.')).toBeTruthy();
    expect(screen.getByText('art. 1117 c.c.')).toBeTruthy();
    expect(list.querySelector('ins')?.textContent).toContain('cinque');
    expect(list.querySelector('del')?.textContent).toContain('tre');
    // The word that went and the one that came do not touch.
    expect(list.querySelector('del')?.nextSibling?.textContent).toBe(' ');
    expect(screen.getByText('Chiedere le delibere.')).toBeTruthy();
  });

  it('reads the list again when a snapshot is saved while it is open', async () => {
    const read = vi.spyOn(dossierService, 'getSnapshots').mockResolvedValue([snap('s1', 1, []), snap('s0', 0, [])] as never);
    const { rerender } = render(<DossierVersionsCompare dossierId="d1" open refreshKey="s1" onClose={() => {}} />);
    await screen.findByText('Nessuna differenza');
    read.mockResolvedValue([snap('s2', 2, [norm('a', '2043')]), snap('s1', 1, []), snap('s0', 0, [])] as never);
    rerender(<DossierVersionsCompare dossierId="d1" open refreshKey="s2" onClose={() => {}} />);
    expect(await screen.findByText('1 entrata')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('asks for two snapshots when there are fewer', async () => {
    vi.spyOn(dossierService, 'getSnapshots').mockResolvedValue([snap('s1', 1, [])] as never);
    render(<DossierVersionsCompare dossierId="d1" open onClose={() => {}} />);
    expect(await screen.findByText(/Servono almeno due snapshot/)).toBeTruthy();
  });
});
