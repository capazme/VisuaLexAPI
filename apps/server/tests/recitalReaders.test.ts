import { describe, expect, it } from 'vitest';
import { citeStoredAct, citeStoredNorm } from '../src/norms/citation';
import { citeStoredItem } from '../src/norms/decisionCitation';
import { rebuildEntry } from '../src/utils/environmentDossiers';
import { readableContent } from '../src/utils/publishedContent';
import { dossierItemFromEntry, rebuildDossierPayload } from '../src/utils/suggestionEntries';
import { RecitalHasNoText, readEntryText } from '../src/assistant/entryText';

// Every server reader of a `norm` entry reads `considerando` (spec
// docs/superpowers/specs/2026-11-17-eu-recitals-design.md §6.3, G-538): the readers that need no database.
const RECITAL = { tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016', considerando: '26' };

describe('the stored citation', () => {
  it('cites a recital by its own citation, and its act as the act', () => {
    expect(citeStoredItem('norm', RECITAL)).toBe('considerando 26, reg. (UE) 2016/679');
    expect(citeStoredItem('norm', { ...RECITAL, _dossierMeta: { important: true } })).toBe('considerando 26, reg. (UE) 2016/679');
    expect(citeStoredAct('norm', RECITAL)).toBe('reg. (UE) 2016/679');
  });

  it('never cites a recital content that does not hold as an article or an act', () => {
    expect(citeStoredItem('norm', { ...RECITAL, numero_articolo: '5' })).toBeNull();
    expect(citeStoredItem('norm', { ...RECITAL, considerando: '' })).toBeNull();
  });

  it('cites an article as before (a pin)', () => {
    expect(citeStoredNorm('norm', { tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016', numero_articolo: '5' }))
      .toBe('art. 5, reg. (UE) 2016/679');
  });
});

describe('published content: environments, the study import, the recovery, «Aggiungi ai miei dossier»', () => {
  it('keeps a recital entry with its field', () => {
    expect(rebuildEntry({ id: 'r1', type: 'norma', data: RECITAL })).toEqual({ ok: true, item: { id: 'r1', type: 'norma', data: RECITAL } });
    const { content, refused } = readableContent({ dossiers: [{ title: 'GDPR', items: [{ id: 'r1', type: 'norma', data: RECITAL }] }] });
    expect(refused).toBe(0);
    expect((content.dossiers[0] as { items: unknown[] }).items[0]).toMatchObject({ type: 'norma', data: RECITAL });
  });

  it('counts a malformed recital among the refused rows of a read, never stores it as an article', () => {
    const { content, refused } = readableContent({ dossiers: [{ title: 'GDPR', items: [{ id: 'r1', type: 'norma', data: { ...RECITAL, considerando: '026' } }] }] });
    expect(refused).toBe(1);
    expect((content.dossiers[0] as { items: unknown[] }).items).toEqual([]);
  });

  it('refuses one with an article beside it, in words', () => {
    expect(rebuildEntry({ id: 'r1', type: 'norma', data: { ...RECITAL, numero_articolo: '5' } })).toMatchObject({
      ok: false, reason: expect.stringMatching(/una voce è un articolo o un considerando/),
    });
  });
});

describe('Forum suggestions', () => {
  it('refuse a recital in words', () => {
    const refused = rebuildDossierPayload({ title: 'GDPR', entries: [{ articleRef: RECITAL }] });
    expect(refused).toEqual({ ok: false, reason: 'Voce 1: I considerando non si possono ancora proporre nel Forum.' });
    expect(dossierItemFromEntry({ articleRef: RECITAL }, 0)).toEqual({ ok: false, reason: 'I considerando non si possono ancora proporre nel Forum.' });
  });
});

describe('the entry\'s text for the assistant', () => {
  it('is not read for a recital, and no request leaves', async () => {
    await expect(readEntryText({ itemType: 'norm', content: RECITAL })).rejects.toBeInstanceOf(RecitalHasNoText);
  });
});

describe('LingoLex cards', () => {
  it('refuse an anchor on a recital\'s key (a pin: cards on recitals come later)', async () => {
    const { lingoCardAncoraInputSchema } = await import('../src/schemas/lingo/card');
    const anchor = { normaKey: 'celex:32016R0679~rct26', articleId: '26', urn: 'urn:x', aknFingerprint: 'a'.repeat(64) };
    expect(lingoCardAncoraInputSchema.safeParse(anchor).success).toBe(false);
  });
});
