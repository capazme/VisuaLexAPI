import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { appStore } from '../../../../store/useAppStore';
import type { Highlight } from '../../../../types';
import type { FoundDecision } from '../../../../types/decisions';

const { save, rect } = vi.hoisted(() => ({ save: vi.fn(), rect: vi.fn() }));
// jsPDF puts its methods on each instance, so the real class is wrapped to see what it is asked to do.
vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>();
  class Spied extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args);
      const drawRect = this.rect.bind(this);
      this.rect = ((...a: Parameters<typeof drawRect>) => { rect(...a); return drawRect(...a); }) as typeof this.rect;
      this.save = ((name: string) => { save(name); return this; }) as unknown as typeof this.save;
    }
  }
  return { ...real, jsPDF: Spied };
});

const fetchOriginalPdf = vi.fn();
vi.mock('../../../../services/decisionPdfService', () => ({ fetchOriginalPdf: (...a: unknown[]) => fetchOriginalPdf(...a) }));

import { DecisionDownloads } from '../DecisionDownloads';

const FOUND: FoundDecision = {
  esito: 'trovata', identita: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 },
  attributi: { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22' },
  testo: { motivazione: 'Primo paragrafo.\n\nSecondo paragrafo.' },
  fonte: { nome: 'Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)' }, avvisi: [],
};
const CONSULTA: FoundDecision = { ...FOUND, identita: { corte: 'corte_costituzionale', numero: 71, anno: 2020 } };
const KEY = 'cassazione:civile:10787:2024';

beforeEach(() => {
  vi.clearAllMocks();
  appStore.setState({
    highlights: [], annotations: [],
    loadHighlightsForArticle: vi.fn(), loadAnnotationsForArticle: vi.fn(),
  });
});

describe('DecisionDownloads', () => {
  it('«Scarica PDF» saves a file named by the model', () => {
    render(<DecisionDownloads answer={FOUND} identity={FOUND.identita} />);
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(save).toHaveBeenCalledWith('Cass_civ_sez_III_n_10787_2024.pdf');
  });

  it('with the option, the decision\'s own highlights are in the PDF (and only those)', () => {
    const mine = { id: 'h1', normaKey: KEY, articleId: '', rangeSerialized: '', text: 'Secondo', color: 'yellow', startOffset: 16 } as Highlight;
    const other = { ...mine, id: 'h2', normaKey: 'cassazione:civile:1:2024' } as Highlight;
    appStore.setState({ highlights: [mine, other] });
    render(<DecisionDownloads answer={FOUND} identity={FOUND.identita} />);
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(rect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Con le mie evidenziazioni e note'));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(rect).toHaveBeenCalledTimes(1);
  });

  it('the court\'s own PDF is offered for the Cassazione only', () => {
    const { rerender } = render(<DecisionDownloads answer={FOUND} identity={FOUND.identita} />);
    expect(screen.getByRole('button', { name: /PDF originale della Corte/ })).toBeInTheDocument();
    rerender(<DecisionDownloads answer={CONSULTA} identity={CONSULTA.identita} />);
    expect(screen.queryByRole('button', { name: /PDF originale della Corte/ })).toBeNull();
  });

  it('downloads the blob through an object URL, revoked after the click', async () => {
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    fetchOriginalPdf.mockResolvedValue(blob);
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<DecisionDownloads answer={FOUND} identity={FOUND.identita} />);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(screen.getByRole('button', { name: /PDF originale della Corte/ }));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(create).toHaveBeenCalledWith(blob);
      expect(revoke).not.toHaveBeenCalled(); // not at once: the browser may not have begun
      vi.advanceTimersByTime(1000);
      expect(revoke).toHaveBeenCalledWith('blob:x');
    } finally {
      vi.useRealTimers();
    }
    expect(fetchOriginalPdf).toHaveBeenCalledWith(FOUND.identita);
  });

  it('offers no PDF of ours for a decision found without its text, but still the court\'s', () => {
    const bare = { ...FOUND, testo: {} } as FoundDecision;
    render(<DecisionDownloads answer={bare} identity={bare.identita} />);
    expect(screen.queryByRole('button', { name: /Scarica PDF/ })).toBeNull();
    expect(screen.queryByLabelText('Con le mie evidenziazioni e note')).toBeNull();
    expect(screen.getByRole('button', { name: /PDF originale della Corte/ })).toBeInTheDocument();
  });

  it('says so when the court\'s PDF is not available', async () => {
    fetchOriginalPdf.mockResolvedValue({ esito: 'non_disponibile' });
    render(<DecisionDownloads answer={FOUND} identity={FOUND.identita} />);
    fireEvent.click(screen.getByRole('button', { name: /PDF originale della Corte/ }));
    expect(await screen.findByText('Il PDF originale non è disponibile per questa decisione.')).toBeInTheDocument();
  });

  it('says so when the download fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchOriginalPdf.mockRejectedValue(new Error('network'));
    render(<DecisionDownloads answer={FOUND} identity={FOUND.identita} />);
    fireEvent.click(screen.getByRole('button', { name: /PDF originale della Corte/ }));
    expect(await screen.findByText('Download non riuscito: riprova.')).toBeInTheDocument();
  });
});
