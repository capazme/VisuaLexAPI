import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Dossier, DossierItem, NormaVisitata } from '../../../types';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { PublishDossierDialog } from './PublishDossierDialog';

const loadPdfMarks = vi.hoisted(() => vi.fn());
vi.mock('./dossierPdfMarks', () => ({ loadPdfMarks }));
const service = vi.hoisted(() => ({ publish: vi.fn(), updateWithVersion: vi.fn(), getById: vi.fn() }));
vi.mock('../../../services/sharedEnvironmentService', () => ({ sharedEnvironmentService: service }));

const NORM: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' };
const item: DossierItem = { id: 'n1', type: 'norma', data: NORM, addedAt: '2026-10-01', citation: 'art. 2043 c.c.' } as DossierItem;
const dossier = (extra: Partial<Dossier> = {}): Dossier =>
  ({ id: 'd', title: 'Rossi c. Bianchi', createdAt: '2026-10-01', items: [item], kind: 'lavoro', ...extra });
const key = { normaKey: buildItemKey(NORM), articleId: uniqueArticleIdFromNorma(NORM) };

function marks() {
  return new Map([['n1', {
    notes: [{ id: 'a1', ...key, text: 'Il cliente RSSMRA85T10A562S', createdAt: '2026-10-02' }],
    highlights: [{ id: 'h1', ...key, text: 'doloso', color: 'yellow', rangeSerialized: '', startOffset: 3 }],
  }]]);
}

const onAlreadyPublished = vi.fn();

function open(d: Dossier = dossier(), others: Dossier[] = []) {
  const onPublished = vi.fn();
  const view = render(<PublishDossierDialog dossier={d} otherDossiers={others} onClose={() => {}} onPublished={onPublished} onAlreadyPublished={onAlreadyPublished} />);
  const rerender = (next: Dossier) => view.rerender(
    <PublishDossierDialog dossier={next} otherDossiers={others} onClose={() => {}} onPublished={onPublished} onAlreadyPublished={onAlreadyPublished} />,
  );
  return Object.assign(onPublished, { rerender });
}

const publishButton = () => screen.getByRole('button', { name: 'Pubblica' });

beforeEach(() => {
  loadPdfMarks.mockReset().mockResolvedValue(marks());
  service.publish.mockReset().mockResolvedValue({ id: 'e1' });
  service.updateWithVersion.mockReset().mockResolvedValue({ id: 'e1' });
  service.getById.mockReset();
  onAlreadyPublished.mockReset();
});

