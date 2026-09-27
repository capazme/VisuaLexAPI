import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData } from '../../../../types';

const features = vi.fn();
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({ useMerltFeatures: () => features() }));

const sendNerFeedback = vi.fn();
vi.mock('../../../../services/merltService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/merltService')>()),
  sendNerFeedback: (...a: unknown[]) => sendNerFeedback(...a),
}));

// The MERL-T plugin slots need the consent provider; they are not under test.
vi.mock('../../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));

import { ArticleTabContent } from '../ArticleTabContent';
import { appStore } from '../../../../store/useAppStore';

const NEEDLE = 'decreto sulla semplificazione amministrativa';
const ARTICLE_TEXT = `Primo comma introduttivo.\nIl presente articolo rinvia al ${NEEDLE} per le procedure.\nUltimo comma.`;
const URN = 'urn:nir:stato:legge:1990-08-07;241~art3';

const data: ArticleData = {
  article_text: ARTICLE_TEXT,
  norma_data: {
    tipo_atto: 'legge',
    data: '1990-08-07',
    numero_atto: '241',
    numero_articolo: '3',
    urn: URN,
  },
  brocardi_info: null,
};

const RECT = { x: 40, y: 120, width: 90, height: 18 };
const originalRect = Range.prototype.getBoundingClientRect;

function renderArticle() {
  return render(
    <MemoryRouter>
      <ArticleTabContent data={data} />
    </MemoryRouter>,
  );
}

/** Select NEEDLE in the rendered article body and release the mouse. */
async function selectNeedle() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let target: Text | null = null;
  while ((node = walker.nextNode())) {
    if (node.textContent?.includes(NEEDLE)) {
      target = node as Text;
      break;
    }
  }
  expect(target).not.toBeNull();
  const start = target!.textContent!.indexOf(NEEDLE);
  const range = document.createRange();
  range.setStart(target!, start);
  range.setEnd(target!, start + NEEDLE.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const container = target!.parentElement!.closest('.relative.group\\/content') as HTMLElement;
  fireEvent.mouseUp(container);
  await waitFor(() => expect(screen.getByTitle(/aggiungi nota/i)).toBeInTheDocument());
}

beforeEach(() => {
  sendNerFeedback.mockReset().mockResolvedValue({ received: true, feedback_id: 'f1', sample_weight: 1 });
  // The per-article loaders hit the backend; the flow under test does not need them.
  appStore.setState({ loadAnnotationsForArticle: vi.fn(), loadHighlightsForArticle: vi.fn() });
  Range.prototype.getBoundingClientRect = () =>
    ({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) }) as DOMRect;
});
afterEach(() => {
  Range.prototype.getBoundingClientRect = originalRect;
  window.getSelection()?.removeAllRanges();
});

describe('ArticleTabContent: "Segnala come citazione" (NER missed, Loop β #2)', () => {
  it('is not offered without full consent, and nothing is sent', async () => {
    features.mockReturnValue({ canContribute: false, qaAskable: true, consentLevel: 'basic', merltEnabled: true });
    renderArticle();
    await selectNeedle();
    expect(screen.queryByRole('button', { name: /segnala come citazione/i })).not.toBeInTheDocument();
    expect(sendNerFeedback).not.toHaveBeenCalled();
  });

  it('sends a missed report with offsets in the marker projection and a context window', async () => {
    features.mockReturnValue({ canContribute: true, qaAskable: true, consentLevel: 'full', merltEnabled: true });
    renderArticle();
    await selectNeedle();

    fireEvent.click(screen.getByRole('button', { name: /segnala come citazione/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/tipo atto citato/i), { target: { value: 'decreto legislativo' } });
    fireEvent.change(screen.getByLabelText(/articolo citato/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /^salva$/i }));

    const start = ARTICLE_TEXT.replace(/\n/g, '').indexOf(NEEDLE);
    await waitFor(() => expect(sendNerFeedback).toHaveBeenCalledTimes(1));
    const payload = sendNerFeedback.mock.calls[0][0];
    expect(payload).toMatchObject({
      surface: 'article_xref',
      feedbackType: 'missed',
      articleUrn: URN,
      selectedText: NEEDLE,
      startOffset: start,
      endOffset: start + NEEDLE.length,
      correctReference: { actType: 'decreto legislativo', article: '1', displayText: NEEDLE },
    });
    expect(payload.contextWindow).toContain(NEEDLE);
    expect(await screen.findByText(/segnalazione inviata/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
