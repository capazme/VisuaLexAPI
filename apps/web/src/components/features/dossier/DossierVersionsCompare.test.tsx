import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DossierVersionsCompare } from './DossierVersionsCompare';
import { dossierService } from '../../../services/dossierService';

const snap = (id: string, version: number, items: { id: string; itemType: string; title: string; content: unknown }[]) =>
  ({ id, version, label: null, createdAt: '2026-11-18T10:00:00Z', content: { items: items.map((i) => ({ ...i, position: 0 })) } });

afterEach(() => vi.restoreAllMocks());

describe('DossierVersionsCompare', () => {
  it('says each difference in words, a note that went by its text', async () => {
    vi.spyOn(dossierService, 'getSnapshots').mockResolvedValue([
      snap('s2', 2, [{ id: 'a', itemType: 'norm', title: 'art. 2043 c.c.', content: { urn: 'a' } }, { id: 'c', itemType: 'norm', title: 'art. 1227 c.c.', content: { urn: 'c' } }, { id: 'n', itemType: 'note', title: 'Nota', content: 'Termine di sessanta giorni.' }]),
      snap('s1', 1, [{ id: 'a', itemType: 'norm', title: 'art. 2043 c.c.', content: { urn: 'a' } }, { id: 'b', itemType: 'norm', title: 'art. 1117 c.c.', content: { urn: 'b' } }, { id: 'n', itemType: 'note', title: 'Nota', content: 'Termine di trenta giorni.' }, { id: 'm', itemType: 'note', title: 'Nota', content: 'Chiedere le delibere.' }]),
    ] as never);
    render(<DossierVersionsCompare dossierId="d1" open onClose={() => {}} />);
    expect(await screen.findByText('1 entrata, 2 uscite, 1 cambiata')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Differenze' });
    expect([...list.querySelectorAll('li > p:first-child > span:first-child')].map((e) => e.textContent)).toEqual(['Entrata', 'Cambiata', 'Uscita', 'Uscita']);
    expect(list.querySelector('ins')?.textContent).toContain('sessanta');
    expect(list.querySelector('del')?.textContent).toContain('trenta');
    expect(screen.getByText('Chiedere le delibere.')).toBeTruthy();
  });

  it('asks for two snapshots when there are fewer', async () => {
    vi.spyOn(dossierService, 'getSnapshots').mockResolvedValue([snap('s1', 1, [])] as never);
    render(<DossierVersionsCompare dossierId="d1" open onClose={() => {}} />);
    expect(await screen.findByText(/Servono almeno due snapshot/)).toBeTruthy();
  });
});
