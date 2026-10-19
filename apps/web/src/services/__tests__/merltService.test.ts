import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- apiClient mock (hoisted above the import of merltService) ----
const post = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock('../api', () => ({
  apiClient: {
    post: (...a: unknown[]) => post(...a),
    get: (...a: unknown[]) => get(...a),
    put: vi.fn(),
    delete: (...a: unknown[]) => del(...a),
  },
}));

import {
  fetchMerltConsent,
  setMerltConsent,
  revokeMerltConsent,
  exportMerltData,
  deleteMerltData,
  type MerltConsentResponse,
} from '../merltService';

const sample: MerltConsentResponse = {
  level: 'full',
  storedLevel: 'full',
  noticeAnswered: true,
  notice: null,
  contributionEnabled: true,
  validationEnabled: true,
  graphEnabled: true,
  updatedAt: null,
  lastAuditAt: null,
};

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  del.mockReset();
});

describe('merltService — consent contract', () => {
  it('fetchMerltConsent GETs /merlt/consent and returns the BFF shape', async () => {
    get.mockResolvedValue({ data: sample });
    const result = await fetchMerltConsent();
    expect(get).toHaveBeenCalledWith('/merlt/consent', expect.anything());
    expect(result).toEqual(sample);
  });

  it('setMerltConsent POSTs { level, noticeId, reason }: a choice is made under a notice', async () => {
    post.mockResolvedValue({ data: sample });
    const result = await setMerltConsent('full', 'notice-1', 'voglio contribuire');
    expect(post).toHaveBeenCalledWith(
      '/merlt/consent',
      { level: 'full', noticeId: 'notice-1', reason: 'voglio contribuire' },
      expect.anything(),
    );
    expect(result).toEqual(sample);
  });

  it('revokeMerltConsent DELETEs /merlt/consent with the reason and whether to erase', async () => {
    del.mockResolvedValue({ data: { ...sample, level: 'none', erasure: { requested: true, completed: false } } });
    const result = await revokeMerltConsent({ reason: 'non mi serve piu', deleteData: true });
    expect(del).toHaveBeenCalledWith('/merlt/consent', { data: { reason: 'non mi serve piu', deleteData: true } });
    expect(result.erasure).toEqual({ requested: true, completed: false });
  });

  it('revokeMerltConsent erases nothing unless asked', async () => {
    del.mockResolvedValue({ data: { ...sample, level: 'none', erasure: { requested: false, completed: false } } });
    await revokeMerltConsent();
    expect(del).toHaveBeenCalledWith('/merlt/consent', { data: { reason: undefined, deleteData: false } });
  });

  it('exportMerltData GETs the download as a blob; deleteMerltData DELETEs /merlt/data', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    get.mockResolvedValue({ data: blob });
    expect(await exportMerltData()).toBe(blob);
    expect(get).toHaveBeenCalledWith('/merlt/data/export', { responseType: 'blob' });
    del.mockResolvedValue({ data: { completed: true } });
    expect(await deleteMerltData()).toEqual({ completed: true });
    expect(del).toHaveBeenCalledWith('/merlt/data');
  });
});


import { sendNerFeedback } from '../merltService';

describe('merltService — NER feedback (Loop β #2)', () => {
  it('sendNerFeedback POSTs /merlt/ner/feedback with the camelCase payload', async () => {
    post.mockResolvedValue({ data: { received: true, feedback_id: 'ner-1', sample_weight: 1.0 } });
    const res = await sendNerFeedback({
      surface: 'article_xref',
      feedbackType: 'correction',
      articleUrn: 'urn:nir:..~art1453',
      selectedText: 'art. 1453',
      correctReference: { actType: 'codice civile', article: '1453' },
    });
    expect(post).toHaveBeenCalledWith(
      '/merlt/ner/feedback',
      expect.objectContaining({
        surface: 'article_xref',
        feedbackType: 'correction',
        correctReference: expect.objectContaining({ actType: 'codice civile' }),
      }),
      expect.anything(),
    );
    expect(res.received).toBe(true);
    expect(res.feedback_id).toBe('ner-1');
  });
});
