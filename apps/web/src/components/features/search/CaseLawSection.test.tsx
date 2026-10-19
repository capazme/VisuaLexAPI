import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { NormaVisitata } from '../../../types';
import type { SearchDecisionsAnswer } from '../../../types/decisions';

const { slotCalls } = vi.hoisted(() => ({ slotCalls: [] as Array<{ slot: string; props: Record<string, unknown> }> }));
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
import { appStore } from '../../../store/useAppStore';
import { clearDecisionSearchCache } from '../../../utils/decisionSearchCache';

const NORMA: NormaVisitata = {
  tipo_atto: 'codice civile', numero_articolo: '2043', data: '1942-03-16', numero_atto: '262', allegato: '2',
  urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043',
};
const PAGE: SearchDecisionsAnswer = {
  esito: 'risultati', totale: 1, pagina: 1, modo: 'indice', archivio: 'civile', archivio_dal: '2021-01-04',
  decisioni: [{ identita: { corte: 'cassazione', archivio: 'civile', numero: 24908, anno: 2026 }, attributi: {}, trovata: 'indice', frammento: null }],
};
const searchMock = vi.mocked(searchDecisions);

function show(props: Partial<Parameters<typeof CaseLawSection>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CaseLawSection norma={NORMA} articleUrn={NORMA.urn} tabId="tab-1" {...props} />
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
    expect(screen.queryByRole('button', { name: /Cerca nell’archivio della Cassazione/ })).toBeNull();
  });

  it('shows the Massimario slot and the Cassazione button, and nothing of Brocardi (D-078)', async () => {
    show({ backEntry: { tabId: 'tab-1', blockId: 'b', articleId: 'a', label: 'art. 2043 c.c.' } });
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText(/Brocardi/)).toBeNull();
    expect(screen.queryByText(/[Mm]assime/)).toBeNull();
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

  it('on a past text keeps the section, the Massimario and the search', async () => {
    show({ isHistorical: true });
    await userEvent.click(toggle());
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

  it('gives no Court of Justice block to a national act', async () => {
    show();
    await userEvent.click(toggle());
    expect(screen.queryByRole('heading', { name: /Corte di giustizia UE/ })).toBeNull();
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

describe('CaseLawSection — «Cerca sentenze sul tema dell’articolo»', () => {
  const RUBRIC = 'Risarcimento per fatto illecito';
  const topicLink = () => screen.queryByRole('button', { name: /Cerca sentenze sul tema dell’articolo/ });
  const openTopicSearch = vi.fn(() => 'w');
  const pushReadingBack = vi.fn();
  const original = { openTopicSearch: appStore.getState().openTopicSearch, pushReadingBack: appStore.getState().pushReadingBack };
  beforeEach(() => {
    openTopicSearch.mockClear();
    pushReadingBack.mockClear();
    appStore.setState({ openTopicSearch, pushReadingBack });
    return () => appStore.setState(original);
  });

  it('records the way back to the article before it opens, as a decision\'s link does', async () => {
    const backEntry = { tabId: 'tab-1', blockId: 'b', articleId: '2043', label: 'art. 2043 c.c.' };
    show({ topic: RUBRIC, backEntry });
    await userEvent.click(toggle());
    await userEvent.click(topicLink()!);
    expect(pushReadingBack).toHaveBeenCalledExactlyOnceWith(backEntry);
    expect(pushReadingBack.mock.invocationCallOrder[0]).toBeLessThan(openTopicSearch.mock.invocationCallOrder[0]);
  });

  it('records no way back when the article has none to give (a preview)', async () => {
    show({ topic: RUBRIC });
    await userEvent.click(toggle());
    await userEvent.click(topicLink()!);
    expect(pushReadingBack).not.toHaveBeenCalled();
    expect(openTopicSearch).toHaveBeenCalledTimes(1);
  });

  it('names the rubric it searches and opens a topic search of the Cassazione beside the article', async () => {
    show({ topic: RUBRIC });
    await userEvent.click(toggle());
    const link = topicLink();
    expect(link).toHaveTextContent(`«${RUBRIC}»`);
    await userEvent.click(link!);
    // the subject alone, not the article: the decisions that cite it are the button above
    expect(openTopicSearch).toHaveBeenCalledExactlyOnceWith({ tema: RUBRIC }, `Tema: ${RUBRIC}`, { besideId: 'tab-1' });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('is not there for an article with no rubric', async () => {
    for (const topic of [undefined, null, '', '   ']) {
      const view = show({ topic });
      await userEvent.click(toggle());
      expect(topicLink(), String(topic)).toBeNull();
      view.unmount();
      window.sessionStorage.clear();
    }
  });

  it('is not offered on an act of the Union, whose case law is not the Cassazione\'s', async () => {
    show({ topic: 'Liceità del trattamento', norma: { tipo_atto: 'regolamento ue', data: '2016', numero_atto: '679', numero_articolo: '6' } });
    await userEvent.click(toggle());
    expect(topicLink()).toBeNull();
  });

  it('stays on a past text, with the rest of the section', async () => {
    show({ topic: RUBRIC, isHistorical: true });
    await userEvent.click(toggle());
    expect(topicLink()).not.toBeNull();
  });

  it('opens with no host to sit beside when the article has none', async () => {
    show({ topic: RUBRIC, tabId: undefined });
    await userEvent.click(toggle());
    await userEvent.click(topicLink()!);
    expect(openTopicSearch).toHaveBeenCalledExactlyOnceWith({ tema: RUBRIC }, `Tema: ${RUBRIC}`, undefined);
  });
});

beforeEach(() => clearDecisionSearchCache());