describe('PublishDossierDialog', () => {
  it('publishes only after the check is ticked, with the highlights and no note by default', async () => {
    const onPublished = open();
    await screen.findByText(/1 voce/);
    expect(publishButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ho controllato: non contiene dati personali' }));
    expect(publishButton()).toBeEnabled();
    fireEvent.click(publishButton());
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('Dossier pubblicato nel Forum'));
    const sent = service.publish.mock.calls[0][0];
    expect(sent).toMatchObject({ sourceDossierId: 'd', includeNotes: false, includeHighlights: true, category: 'other' });
    expect(sent.content.annotations).toEqual([]);
    expect(sent.content.highlights.map((h: { id: string }) => h.id)).toEqual(['h1']);
  });

  it('sends a note once it is ticked, and flags the codice fiscale in it without changing the text', async () => {
    open();
    const note = await screen.findByText('RSSMRA85T10A562S');
    expect(note.tagName).toBe('MARK');
    expect(screen.queryByText(/possibili dati personali in/)).toBeNull();
    const row = note.closest('label')!;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(screen.getByText(/Il controllo automatico ha trovato possibili dati personali in 1 elemento spuntato/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ho controllato: non contiene dati personali' }));
    fireEvent.click(publishButton());
    await waitFor(() => expect(service.publish).toHaveBeenCalled());
    expect(service.publish.mock.calls[0][0].content.annotations[0].text).toBe('Il cliente RSSMRA85T10A562S');
  });

  it('warns once more for a dossier di lavoro, and tells a title that names a person', async () => {
    open(dossier({ title: 'Pratica RSSMRA85T10A562S' }));
    await screen.findByText(/1 voce/);
    expect(screen.getByText('È un dossier di lavoro: controlla con attenzione titolo e note.')).toBeInTheDocument();
    expect(screen.getByText('Possibile dato personale: codice fiscale')).toBeInTheDocument();
  });

  it('has no extra line for a dossier di studio, and says when an article also sits in a dossier di lavoro', async () => {
    const work: Dossier = { ...dossier({ id: 'w', title: 'Pratica Verdi' }) };
    open(dossier({ kind: 'studio' }), [work]);
    await screen.findByText(/1 voce/);
    expect(screen.queryByText(/È un dossier di lavoro/)).toBeNull();
    expect(screen.getAllByText('Anche nel dossier di lavoro «Pratica Verdi»').length).toBeGreaterThan(0);
  });

  it('updates the published copy, starting from what the Forum holds', async () => {
    service.getById.mockResolvedValue({ id: 'e1', title: 'Nel Forum', description: 'desc', category: 'civil', tags: ['a'] });
    const onPublished = open(dossier({ published: { sharedEnvironmentId: 'e1', version: 2, isActive: true, updatedAt: '' } }));
    expect(await screen.findByDisplayValue('Nel Forum')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ho controllato: non contiene dati personali' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('Versione pubblicata aggiornata'));
    expect(service.updateWithVersion).toHaveBeenCalledWith('e1', expect.objectContaining({ title: 'Nel Forum', category: 'civil', tags: ['a'] }));
    expect(service.publish).not.toHaveBeenCalled();
  });

  it('clears the description in the Forum when it is emptied, never leaving the old one', async () => {
    service.getById.mockResolvedValue({ id: 'e1', title: 'Nel Forum', description: 'Pratica Rossi', category: 'civil', tags: [] });
    open(dossier({ published: { sharedEnvironmentId: 'e1', version: 2, isActive: true, updatedAt: '' } }));
    const field = await screen.findByDisplayValue('Pratica Rossi');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ho controllato: non contiene dati personali' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    await waitFor(() => expect(service.updateWithVersion).toHaveBeenCalled());
    expect(service.updateWithVersion.mock.calls[0][1].description).toBeNull();
  });

  it('keeps what the user typed when the dossier is read again, and reads the marks once', async () => {
    service.getById.mockResolvedValue({ id: 'e1', title: 'Nel Forum', description: '', category: 'civil', tags: [] });
    const published = { sharedEnvironmentId: 'e1', version: 2, isActive: true, updatedAt: '' };
    const handle = open(dossier({ published }));
    const field = await screen.findByDisplayValue('Nel Forum');
    fireEvent.change(field, { target: { value: 'Titolo mio' } });
    // `useDossierRefresh`: a new object for the same dossier, every minute.
    handle.rerender(dossier({ published: { ...published }, items: [item] }));
    await screen.findByText(/1 voce/);
    expect(screen.getByDisplayValue('Titolo mio')).toBeInTheDocument();
    expect(loadPdfMarks).toHaveBeenCalledTimes(1);
  });

  it('becomes an update when the server says the dossier is already in the Forum', async () => {
    service.publish.mockRejectedValue({ status: 409, message: 'Questo dossier è già pubblicato nel Forum: aggiornane la versione pubblicata.' });
    open();
    await screen.findByText(/1 voce/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ho controllato: non contiene dati personali' }));
    fireEvent.click(publishButton());
    await waitFor(() => expect(onAlreadyPublished).toHaveBeenCalled());
  });

  it('keeps on an update the note published before, and leaves out what was left out', async () => {
    const published = { sharedEnvironmentId: 'e1', version: 2, isActive: true, updatedAt: '' };
    service.getById.mockResolvedValue({
      id: 'e1', title: 'Nel Forum', description: '', category: 'civil', tags: [],
      content: { dossiers: [{ title: 'x', items: [] }], quickNorms: [], annotations: [{ id: 'a1', ...key, text: 'Il cliente RSSMRA85T10A562S' }], highlights: [] },
    });
    open(dossier({ published }));
    await screen.findByDisplayValue('Nel Forum');
    await screen.findByText(/1 di 1 note · 0 di 1 evidenziazioni/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ho controllato: non contiene dati personali' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    await waitFor(() => expect(service.updateWithVersion).toHaveBeenCalled());
    const content = service.updateWithVersion.mock.calls[0][1].content;
    expect(content.annotations.map((a: { text: string }) => a.text)).toEqual(['Il cliente RSSMRA85T10A562S']);
    expect(content.highlights).toEqual([]);
  });

  it('shows no row to tick on an update until the published copy is read', async () => {
    let answer: (value: unknown) => void = () => {};
    service.getById.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    open(dossier({ published: { sharedEnvironmentId: 'e1', version: 2, isActive: true, updatedAt: '' } }));
    expect(await screen.findByText('Leggo la versione pubblicata…')).toBeInTheDocument();
    expect(screen.queryByText('Il cliente')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1); // only «Ho controllato»
    answer({ id: 'e1', title: 'Nel Forum', description: '', category: 'civil', tags: [],
      content: { dossiers: [{ title: 'x', items: [] }], quickNorms: [], annotations: [{ id: 'a1', ...key, text: 'Il cliente RSSMRA85T10A562S' }], highlights: [] } });
    expect(await screen.findByText(/1 di 1 note/)).toBeInTheDocument();
    expect(screen.getByText('Partono spuntate le note già pubblicate.')).toBeInTheDocument();
  });

  it('shows the server\'s refusal and stays open', async () => {
    // The shape `services/api.ts` rejects with: the server's Italian detail as the message.
    service.publish.mockRejectedValue({ status: 409, message: 'Questo dossier è già pubblicato nel Forum: aggiornane la versione pubblicata.' });
    const onPublished = open();
    await screen.findByText(/1 voce/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ho controllato: non contiene dati personali' }));
    fireEvent.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('già pubblicato nel Forum');
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('says when the notes cannot be read, and publishes nothing until they are', async () => {
    loadPdfMarks.mockRejectedValue(new Error('down'));
    open();
    expect(await screen.findByText(/Non riesco a leggere le note/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ho controllato: non contiene dati personali' }));
    expect(publishButton()).toBeDisabled();
  });
});
