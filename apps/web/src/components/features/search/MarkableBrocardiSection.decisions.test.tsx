import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import { MarkableBrocardiSection } from './MarkableBrocardiSection';

const CONTENT = 'Sul punto si veda Cass. civ., sez. III, n. 12789/2022 e Corte cost. n. 71/2020; il testo non si tocca.';
const ORIGIN = { tabId: 'p-1', blockId: 'act-1', articleId: '2043', label: 'art. 2043 c.c.' };

const pushReadingBack = vi.fn();
const openDecision = vi.fn(() => ({ practiceId: 'p', decisionId: 'd' }));
const original = { pushReadingBack: appStore.getState().pushReadingBack, openDecision: appStore.getState().openDecision };

beforeEach(() => {
  pushReadingBack.mockClear();
  openDecision.mockClear();
  appStore.setState({ loadAnnotationsForArticle: vi.fn(), loadHighlightsForArticle: vi.fn(), highlights: [], annotations: [], pushReadingBack, openDecision } as never);
});
afterEach(() => appStore.setState(original));

const section = (decisionLinks?: { besideId?: string; origin?: typeof ORIGIN }) =>
  render(<MarkableBrocardiSection title="Ratio" content={CONTENT} itemKey="k" sectionArticleId="k/brocardi/ratio" onRequestAddNote={vi.fn()} decisionLinks={decisionLinks} />);

describe('MarkableBrocardiSection: the decisions the prose cites', () => {
  it('links them, the text unchanged, and a click records the way back and opens the decision beside the host', () => {
    const { container } = section({ besideId: 'p-1', origin: ORIGIN });
    const cites = [...container.querySelectorAll('.decision-cite')];
    expect(cites.map((c) => c.textContent)).toEqual(['Cass. civ., sez. III, n. 12789/2022', 'Corte cost. n. 71/2020']);
    expect(container.textContent).toContain(CONTENT);
    fireEvent.click(cites[1]);
    expect(pushReadingBack).toHaveBeenCalledExactlyOnceWith(ORIGIN);
    expect(openDecision).toHaveBeenCalledExactlyOnceWith({ corte: 'corte_costituzionale', numero: 71, anno: 2020 }, { fromLink: true, besideId: 'p-1' });
  });

  it('leaves the prose plain when the section is not told where it is read', () => {
    const { container } = section();
    expect(container.querySelectorAll('.decision-cite')).toHaveLength(0);
    expect(container.textContent).toContain(CONTENT);
  });
});
