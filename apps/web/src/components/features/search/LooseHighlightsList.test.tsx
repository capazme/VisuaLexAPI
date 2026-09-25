import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LooseHighlightsList } from './LooseHighlightsList';
import type { Highlight } from '../../../types';

const hl = (id: string, text: string, articleId: string): Highlight => ({
  id, normaKey: 'k', articleId, rangeSerialized: '', text, color: 'green', startOffset: 0,
});

describe('LooseHighlightsList', () => {
  it('is not there when every highlight has a sign', () => {
    render(<LooseHighlightsList highlights={[]} articleId="1453" onRemove={vi.fn()} />);
    expect(screen.queryByText('Altre evidenziazioni')).toBeNull();
  });

  it('lists what no sign shows, says where it is, and removes it', () => {
    const onRemove = vi.fn();
    render(
      <LooseHighlightsList
        highlights={[hl('o', 'testo cambiato', '1453'), hl('b', 'la ratio della norma', '1453/brocardi/ratio')]}
        articleId="1453"
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText('Altre evidenziazioni')).toBeInTheDocument();
    expect(screen.getByText('Non più nel testo')).toBeInTheDocument();
    expect(screen.getByText('Brocardi · Ratio')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Rimuovi evidenziazione' })[1]);
    expect(onRemove).toHaveBeenCalledWith('b');
  });
});
