// The Scrivania against the worst realistic data (break-ui): titles at the server's limits (a dossier's
// name 200 characters, a quick norm's label 300), a one-letter title, a dossier with one entry, a
// thousand dossiers, and the empty account. Kept as the regression test for the page.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { appStore } from '../../../store/useAppStore';
import { Scrivania } from './Scrivania';
import type { Dossier, DossierItem, QuickNorm } from '../../../types';

const LONG_TITLE = ('Ricorso ex art. 700 c.p.c. avverso il diniego di accesso civico generalizzato ai sensi del d.lgs. 33/2013, '
  + 'con istanza cautelare e richiesta di esibizione documentale nei confronti di Roma Capitale e della ASL Roma 1').slice(0, 200).trimEnd();
const LONG_LABEL = ('Art. 2-quinquiesdecies d.lgs. 196/2003 — Trattamento che presenta rischi elevati per l\'esecuzione di un compito di interesse pubblico, '
  + 'come modificato dal d.lgs. 101/2018 e dal d.l. 139/2021, conv. con modif. dalla l. 205/2021 — nota di lavoro sul regime transitorio e '
  + 'sui provvedimenti generali del Garante').slice(0, 300).trimEnd();

const note = (id: string): DossierItem => ({ id, type: 'note', data: { text: 'x' }, addedAt: '2026-10-01T00:00:00Z' } as unknown as DossierItem);
const dossier = (id: string, title: string, createdAt: string, items: DossierItem[] = [], kind?: Dossier['kind']): Dossier =>
  ({ id, title, createdAt, items, kind });

function renderPage() {
  return render(<MemoryRouter><Scrivania /></MemoryRouter>);
}

describe('the Scrivania with the worst realistic data', () => {
  beforeEach(() => {
    const many = Array.from({ length: 1000 }, (_, i) => dossier(`d${i}`, `Pratica ${i}`, `2025-01-01T00:00:00Z`));
    appStore.setState({
      dossiers: [
        ...many,
        dossier('long', LONG_TITLE, '2026-10-18T00:00:00Z'),
        dossier('x', 'X', '2026-10-17T00:00:00Z', [note('n1')], 'studio'),
        dossier('two', 'Privacy e lavoro', '2026-10-16T00:00:00Z', [note('n2'), note('n3')]),
      ],
      quickNorms: [
        { id: 'q1', label: LONG_LABEL, searchParams: { act_type: 'decreto legislativo', act_number: '196', date: '2003-06-30', article: '2-quinquiesdecies' }, createdAt: '2026-10-01T00:00:00Z', usageCount: 3 } as QuickNorm,
      ],
    });
  });

  it('lists four dossiers, the most recent first, out of a thousand', () => {
    renderPage();
    const list = screen.getByRole('region', { name: 'Riprendi' });
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent(LONG_TITLE);
  });

  it('says «1 voce» and «2 voci»', () => {
    renderPage();
    expect(screen.getByText('1 voce')).toBeInTheDocument();
    expect(screen.getByText('2 voci')).toBeInTheDocument();
  });

  it('truncates a title at the limit on one line and keeps it readable whole on hover', () => {
    renderPage();
    const title = screen.getByText(LONG_TITLE);
    expect(title).toHaveClass('truncate');
    expect(title).toHaveAttribute('title', LONG_TITLE);
    const label = screen.getByText(LONG_LABEL);
    expect(label).toHaveClass('truncate');
    expect(label).toHaveAttribute('title', LONG_LABEL);
  });

  it('names the kind of each dossier', () => {
    renderPage();
    const list = screen.getByRole('region', { name: 'Riprendi' });
    expect(within(list).getAllByText('Dossier di lavoro').length).toBeGreaterThan(0);
    expect(within(list).getByText('Dossier di studio')).toBeInTheDocument();
  });

  it('with an empty account shows no «Riprendi» and says how to add a frequent search', () => {
    appStore.setState({ dossiers: [], quickNorms: [] });
    renderPage();
    expect(screen.queryByRole('region', { name: 'Riprendi' })).toBeNull();
    expect(screen.getByText(/aggiungile da «Gestisci»/)).toBeInTheDocument();
  });

  it('gives the three sample searches 44 px on a phone and their text height from md', () => {
    renderPage();
    for (const example of ['Art. 2043 c.c.', 'Art. 5 GDPR', 'Art. 1 Costituzione']) {
      expect(screen.getByRole('button', { name: example })).toHaveClass('min-h-[44px]', 'md:min-h-0');
    }
  });
});
