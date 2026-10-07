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
vi.mock('../../../plugins/PluginSlot', () => ({
  PluginSlot: ({ slot, props }: { slot: string; props: Record<string, unknown> }) => {
    slotCalls.push({ slot, props });
    return <div data-testid={`slot-${slot}`} />;
  },
}));
import { searchDecisions } from '../../../services/decisionSearchService';
import { CaseLawSection } from './CaseLawSection';

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
      articleUrn: NORMA.urn, isHistorical: false, besideTabId: 'tab-1',
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
    show({ massime: null, isHistorical: true });
    await userEvent.click(toggle());
    expect(screen.queryByText('Massime (Brocardi)')).toBeNull();
    expect(slotCalls.at(-1)?.props).toMatchObject({ isHistorical: true });
    expect(screen.getByRole('button', { name: 'Cerca nell’archivio della Cassazione' })).toBeInTheDocument();
  });

  it('omits the massime subsection when the source gave none', async () => {
    show({ massime: [] });
    await userEvent.click(toggle());
    expect(screen.queryByText('Massime (Brocardi)')).toBeNull();
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
