import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DossierItem } from '../../../types';
import { DossierNoteList } from './DossierNoteList';
import { DossierNotesSection } from './DossierNotesSection';

type NoteItem = Extract<DossierItem, { type: 'note' }>;
const app = { clientName: 'Claude' };
const note = (data: string, createdBy: NoteItem['createdBy'] = null, aboutItemId: string | null = null): NoteItem =>
  ({ id: 'n1', type: 'note', data, addedAt: '2026-11-10T09:00:00Z', aboutItemId, createdBy });

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<b>grassetto finto</b>',
  '[clic](javascript:alert(1))',
  '[sito](https://example.com)',
].join('\n\n');

describe('D4: a note from a connected application is read as simple Markdown', () => {
  it('draws bold, headings and both lists, the free notes and an article\'s alike', () => {
    const text = '## Scadenze\n\n**Garante**: 72 ore\n\n- prima voce\n- seconda voce\n\n1. uno\n2. due';
    const { container, unmount } = render(<DossierNotesSection notes={[note(text, app)]} onRemove={() => {}} />);
    expect(screen.getByText('Garante').tagName).toBe('STRONG');
    expect(screen.getByText('Scadenze')).toBeInTheDocument();
    expect(screen.queryByText(/##/)).toBeNull();
    expect(screen.getByText('prima voce').closest('ul')?.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('ol')?.querySelectorAll('li')).toHaveLength(2);
    unmount();
    render(<DossierNoteList notes={[note(text, app, 'a1')]} />);
    expect(screen.getByText('Garante').tagName).toBe('STRONG');
    expect(screen.getByText('prima voce').closest('ul')).not.toBeNull();
  });

  it('keeps a plain note\'s line breaks (the notes written before D4: «1) …» on their own lines)', () => {
    const { container } = render(<DossierNoteList notes={[note('SCADENZE\n1) Garante: 72 ore\n2) Interessati: senza ritardo', app, 'a1')]} />);
    expect(container.textContent).toContain('SCADENZE\n1) Garante: 72 ore\n2) Interessati: senza ritardo');
  });

  it('shows HTML as text, never as elements, and makes no link at all', () => {
    const { container } = render(<DossierNotesSection notes={[note(HOSTILE, app)]} onRemove={() => {}} />);
    expect(container.querySelector('script, img, b, a')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('[clic](javascript:alert(1))')).toBeInTheDocument();
    const list = render(<DossierNoteList notes={[note(HOSTILE, app, 'a1')]} />);
    expect(list.container.querySelector('script, img, b, a')).toBeNull();
  });
});

describe('D4: the user\'s own note stays as written', () => {
  it('the same `**` and `##` are text', () => {
    const text = '## Scadenze\n**Garante**: 72 ore';
    const { container } = render(<DossierNotesSection notes={[note(text)]} onRemove={() => {}} />);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain(text);
    const list = render(<DossierNoteList notes={[note(text, null, 'a1')]} />);
    expect(list.container.querySelector('strong')).toBeNull();
  });
});

describe('D4: a long application note, folded', () => {
  it('shows its heading and first lines, and «Mostra tutto» opens it', () => {
    const text = `## Scadenzario\n\n${Array.from({ length: 8 }, (_, i) => `- punto ${i + 1}`).join('\n')}`;
    render(<DossierNotesSection notes={[note(text, app)]} onRemove={() => {}} />);
    expect(screen.getByText('Scadenzario')).toBeInTheDocument();
    expect(screen.getByText('punto 1')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Mostra tutto' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Mostra meno' })).toHaveAttribute('aria-expanded', 'true');
  });
});
