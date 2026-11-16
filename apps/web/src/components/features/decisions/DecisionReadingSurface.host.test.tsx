import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import type { SearchParams } from '../../../types';
import type { DecisionIdentity, DecisionText } from '../../../types/decisions';
import { ReadingHostContext } from '../practice/readingHost';
import { DecisionReadingSurface } from './DecisionReadingSurface';

/** LC52 c2: a norm cited in a decision goes to whoever hosts the reading. */

const IDENTITY: DecisionIdentity = { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 };
const TESTO: DecisionText = {
  epigrafe: 'LA CORTE DI CASSAZIONE\nsezione terza civile',
  motivazione: 'Il ricorrente invoca l\'art. 2043 c.c.',
  dispositivo: 'P.Q.M. rigetta il ricorso.',
};

beforeEach(() => {
  appStore.setState({
    searchTrigger: null, readingBackStack: [], highlights: [], annotations: [],
    loadHighlightsForArticle: vi.fn(), loadAnnotationsForArticle: vi.fn(), pushReadingBack: vi.fn(),
  });
});

describe('DecisionReadingSurface — a cited norm goes to the host (LC52 c2)', () => {
  it('the host searches it, beside the host tab; the store\'s search is not asked', () => {
    const search = vi.fn<(params: SearchParams) => void>();
    const { container } = render(
      <ReadingHostContext.Provider value={{ search }}>
        <DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{ sezione: '3' }} hostTabId="dec-tab" />
      </ReadingHostContext.Provider>,
    );
    fireEvent.click(container.querySelector('.citation-hover')!);
    expect(search).toHaveBeenCalledExactlyOnceWith({
      act_type: 'codice civile', act_number: '', date: '', article: '2043', version: 'vigente', besideId: 'dec-tab',
    });
    expect(appStore.getState().searchTrigger).toBeNull();
  });
});
