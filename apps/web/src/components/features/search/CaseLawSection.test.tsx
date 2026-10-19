import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { NormaVisitata } from '../../../types';
import type { SearchDecisionsAnswer } from '../../../types/decisions';

const { slotCalls } = vi.hoisted(() => ({ slotCalls: [] as Array<{ slot: string; props: Record<string, unknown> }> }));
vi.mock('../../../services/corteCostMassimeService', () => ({
  searchCorteCostMassime: vi.fn(async () => ({
    esito: 'risultati', urn: '', pagina: 1, per_pagina: 20, totale: 0, per_ruolo: { norma: 0, parametro: 0 }, massime: [],
    fonte: { nome: 'Corte costituzionale — dati aperti', licenza: 'CC BY-SA 3.0', url: 'https://dati.cortecostituzionale.it/' },
    attribuzione: 'Massime: Corte costituzionale — dati aperti, CC BY-SA 3.0', aggiornato_al: null,
  })),
}));
vi.mock('../../../services/decisionSearchService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/decisionSearchService')>()),
  searchDecisions: vi.fn(),
}));
vi.mock('../../../services/euCaseLawService', () => ({
  searchEuCaseLaw: vi.fn(async () => ({ esito: 'risultati', celex: '', articolo: '', totale: 0, troncato: false, decisioni: [] })),
}));
vi.mock('../../../plugins/PluginSlot', () => ({
  PluginSlot: ({ slot, props }: { slot: string; props: Record<string, unknown> }) => {
    slotCalls.push({ slot, props });
    return <div data-testid={`slot-${slot}`} />;
  },
}));
import { searchDecisions } from '../../../services/decisionSearchService';
import { CaseLawSection } from './CaseLawSection';
import { massimeStateOf } from './massimeState';
import { clearDecisionSearchCache } from '../../../utils/decisionSearchCache';

const NORMA: NormaVisitata = {
  tipo_atto: 'codice civile', numero_articolo: '2043', data: '1942-03-16', numero_atto: '262', allegato: '2',
  urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043',
};
const MASSIME = [
  { autorita: 'Cass. civ.', numero: '31191', anno: '2025', massima: 'Il danno ingiusto.' },
  { autorita: 'Cons. Stato', numero: '10', anno: '2020', massima: 'Il provvedimento.' },
];
const PAGE: SearchDecisionsAnswer = {
  esito: 'risultati', totale: 1, pagina: 1, modo: 'indice', archivio: 'civile', archivio_dal: '2021-01-04',
  decisioni: [{ identita: { corte: 'cassazione', archivio: 'civile', numero: 24908, anno: 2026 }, attributi: {}, trovata: 'indice', frammento: null }],
};
const searchMock = vi.mocked(searchDecisions);

function show(props: Partial<Parameters<typeof CaseLawSection>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CaseLawSection norma={NORMA} massime={MASSIME} articleUrn={NORMA.urn} tabId="tab-1" {...props} />
    </MemoryRouter>,
  );
}
const toggle = () => screen.getByRole('button', { name: 'Giurisprudenza' });

beforeEach(() => {
  searchMock.mockReset();
  slotCalls.length = 0;
  window.sessionStorage.clear();
});

