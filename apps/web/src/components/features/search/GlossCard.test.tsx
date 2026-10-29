import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GlossCard } from './GlossCard';
import type { ProposalActions } from './BlockAnnotationsPopover';
import type { Proposal } from '../../../types';
import { aiNote } from '../../../utils/__fixtures__/assistantNote';
import { assistantProposalsStore } from '../../../store/assistantProposals';

const gloss = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'g1', kind: 'gloss', normaKey: 'k', text: 'Nei contratti con prestazioni corrispettive', color: null, startOffset: 0, endOffset: 43,
  createdAt: '2026-10-29T09:00:00Z', dossierItemId: 'a1', proposedBy: { clientName: 'Claude Code' },
  assistantRange: { startOffset: 0, text: 'Nei contratti con prestazioni corrispettive' },
  rangeEdited: false, rangeEditedAt: null, rangeEditedBy: null, note: aiNote('Il rimedio della risoluzione.'), ...over,
});
const actions = () => ({
  validate: vi.fn<ProposalActions['validate']>(), flag: vi.fn<ProposalActions['flag']>(), comment: vi.fn<ProposalActions['comment']>(),
  editNote: vi.fn<ProposalActions['editNote']>(), remove: vi.fn<ProposalActions['remove']>(), move: vi.fn<(id: string) => void>(),
});

describe('GlossCard — an application\'s gloss, as a word processor\'s comment (D8)', () => {
  beforeEach(() => assistantProposalsStore.setState({ busy: {} }));

  it('says its state, the passage it is on and its text; «Valida» and «Da rivedere» are toggles', () => {
    const a = actions();
    render(<GlossCard gloss={gloss()} actions={a} />);
    expect(screen.getByRole('article', { name: 'Glossa: Da validare' })).toBeInTheDocument();
    expect(screen.getByText('“Nei contratti con prestazioni corrispettive”')).toBeInTheDocument();
    expect(screen.getByText('Il rimedio della risoluzione.')).toBeInTheDocument();
    const validate = screen.getByRole('button', { name: 'Valida' });
    expect(validate).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(validate);
    expect(a.validate).toHaveBeenCalledWith('g1', true);
    fireEvent.click(screen.getByRole('button', { name: 'Da rivedere' }));
    expect(a.flag).toHaveBeenCalledWith('g1', true);
  });

  it('validated, «Valida» is pressed and gives it back to «da validare»; edited, the application\'s version is one press away', () => {
    const a = actions();
    render(<GlossCard gloss={gloss({ note: aiNote('Il mio testo.', 'validated', { edited: true, assistantText: 'Il rimedio della risoluzione.' }) })} actions={a} />);
    expect(screen.getByRole('article', { name: 'Glossa: Validata, modificata da te' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Valida' }));
    expect(a.validate).toHaveBeenCalledWith('g1', false);
    fireEvent.click(screen.getByRole('button', { name: "Vedi la versione dell'IA" }));
    expect(screen.getByText('Il rimedio della risoluzione.')).toBeInTheDocument();
  });

  it('flagged, it asks «Cosa non va?» and saves the words as the field is left', () => {
    const a = actions();
    render(<GlossCard gloss={gloss({ note: aiNote('Il rimedio della risoluzione.', 'review') })} actions={a} />);
    expect(screen.getByRole('button', { name: 'Da rivedere' })).toHaveAttribute('aria-pressed', 'true');
    const field = screen.getByRole('textbox', { name: 'Cosa non va?' });
    fireEvent.change(field, { target: { value: 'Manca il termine' } });
    fireEvent.blur(field);
    expect(a.comment).toHaveBeenCalledWith('g1', 'Manca il termine');
  });

  it('«Modifica» edits the text in place: «Salva» sends a changed text, never an empty one', () => {
    const a = actions();
    render(<GlossCard gloss={gloss()} actions={a} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modifica' }));
    const box = screen.getByRole('textbox', { name: 'Testo della glossa' });
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(a.editNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Modifica' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Testo della glossa' }), { target: { value: 'Nuovo testo.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(a.editNote).toHaveBeenCalledWith('g1', 'Nuovo testo.');
  });

  it('«Sposta» and «Rimuovi» go to the caller', () => {
    const a = actions();
    render(<GlossCard gloss={gloss()} actions={a} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sposta' }));
    expect(a.move).toHaveBeenCalledWith('g1');
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi' }));
    expect(a.remove).toHaveBeenCalledWith('g1');
  });

  it('while a write is out «Valida» and «Da rivedere» wait, still focusable', () => {
    const a = actions();
    assistantProposalsStore.setState({ busy: { g1: true } });
    render(<GlossCard gloss={gloss()} actions={a} />);
    const validate = screen.getByRole('button', { name: 'Valida' });
    expect(validate).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(validate);
    fireEvent.click(screen.getByRole('button', { name: 'Da rivedere' }));
    expect(a.validate).not.toHaveBeenCalled();
    expect(a.flag).not.toHaveBeenCalled();
  });

  it('the pointer over it or the focus inside it shows its words; leaving both stops', () => {
    const shown = vi.fn();
    render(<GlossCard gloss={gloss()} actions={actions()} onShowPassage={shown} />);
    const card = screen.getByRole('article');
    fireEvent.mouseEnter(card);
    expect(shown).toHaveBeenLastCalledWith(true);
    fireEvent.focus(screen.getByRole('button', { name: 'Valida' }));
    fireEvent.mouseLeave(card);
    expect(shown).toHaveBeenLastCalledWith(true);
    fireEvent.blur(screen.getByRole('button', { name: 'Valida' }), { relatedTarget: document.body });
    expect(shown).toHaveBeenLastCalledWith(false);
  });
});
