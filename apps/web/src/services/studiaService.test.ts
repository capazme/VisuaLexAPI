import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('./api', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) } }));

import { studiaService } from './studiaService';
import type { SchedaInput } from '../types/studia';

const input: SchedaInput = {
  materia: 'DIRITTO_CIVILE',
  istituto: 'Risoluzione per inadempimento',
  tipo: 'ISTITUTO_DEFINIZIONE',
  domanda: 'Quando si può chiedere la risoluzione?',
  risposta: 'Quando l’inadempimento non è di scarsa importanza.',
  ancore: [{ riferimento: 'art. 1453 c.c.', principale: true }],
};

beforeEach(() => { vi.clearAllMocks(); });

describe('studiaService', () => {
  it('lists with the filters set, leaving the undefined and empty ones out of the query', async () => {
    get.mockResolvedValue({ data: { cards: [{ id: 'k1' }], nextOffset: 50 } });
    const page = await studiaService.list({ materia: 'DIRITTO_PENALE', stato: undefined, q: '', normaKey: 'codice_civile', offset: 0, limit: 50 });
    expect(page).toEqual({ cards: [{ id: 'k1' }], nextOffset: 50 });
    expect(get).toHaveBeenCalledWith('/lingo/cards', { params: { materia: 'DIRITTO_PENALE', normaKey: 'codice_civile', offset: 0, limit: 50 } });
  });

  it('reads one card', async () => {
    get.mockResolvedValue({ data: { id: 'k1' } });
    expect(await studiaService.get('k1')).toEqual({ id: 'k1' });
    expect(get).toHaveBeenCalledWith('/lingo/cards/k1');
  });

  it('creates one card as a call of one and returns its outcome', async () => {
    post.mockResolvedValue({ data: { results: [{ outcome: 'created', id: 'k9' }] } });
    expect(await studiaService.create(input)).toEqual({ outcome: 'created', id: 'k9' });
    expect(post).toHaveBeenCalledWith('/lingo/cards', { cards: [input] });
  });

  it('hands a refusal back with the anchors that failed, in the server’s words', async () => {
    const refused = { outcome: 'refused', detail: 'Un’ancora non è verificabile: la scheda non è stata creata.', anchors: [{ outcome: 'does_not_exist', reference: 'art. 99999 c.c.', detail: 'L’articolo 99999 c.c. non esiste.' }] };
    post.mockResolvedValue({ data: { results: [refused] } });
    expect(await studiaService.create(input)).toEqual(refused);
  });

  it('edits a draft and returns the card', async () => {
    patch.mockResolvedValue({ data: { id: 'k1', istituto: 'Nuovo' } });
    expect(await studiaService.update('k1', input)).toEqual({ outcome: 'updated', card: { id: 'k1', istituto: 'Nuovo' } });
    expect(patch).toHaveBeenCalledWith('/lingo/cards/k1', input);
  });

  it('reads a 400 of an edit as a refusal, and lets the other errors through', async () => {
    const anchors = [{ outcome: 'ambiguous', reference: 'art. 2', detail: 'Quale atto?' }];
    patch.mockRejectedValueOnce({ status: 400, message: 'x', data: { detail: 'Un’ancora non è verificabile: la scheda non è stata modificata.', anchors } });
    expect(await studiaService.update('k1', input)).toEqual({ outcome: 'refused', detail: 'Un’ancora non è verificabile: la scheda non è stata modificata.', anchors });
    const conflict = { status: 409, message: 'Solo una bozza si può modificare.', data: { detail: 'Solo una bozza si può modificare.' } };
    patch.mockRejectedValueOnce(conflict);
    await expect(studiaService.update('k1', input)).rejects.toBe(conflict);
  });

  it('moves cards to the trash', async () => {
    post.mockResolvedValue({ data: { trashId: 't1', moved: ['k1'], notFound: [], notDeletable: [] } });
    expect(await studiaService.trash(['k1'])).toEqual({ trashId: 't1', moved: ['k1'], notFound: [], notDeletable: [] });
    expect(post).toHaveBeenCalledWith('/lingo/cards/trash', { cardIds: ['k1'] });
  });

  it('lists the cards resting on an article by its address', async () => {
    get.mockResolvedValue({ data: { cards: [{ id: 'k1', comunita: false, approvazioni: null }] } });
    expect(await studiaService.forArticle('urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453')).toEqual([{ id: 'k1', comunita: false, approvazioni: null }]);
    expect(get).toHaveBeenCalledWith('/lingo/articolo', { params: { urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453' } });
  });

  it('proposes a card, with the accepted version when there is one', async () => {
    post.mockResolvedValue({ data: { id: 'k1', stato: 'PROPOSTA_COMMUNITY' } });
    expect(await studiaService.propose('k1')).toEqual({ id: 'k1', stato: 'PROPOSTA_COMMUNITY' });
    expect(post).toHaveBeenLastCalledWith('/lingo/cards/k1/proponi', {});
    await studiaService.propose('k1', 't1');
    expect(post).toHaveBeenLastCalledWith('/lingo/cards/k1/proponi', { accettoTestoId: 't1' });
  });

  it('hands back the notice a 409 asks to accept, and lets every other rejection through', async () => {
    const notice = { id: 't2', chiave: 'PROPOSTA_SCHEDA', versione: 2, titolo: 'T', corpo: 'C', conferma: 'K', azione: 'A' };
    post.mockRejectedValueOnce({ status: 409, data: { richiedeTesto: notice } });
    expect(await studiaService.propose('k1')).toEqual({ richiedeTesto: notice });
    const notDraft = { status: 409, data: { detail: 'not a draft' } };
    post.mockRejectedValueOnce(notDraft);
    await expect(studiaService.propose('k1')).rejects.toBe(notDraft);
    const gone = { status: 404 };
    post.mockRejectedValueOnce(gone);
    await expect(studiaService.propose('k1')).rejects.toBe(gone);
  });

  it('withdraws a proposal and returns the card', async () => {
    post.mockResolvedValue({ data: { id: 'k1', stato: 'BOZZA_PERSONALE' } });
    expect(await studiaService.withdraw('k1')).toEqual({ id: 'k1', stato: 'BOZZA_PERSONALE' });
    expect(post).toHaveBeenCalledWith('/lingo/cards/k1/ritira');
  });

  it('reads the current version of a text to accept', async () => {
    get.mockResolvedValue({ data: { id: 't1', chiave: 'PROPOSTA_SCHEDA', accettata: false } });
    expect(await studiaService.text('PROPOSTA_SCHEDA')).toEqual({ id: 't1', chiave: 'PROPOSTA_SCHEDA', accettata: false });
    expect(get).toHaveBeenCalledWith('/lingo/testi/PROPOSTA_SCHEDA');
  });
});
