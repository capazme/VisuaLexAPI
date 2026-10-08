import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Annotation, Highlight } from '../../../types';
import { UnmatchedAnchors } from './UnmatchedAnchors';

const H = { id: 'h1', normaKey: 'k', articleId: '', rangeSerialized: '', text: 'parole sparite', color: 'red', startOffset: 3 } as Highlight;
const N = { id: 'n1', normaKey: 'k', articleId: '', text: 'da verificare', createdAt: '', anchorText: 'ricorso', startOffset: 3 } as Annotation;

describe('UnmatchedAnchors', () => {
  it('draws nothing when everything landed', () => {
    const { container } = render(<UnmatchedAnchors highlights={[]} annotations={[]} reason="changed" onRemoveHighlight={() => {}} onRemoveAnnotation={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts, explains and removes, with the stripe in the highlight colour', () => {
    const onRemoveHighlight = vi.fn();
    const onRemoveAnnotation = vi.fn();
    render(<UnmatchedAnchors highlights={[H]} annotations={[N]} reason="changed" onRemoveHighlight={onRemoveHighlight} onRemoveAnnotation={onRemoveAnnotation} />);
    const box = screen.getByRole('region', { name: 'Non ritrovate nel testo attuale (2)' });
    expect(within(box).getByText('Il testo della fonte è cambiato dopo che le hai create.')).toBeInTheDocument();
    expect(within(box).getByText('«parole sparite»').parentElement!.querySelector('span[aria-hidden]')).toHaveStyle({ backgroundColor: 'hsl(var(--hl-red-bg))' });
    expect(within(box).getByText('«ricorso»')).toBeInTheDocument();
    fireEvent.click(within(box).getByRole('button', { name: 'Rimuovi evidenziazione «parole sparite»' }));
    fireEvent.click(within(box).getByRole('button', { name: 'Rimuovi nota «da verificare»' }));
    expect(onRemoveHighlight).toHaveBeenCalledWith('h1');
    expect(onRemoveAnnotation).toHaveBeenCalledWith('n1');
  });

  it('says there is no text when there is none', () => {
    render(<UnmatchedAnchors highlights={[H]} annotations={[]} reason="no_text" onRemoveHighlight={() => {}} onRemoveAnnotation={() => {}} />);
    expect(screen.getByText('La fonte non mostra più il testo di questa decisione: le tue note ed evidenziazioni restano qui.')).toBeInTheDocument();
  });
});
