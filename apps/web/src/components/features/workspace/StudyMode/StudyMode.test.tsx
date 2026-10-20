import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./StudyModeHeader', () => ({ StudyModeHeader: () => null }));
vi.mock('./StudyModeContent', () => ({ StudyModeContent: () => <p>testo</p> }));
vi.mock('./StudyModeToolsPanel', () => ({ StudyModeToolsPanel: () => null }));
vi.mock('./StudyModeSettings', () => ({ StudyModeSettings: () => null }));
vi.mock('../../../ui/AdvancedExportModal', () => ({ AdvancedExportModal: () => null }));
vi.mock('../../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));

import { StudyMode } from './StudyMode';
import { isWorkspaceCovered } from '../../../../utils/findWindowControl';
import type { ArticleData } from '../../../../types';

const ARTICLE: ArticleData = {
  article_text: 'testo',
  norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284' },
};

describe('StudyMode — over the workspace', () => {
  it('leaves Cmd/Ctrl+F to the browser while it is open', () => {
    const { rerender } = render(<StudyMode article={ARTICLE} onClose={vi.fn()} />);
    expect(isWorkspaceCovered()).toBe(true);
    rerender(<StudyMode isOpen={false} article={ARTICLE} onClose={vi.fn()} />);
    expect(isWorkspaceCovered()).toBe(false);
  });

  it('is not a modal dialog: a note popover portalled outside it stays readable to a screen reader', () => {
    render(<StudyMode article={ARTICLE} onClose={vi.fn()} />);
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
