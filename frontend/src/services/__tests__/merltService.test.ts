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
  type MerltConsentResponse,
} from '../merltService';

const sample: MerltConsentResponse = {
  level: 'full',
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

  it('setMerltConsent POSTs { level, reason } (not PUT, not consentLevel)', async () => {
    post.mockResolvedValue({ data: sample });
    const result = await setMerltConsent('full', 'voglio contribuire');
    expect(post).toHaveBeenCalledWith(
      '/merlt/consent',
      { level: 'full', reason: 'voglio contribuire' },
      expect.anything(),
    );
    expect(result).toEqual(sample);
  });

  it('setMerltConsent works without a reason', async () => {
    post.mockResolvedValue({ data: sample });
    await setMerltConsent('basic');
    expect(post).toHaveBeenCalledWith(
      '/merlt/consent',
      { level: 'basic', reason: undefined },
      expect.anything(),
    );
  });

  it('revokeMerltConsent DELETEs /merlt/consent with reason in the body', async () => {
    const revoked: MerltConsentResponse = {
      level: 'none',
      contributionEnabled: false,
      validationEnabled: false,
      graphEnabled: false,
      updatedAt: null,
      lastAuditAt: null,
    };
    del.mockResolvedValue({ data: revoked });
    const result = await revokeMerltConsent('non mi serve piu');
    expect(del).toHaveBeenCalledWith('/merlt/consent', { data: { reason: 'non mi serve piu' } });
    expect(result.level).toBe('none');
  });
});
