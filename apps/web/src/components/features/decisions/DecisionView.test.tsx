import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FetchDecisionAnswer } from '../../../types/decisions';

// The popover is the dossier's, tested there: here, what the view hands it.
vi.mock('../dossier/AddToDossierPopover', () => ({
  AddToDossierPopover: ({ isOpen, sentenza, onAdded, onDuplicate }: {
    isOpen: boolean; sentenza?: { etichetta: string };
    onAdded: (id: string, title: string) => void; onDuplicate: (title: string) => void;
  }) => (isOpen ? (
    <div data-testid="popover">
      {sentenza?.etichetta}
      <button onClick={() => onAdded('d1', 'Pratica')}>Scegli Pratica</button>
      <button onClick={() => onDuplicate('Pratica')}>Scegli doppia</button>
    </div>
  ) : null),
}));

import { DecisionView, type DecisionViewProps } from './DecisionView';

const REF = { corte: 'cassazione' as const, archivio: 'penale' as const, numero: 10787, anno: 2024 };

const FOUND: FetchDecisionAnswer = {
  esito: 'trovata',
  identita: REF,
  attributi: { sezione: '7', tipo: 'sentenza', data_deposito: '2024-03-12' },
  testo: { motivazione: 'RITENUTO IN FATTO\nil ricorrente' },
  fonte: { nome: 'Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)' },
  avvisi: [{ tipo: 'archivio_dedotto', archivio: 'penale', sezione: '7' }],
};

const WITHHELD: FetchDecisionAnswer = {
  esito: 'trovata',
  identita: { ...REF, archivio: 'civile' },
  attributi: { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22', testo_assente: 'oscuramento' },
  testo: {},
  fonte: { nome: 'Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)' },
  avvisi: [{ tipo: 'testo_non_disponibile' }],
};

const CONSULTA: FetchDecisionAnswer = {
  esito: 'trovata',
  identita: { corte: 'corte_costituzionale', numero: 1, anno: 2014 },
  attributi: { tipo: 'sentenza', data_decisione: '2013-12-04', data_deposito: '2014-01-13', ecli: 'ECLI:IT:COST:2014:1' },
  testo: { epigrafe: 'ha pronunciato la seguente', motivazione: 'Considerato in diritto', dispositivo: 'per questi motivi' },
  fonte: { nome: 'Corte costituzionale — dati aperti', licenza: 'CC BY-SA 3.0', url: 'https://www.cortecostituzionale.it/scheda-pronuncia/2014/1' },
  avvisi: [],
};

const AMBIGUOUS = {
  esito: 'ambigua' as const,
  candidati: [
    { identita: { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 }, attributi: { sezione: '3' } },
    { identita: { corte: 'cassazione' as const, archivio: 'penale' as const, numero: 10787, anno: 2024 }, attributi: { sezione: '7' } },
  ],
} satisfies FetchDecisionAnswer;

function view(answer: FetchDecisionAnswer | null, props: Partial<DecisionViewProps> = {}) {
  const handlers = { onRetry: vi.fn(), onChooseCandidate: vi.fn(), onOpenPalette: vi.fn() };
  const utils = render(<DecisionView answer={answer} reference={REF} {...handlers} {...props} />);
  return { ...utils, ...handlers };
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});