describe('CaseLawSection', () => {
  it('is closed by default, an accordion named by its heading', () => {
    show();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle().closest('h3')).not.toBeNull();
    expect(screen.queryByText('Massime (Brocardi)')).toBeNull();
  });

  it('shows the massime with their credit, a link per linkable one, the Massimario slot and the Cassazione button', async () => {
    show({ backEntry: { tabId: 'tab-1', blockId: 'b', articleId: 'a', label: 'art. 2043 c.c.' } });
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Massime (Brocardi)' })).toBeInTheDocument();
    expect(screen.getByText('Fonte: Brocardi.it')).toBeInTheDocument();
    expect(screen.getByText('Cass. civ., n. 31191/2025').closest('a')).toHaveAttribute('href', '/sentenze/cassazione-civile/31191/2025');
    expect(screen.getByText('Cons. Stato').closest('a')).toBeNull();
    expect(screen.getByTestId('slot-article_case_law')).toBeInTheDocument();
    expect(slotCalls.at(-1)?.props).toMatchObject({
      articleUrn: NORMA.urn, isHistorical: false, besideId: 'tab-1',
      backEntry: { tabId: 'tab-1', label: 'art. 2043 c.c.' },
    });
    expect(screen.getByRole('heading', { name: 'Cassazione — menzionano l’articolo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerca nell’archivio della Cassazione' })).toBeInTheDocument();
  });

  it('asks nothing of the Cassazione until the button is pressed, then asks once for the article', async () => {
    searchMock.mockResolvedValue(PAGE);
    show();
    await userEvent.click(toggle());
    expect(searchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cerca nell’archivio della Cassazione' }));
    expect(await screen.findByText('Cass. civ., n. 24908/2026')).toBeInTheDocument();
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        norma: { tipo_atto: 'codice civile', numero_articolo: '2043', numero_atto: '262', data: '1942-03-16' },
        archivio: undefined,
      }),
      1,
      'indice',
    );
  });

  it('on a past text keeps the section, the Massimario and the search, and drops the massime', async () => {
    show({ massime: null, massimeState: 'hidden', isHistorical: true });
    await userEvent.click(toggle());
    expect(screen.queryByText('Massime (Brocardi)')).toBeNull();
    expect(slotCalls.at(-1)?.props).toMatchObject({ isHistorical: true });
    expect(screen.getByRole('button', { name: 'Cerca nell’archivio della Cassazione' })).toBeInTheDocument();
  });

  it('offers the Cassazione\'s archive on no act of the Union, whatever the spelling of its type', async () => {
    for (const tipo_atto of ['regolamento ue', 'Regolamento UE', 'direttiva ue', 'tfue']) {
      const view = show({ norma: { ...NORMA, tipo_atto, urn: undefined } });
      await userEvent.click(toggle());
      expect(screen.queryByRole('button', { name: 'Cerca nell’archivio della Cassazione' }), tipo_atto).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Cassazione — menzionano l’articolo' }), tipo_atto).toBeNull();
      // the rest of the section stays
      expect(screen.getByRole('heading', { name: 'Massime (Brocardi)' })).toBeInTheDocument();
      expect(screen.getByTestId('slot-article_case_law')).toBeInTheDocument();
      view.unmount();
      window.sessionStorage.clear();
    }
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('gives an act of the Union the Court of Justice\'s block, asked for when the section opens and not before', async () => {
    const { searchEuCaseLaw } = await import('../../../services/euCaseLawService');
    const eu = vi.mocked(searchEuCaseLaw);
    eu.mockClear();
    show({ norma: { tipo_atto: 'regolamento ue', data: '2016', numero_atto: '679', numero_articolo: '6' } });
    expect(eu).not.toHaveBeenCalled();
    await userEvent.click(toggle());
    expect(screen.getByRole('heading', { name: 'Corte di giustizia UE — citano l’articolo' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cassazione — menzionano l’articolo' })).toBeNull();
    expect(await screen.findByText('Nessuna decisione indicizzata cita questo articolo.')).toBeInTheDocument();
    expect(eu).toHaveBeenCalledExactlyOnceWith({ celex: '32016R0679', articolo: '6' });
  });

  it('gives a State act\'s article the Corte costituzionale\'s massime, asked for when the section opens', async () => {
    const { searchCorteCostMassime } = await import('../../../services/corteCostMassimeService');
    const cc = vi.mocked(searchCorteCostMassime);
    cc.mockClear();
    show();
    expect(cc).not.toHaveBeenCalled();
    await userEvent.click(toggle());
    expect(screen.getByRole('heading', { name: 'Corte costituzionale — massime' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Massime: Corte costituzionale — dati aperti, CC BY-SA 3.0' })).toBeInTheDocument();
    expect(cc).toHaveBeenCalledExactlyOnceWith(NORMA.urn);
  });

  it('gives an act of the Union no Corte costituzionale block', async () => {
    show({ norma: { tipo_atto: 'regolamento ue', data: '2016', numero_atto: '679', numero_articolo: '6' } });
    await userEvent.click(toggle());
    expect(screen.queryByRole('heading', { name: 'Corte costituzionale — massime' })).toBeNull();
  });

  it('gives no Court of Justice block to a national act', async () => {
    show();
    await userEvent.click(toggle());
    expect(screen.queryByRole('heading', { name: /Corte di giustizia UE/ })).toBeNull();
  });

  it('says so when Brocardi gave no massime for the text in force', async () => {
    show({ massime: [] });
    await userEvent.click(toggle());
    expect(screen.getByRole('heading', { name: 'Massime (Brocardi)' })).toBeInTheDocument();
    expect(screen.getByText('Brocardi.it non riporta massime per questo articolo.')).toBeInTheDocument();
  });

  it('says Brocardi did not answer, rather than that it has no massime', async () => {
    show({ massime: null, massimeState: 'failed' });
    await userEvent.click(toggle());
    expect(screen.getByRole('heading', { name: 'Massime (Brocardi)' })).toBeInTheDocument();
    expect(screen.getByText('Brocardi.it non ha risposto: le massime non sono disponibili ora.')).toBeInTheDocument();
    expect(screen.queryByText(/non riporta massime/)).toBeNull();
    // a source that gave nothing is not credited
    expect(screen.queryByText('Fonte: Brocardi.it')).toBeNull();
  });

  it('shows no massime subsection when Brocardi was not asked', async () => {
    show({ massime: null, massimeState: 'hidden' });
    await userEvent.click(toggle());
    expect(screen.queryByRole('heading', { name: 'Massime (Brocardi)' })).toBeNull();
    expect(screen.queryByText(/Brocardi.it non/)).toBeNull();
  });

  it('links the source credit to the article on Brocardi, https only', async () => {
    const view = show({ brocardiLink: 'https://www.brocardi.it/codice-civile/art2043.html' });
    await userEvent.click(toggle());
    const link = screen.getByRole('link', { name: 'Fonte: Brocardi.it' });
    expect(link).toHaveAttribute('href', 'https://www.brocardi.it/codice-civile/art2043.html');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    view.unmount();
    show({ brocardiLink: 'http://www.brocardi.it/x', tabId: 'tab-9' });
    await userEvent.click(toggle());
    expect(screen.queryByRole('link', { name: 'Fonte: Brocardi.it' })).toBeNull();
    expect(screen.getByText('Fonte: Brocardi.it')).toBeInTheDocument();
  });

  it('remembers whether it is open for the tab, and not for another', async () => {
    const first = show();
    await userEvent.click(toggle());
    first.unmount();
    show();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    document.body.innerHTML = '';
    show({ tabId: 'tab-2' });
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('works when the browser refuses its storage', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    show();
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    get.mockRestore();
    set.mockRestore();
  });
});

describe('massimeStateOf', () => {
  it.each([
    ['a past text', false, { Massime: [] }, undefined, 'hidden'],
    ['Brocardi answered', true, { Massime: [] }, undefined, 'answered'],
    ['Brocardi failed', true, undefined, 'timeout', 'failed'],
    ['Brocardi not asked', true, undefined, undefined, 'hidden'],
  ] as const)('%s', (_label, doctrineVisible, info, error, expected) => {
    expect(massimeStateOf(doctrineVisible, info, error)).toBe(expected);
  });
});

beforeEach(() => clearDecisionSearchCache());
