import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskMerltEntry, ASK_TEASER_SNOOZE_KEY } from '../AskMerltEntry';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

// The consent dialog has its own coverage + provider requirement; here we only
// assert it is mounted (open) when the teaser is clicked.
vi.mock('../../../../features/merlt/consent/ConsentDialog', () => ({
  ConsentDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="consent-dialog" /> : null,
}));

const BASE = {
  merltEnabled: true,
  articleUrn: 'urn:nir:stato:codice.civile:1942;2043',
  articleNumber: '2043',
  actType: 'codice civile',
} as const;

beforeEach(() => {
  navigateMock.mockReset();
  localStorage.removeItem(ASK_TEASER_SNOOZE_KEY);
});

describe('AskMerltEntry', () => {
  it('renders nothing when MERL-T is disabled', () => {
    const { container } = render(
      <AskMerltEntry {...BASE} merltEnabled={false} qaAskable consentNone={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when qaAskable is false and consent is not none (basic already handled by qaAskable)', () => {
    const { container } = render(
      <AskMerltEntry {...BASE} qaAskable={false} consentNone={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  describe('qaAskable (consent ≥ basic)', () => {
    it('navigates to /grafo (Slice 4 absorb) with the QA-PREFILL CONTRACT payload + ?urn=', () => {
      render(<AskMerltEntry {...BASE} qaAskable consentNone={false} />);
      const btn = screen.getByRole('button', { name: /chiedi su questo articolo/i });
      fireEvent.click(btn);
      expect(navigateMock).toHaveBeenCalledTimes(1);
      // ?urn= centers the graph on the article; state carries the prefill contract.
      expect(navigateMock).toHaveBeenCalledWith(
        `/grafo?urn=${encodeURIComponent(BASE.articleUrn)}`,
        {
          state: {
            prefillQuery: "Spiegami l'art. 2043 codice civile",
            articleUrn: BASE.articleUrn,
            articleHeading: 'Art. 2043 codice civile',
          },
        },
      );
    });

    it('navigates to bare /grafo (no ?urn=) when the article has no urn', () => {
      render(<AskMerltEntry {...BASE} articleUrn={undefined} qaAskable consentNone={false} />);
      fireEvent.click(screen.getByRole('button', { name: /chiedi su questo articolo/i }));
      expect(navigateMock).toHaveBeenCalledWith('/grafo', {
        state: {
          prefillQuery: "Spiegami l'art. 2043 codice civile",
          articleUrn: '',
          articleHeading: 'Art. 2043 codice civile',
        },
      });
    });

    it('includes the act number and annex in heading + prefill', () => {
      render(
        <AskMerltEntry
          {...BASE}
          articleNumber="7"
          actType="legge"
          actNumber="241"
          annex="A"
          qaAskable
          consentNone={false}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /chiedi su questo articolo/i }));
      const payload = navigateMock.mock.calls[0][1].state;
      expect(payload.articleHeading).toBe('Art. 7 (All. A) legge n. 241');
      expect(payload.prefillQuery).toBe("Spiegami l'art. 7 (All. A) legge n. 241");
    });
  });

  describe('consent none teaser', () => {
    it('shows the teaser chip and opens the consent dialog on click', () => {
      render(<AskMerltEntry {...BASE} qaAskable={false} consentNone />);
      expect(screen.queryByTestId('consent-dialog')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /fai domande su questo articolo/i }));
      expect(screen.getByTestId('consent-dialog')).toBeInTheDocument();
      // The teaser must not navigate — asking requires consent first.
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('"Non ora" dismisses the teaser and persists a snooze', () => {
      render(<AskMerltEntry {...BASE} qaAskable={false} consentNone />);
      fireEvent.click(screen.getByRole('button', { name: /nascondi il suggerimento/i }));
      expect(screen.queryByRole('button', { name: /fai domande su questo articolo/i })).not.toBeInTheDocument();
      const raw = localStorage.getItem(ASK_TEASER_SNOOZE_KEY);
      expect(raw).toBeTruthy();
      expect(Number(raw)).toBeGreaterThan(Date.now());
    });

    it('does not show the teaser again while the snooze is active', () => {
      localStorage.setItem(ASK_TEASER_SNOOZE_KEY, String(Date.now() + 60_000));
      const { container } = render(<AskMerltEntry {...BASE} qaAskable={false} consentNone />);
      expect(container).toBeEmptyDOMElement();
    });

    it('shows the teaser again once the snooze has expired', () => {
      localStorage.setItem(ASK_TEASER_SNOOZE_KEY, String(Date.now() - 60_000));
      render(<AskMerltEntry {...BASE} qaAskable={false} consentNone />);
      expect(screen.getByRole('button', { name: /fai domande su questo articolo/i })).toBeInTheDocument();
    });
  });
});
