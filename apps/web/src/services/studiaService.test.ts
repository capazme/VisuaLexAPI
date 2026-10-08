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
});
