import { describe, it, expect } from 'vitest';
import { validatePromotionGate } from '../../../src/services/merlt/promotionGate';

const valid = {
  fonte: 'utente:appunti.pdf',
  reformulatedText: 'La risoluzione estingue il contratto con effetto retroattivo.',
  verbatimExcerpt: 'Risoluzione: scioglimento del vincolo contrattuale (Torrente, p. 120).',
  attested: true,
};

describe('validatePromotionGate', () => {
  it('accepts a citable fonte + reformulated text + attestation', () => {
    expect(validatePromotionGate(valid)).toEqual({ ok: true });
  });

  it('rejects an empty or whitespace fonte', () => {
    expect(validatePromotionGate({ ...valid, fonte: '' })).toEqual({
      ok: false,
      reason: 'missing_fonte',
    });
    expect(validatePromotionGate({ ...valid, fonte: '   ' })).toEqual({
      ok: false,
      reason: 'missing_fonte',
    });
  });

  it('rejects when the proposed text is identical to the verbatim excerpt', () => {
    expect(
      validatePromotionGate({ ...valid, reformulatedText: valid.verbatimExcerpt }),
    ).toEqual({ ok: false, reason: 'not_reformulated' });
  });

  it('treats trivial whitespace/case differences as not reformulated', () => {
    expect(
      validatePromotionGate({
        ...valid,
        reformulatedText: `  ${valid.verbatimExcerpt.toUpperCase()}  `,
      }),
    ).toEqual({ ok: false, reason: 'not_reformulated' });
  });

  it('rejects when the user has not attested the reformulation', () => {
    expect(validatePromotionGate({ ...valid, attested: false })).toEqual({
      ok: false,
      reason: 'not_attested',
    });
  });

  it('rejects empty reformulated text', () => {
    expect(validatePromotionGate({ ...valid, reformulatedText: '   ' })).toEqual({
      ok: false,
      reason: 'not_reformulated',
    });
  });
});