describe('DecisionView', () => {
  it('shows the decision, its notice and its source', () => {
    view(FOUND);
    expect(screen.getByText(/Sez\. VII penale · Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(screen.getByText(/la Sez\. VII indicata è quella penale/)).toBeInTheDocument();
    expect(screen.getByText(/Fonte: Corte di cassazione/)).toBeInTheDocument();
  });

  it('draws the decision as an h4 by default (under the tab\'s h3) and as the h1 when asked', () => {
    const tab = view(FOUND);
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent(/Sentenza n\. 10787\/2024/);
    tab.unmount();
    view(FOUND, { headingLevel: 1 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Sentenza n\. 10787\/2024/);
  });

  it('announces the loading in a status that is not inside a busy container', () => {
    view(null);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Caricamento della decisione…');
    expect(status.closest('[aria-busy="true"]')).toBeNull();
  });

  it('copies the citation as lawyers write it', async () => {
    view(FOUND);
    fireEvent.click(screen.getByRole('button', { name: 'Copia citazione' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 10787');
    expect(await screen.findByText('Citazione copiata')).toBeInTheDocument();
  });

  it('copies a link to the decision on this site', async () => {
    view(FOUND);
    fireEvent.click(screen.getByRole('button', { name: 'Copia collegamento' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/sentenze/cassazione-penale/10787/2024`);
    expect(await screen.findByText('Collegamento copiato')).toBeInTheDocument();
  });

  it.each([
    ['there is no clipboard', () => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })],
    ['the clipboard refuses', () => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })],
  ])('says so, and logs why, when a copy fails: %s', async (_case, setUp) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setUp();
    view(FOUND);
    for (const name of ['Copia citazione', 'Copia collegamento']) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(await screen.findByText('Copia non riuscita')).toBeInTheDocument();
    }
    expect(screen.queryByText('Citazione copiata')).toBeNull();
    expect(screen.queryByText('Collegamento copiato')).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('adds the decision to a dossier, labelled as lawyers cite it, and tells how it went', async () => {
    view(FOUND);
    expect(screen.queryByTestId('popover')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi al dossier' }));
    expect(screen.getByTestId('popover')).toHaveTextContent('Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 10787');
    fireEvent.click(screen.getByRole('button', { name: 'Scegli Pratica' }));
    expect(await screen.findByText('Aggiunta a «Pratica»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi al dossier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scegli doppia' }));
    expect(await screen.findByText('Già presente in «Pratica»')).toBeInTheDocument();
  });

  it('draws the actions it is given beside its own', () => {
    view(FOUND, { actions: <button>Altra azione</button> });
    expect(screen.getByRole('button', { name: 'Altra azione' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copia citazione' })).toBeInTheDocument();
  });

  it('draws the text slot in place of the plain text, only when the decision has a text', () => {
    const slot = <div data-testid="slot" />;
    const withText = view(FOUND, { textSlot: slot });
    expect(screen.getByTestId('slot')).toBeInTheDocument();
    expect(withText.container.querySelector('.vlx-decision')).toBeNull();
    withText.unmount();
    view(WITHHELD, { textSlot: slot });
    expect(screen.queryByTestId('slot')).toBeNull();
  });

  it('«Apri sulla fonte» only where the source has a page for the decision, and no licence line', () => {
    const cassazione = view(FOUND);
    expect(screen.queryByRole('link', { name: /Apri sulla fonte/ })).toBeNull();
    cassazione.unmount();
    view(CONSULTA);
    expect(screen.getByRole('link', { name: /Apri sulla fonte/ }))
      .toHaveAttribute('href', 'https://www.cortecostituzionale.it/scheda-pronuncia/2014/1');
    // the owner, 2026-10-04: no licence line; fonte.licenza stays in the data
    expect(screen.getByText('Fonte: Corte costituzionale — dati aperti')).toBeInTheDocument();
    expect(screen.queryByText(/licenza|CC BY-SA/i)).toBeNull();
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['http', 'http://www.cortecostituzionale.it/scheda-pronuncia/2014/1'],
    ['a protocol-relative address', '//evil.example'],
  ])('draws no «Apri sulla fonte» for a source address that is not https (%s)', (_what, url) => {
    if (CONSULTA.esito !== 'trovata') throw new Error('fixture');
    const { container } = view({ ...CONSULTA, fonte: { ...CONSULTA.fonte, url } });
    expect(screen.queryByRole('link', { name: /Apri sulla fonte/ })).toBeNull();
    for (const anchor of container.querySelectorAll('a')) expect(anchor.getAttribute('href')).not.toBe(url);
    expect(screen.getByText('Fonte: Corte costituzionale — dati aperti')).toBeInTheDocument();
  });

  it('a decision without its text shows its particulars and why, and no text block', () => {
    const { container } = view(WITHHELD);
    expect(screen.getByText(/Sez\. III civile · Ordinanza n\. 10787\/2024/)).toBeInTheDocument();
    expect(screen.getByText(
      'Testo non disponibile presso la fonte: la Corte di cassazione lo indica come in fase di oscuramento dei dati personali.',
    )).toBeInTheDocument();
    expect(container.querySelector('.vlx-decision')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copia citazione' })).toBeInTheDocument();
  });

  it('quotes a cited section as text, never as markup', () => {
    if (FOUND.esito !== 'trovata') throw new Error('fixture');
    const { container } = view({ ...FOUND, avvisi: [{ tipo: 'sezione_non_riconosciuta', citata: '<img src=x onerror=alert(1)>' }] });
    expect(screen.getByText('La sezione indicata («<img src=x onerror=alert(1)>») non è riconoscibile ed è stata ignorata.'))
      .toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  describe('two homonyms', () => {
    it('are links to their addresses', () => {
      view(AMBIGUOUS);
      expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
        '/sentenze/cassazione-civile/10787/2024', '/sentenze/cassazione-penale/10787/2024']);
    });

    it('open a candidate in the same tab', () => {
      const { onChooseCandidate } = view(AMBIGUOUS);
      fireEvent.click(screen.getAllByRole('link')[0]);
      expect(onChooseCandidate).toHaveBeenCalledWith(AMBIGUOUS.candidati[0].identita);
    });

    it('leave a modified click to the browser, so it opens as a link should', () => {
      const { onChooseCandidate } = view(AMBIGUOUS);
      const link = screen.getAllByRole('link')[0];
      // whether the view took the click, read after React's handler and before jsdom's (unimplemented)
      // navigation, which is stopped here
      let handled = false;
      const probe = (e: Event) => { handled = e.defaultPrevented; e.preventDefault(); };
      document.addEventListener('click', probe);
      for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
        fireEvent.click(link, init);
        expect(handled).toBe(false);
      }
      expect(onChooseCandidate).not.toHaveBeenCalled();
      fireEvent.click(link);
      expect(handled).toBe(true); // a plain click is handled here
      expect(onChooseCandidate).toHaveBeenCalledTimes(1);
      document.removeEventListener('click', probe);
    });
  });

  it('says why a decision is missing and offers the next year for a penal one in the same tab', () => {
    const { onChooseCandidate } = view({ esito: 'non_trovata', motivo: 'inesistente',
      suggerimento: { corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 2000 } },
    { reference: { corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 1999 } });
    expect(screen.getByText("La decisione n. 1399/1999 non è presente nell'archivio pubblico penale della Cassazione."))
      .toBeInTheDocument();
    const link = screen.getByRole('link', { name: /n\. 1399\/2000/ });
    expect(link).toHaveAttribute('href', '/sentenze/cassazione-penale/1399/2000');
    fireEvent.click(link);
    expect(onChooseCandidate).toHaveBeenCalledWith({ corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 2000 });
  });

  it.each([
    ['the source does not answer', { esito: 'fonte_non_raggiungibile', fonte: 'cassazione' }, 'La fonte non risponde in questo momento.'],
    ['a limit of requests is reached', { esito: 'fonte_non_raggiungibile', fonte: 'quota' }, 'Hai raggiunto il limite di richieste: riprova tra un minuto.'],
    ['the request never reached the server', { esito: 'fonte_non_raggiungibile', fonte: 'rete' }, 'Il server non ha risposto: controlla la connessione e riprova.'],
    ['the service failed', { esito: 'fonte_non_raggiungibile', fonte: 'risposta 502' }, 'Il servizio non ha risposto correttamente: riprova tra poco.'],
    ['something unexpected happened', { esito: 'errore_interno' }, 'Errore imprevisto: non è stato possibile caricare la decisione.'],
  ])('offers Riprova when %s', (_what, answer, message) => {
    const { onRetry } = view(answer as FetchDecisionAnswer);
    expect(screen.getByText(message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a request the route refuses gives the route's reason and sends to the search bar", () => {
    const { onOpenPalette } = view({ esito: 'richiesta_non_valida', errori: { numero: 'Il numero va da 1 a 999999' } });
    expect(screen.getByRole('alert')).toHaveTextContent("La citazione non indica una sentenza leggibile: Il numero va da 1 a 999999.");
    expect(screen.queryByRole('textbox')).toBeNull(); // no lookup form in the view
    fireEvent.click(screen.getByRole('button', { name: 'Cerca nella barra di ricerca' }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it('tells a refused request as a refused address on the page of an address', () => {
    view({ esito: 'richiesta_non_valida', errori: { numero: 'x' } }, { addressShown: true });
    expect(screen.getByRole('alert')).toHaveTextContent("L'indirizzo non indica una sentenza leggibile: x.");
  });

  it('keeps 44px touch targets on mobile on its buttons and on the links to choose from', () => {
    const target = ['min-h-[44px]', 'md:min-h-0'];
    const found = view(FOUND);
    for (const name of ['Copia citazione', 'Copia collegamento', 'Aggiungi al dossier']) {
      expect(screen.getByRole('button', { name })).toHaveClass(...target);
    }
    found.unmount();
    const failure = view({ esito: 'errore_interno' });
    expect(screen.getByRole('button', { name: 'Riprova' })).toHaveClass(...target);
    failure.unmount();
    const refused = view({ esito: 'richiesta_non_valida', errori: { numero: 'x' } });
    expect(screen.getByRole('button', { name: 'Cerca nella barra di ricerca' })).toHaveClass(...target);
    refused.unmount();
    view(AMBIGUOUS);
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass(...target);
  });

  it('draws its links readable on the dark page', () => {
    const consulta = view(CONSULTA);
    expect(screen.getByRole('link', { name: /Apri sulla fonte/ })).toHaveClass('text-primary-600', 'dark:text-primary-400');
    consulta.unmount();
    view(AMBIGUOUS);
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('text-primary-600', 'dark:text-primary-400');
  });
});
