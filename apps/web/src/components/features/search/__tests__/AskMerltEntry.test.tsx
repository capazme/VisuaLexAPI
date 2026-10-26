import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskMerltEntry } from '../AskMerltEntry';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

const BASE = {
  merltEnabled: true,
  articleUrn: 'urn:nir:stato:codice.civile:1942;2043',
  articleNumber: '2043',
  actType: 'codice civile',
} as const;

beforeEach(() => {
  navigateMock.mockReset();
});

describe('AskMerltEntry', () => {
  it('renders nothing when MERL-T is disabled', () => {
    const { container } = render(
      <AskMerltEntry {...BASE} merltEnabled={false} qaAskable />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  describe('qaAskable (consent ≥ basic)', () => {
    it('navigates to /grafo (Slice 4 absorb) with the QA-PREFILL CONTRACT payload + ?urn=', () => {
      render(<AskMerltEntry {...BASE} qaAskable />);
      const btn = screen.getByRole('button', { name: /chiedi su questo articolo/i });
      fireEvent.click(btn);
      expect(navigateMock).toHaveBeenCalledTimes(1);
      // ?urn= centers the graph on the article; state carries the prefill contract.
      expect(navigateMock).toHaveBeenCalledWith(
        `/grafo?urn=${encodeURIComponent(BASE.articleUrn)}`,
        {
          state: {
            prefillQuery: "Spiegami l'art. 2043 c.c.",
            articleUrn: BASE.articleUrn,
            articleHeading: 'art. 2043 c.c.',
          },
        },
      );
    });

    it('is 44 px to tap on a phone, 16 from md (M1)', () => {
      render(<AskMerltEntry {...BASE} qaAskable />);
      expect(screen.getByRole('button', { name: /chiedi su questo articolo/i })).toHaveClass('min-h-[44px]', 'md:min-h-0');
    });

    it('navigates to bare /grafo (no ?urn=) when the article has no urn', () => {
      render(<AskMerltEntry {...BASE} articleUrn={undefined} qaAskable />);
      fireEvent.click(screen.getByRole('button', { name: /chiedi su questo articolo/i }));
      expect(navigateMock).toHaveBeenCalledWith('/grafo', {
        state: {
          prefillQuery: "Spiegami l'art. 2043 c.c.",
          articleUrn: '',
          articleHeading: 'art. 2043 c.c.',
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
         
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /chiedi su questo articolo/i }));
      const payload = navigateMock.mock.calls[0][1].state;
      expect(payload.articleHeading).toBe('art. 7 l. n. 241 (All. A)');
      expect(payload.prefillQuery).toBe("Spiegami l'art. 7 l. n. 241 (All. A)");
    });
  });

  it('asks for no consent at `none`: nothing is drawn (the consent screen asks, once)', () => {
    const { container } = render(<AskMerltEntry {...BASE} qaAskable={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
