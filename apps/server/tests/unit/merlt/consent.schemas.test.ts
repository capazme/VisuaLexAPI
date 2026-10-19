import { describe, it, expect } from 'vitest';
import {
  merltConsentLevelSchema,
  consentSetRequestSchema,
  consentRevokeRequestSchema,
  consentResponseSchema,
  preferencesForLevel,
} from '../../../src/schemas/merlt/consent';

describe('merltConsentLevelSchema', () => {
  it.each(['none', 'basic', 'full'])('accepts level %s', (level) => {
    expect(merltConsentLevelSchema.safeParse(level).success).toBe(true);
  });

  it('rejects unknown level', () => {
    expect(merltConsentLevelSchema.safeParse('partial').success).toBe(false);
  });
});

describe('consentSetRequestSchema', () => {
  const noticeId = '6f1d2a54-8b3e-4c7a-9e21-5d0a7c3b1f48';

  it('accepts a level with the notice it was chosen under', () => {
    expect(consentSetRequestSchema.safeParse({ level: 'basic', noticeId }).success).toBe(true);
  });

  it('accepts level + notice + reason', () => {
    expect(
      consentSetRequestSchema.safeParse({ level: 'full', noticeId, reason: 'training mode opt-in' }).success
    ).toBe(true);
  });

  it('rejects a level without the notice (a choice counts only under one)', () => {
    expect(consentSetRequestSchema.safeParse({ level: 'basic' }).success).toBe(false);
    expect(consentSetRequestSchema.safeParse({ level: 'basic', noticeId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects missing level', () => {
    expect(consentSetRequestSchema.safeParse({ reason: 'x' }).success).toBe(false);
  });

  it('rejects reason > 500 chars', () => {
    expect(
      consentSetRequestSchema.safeParse({ level: 'basic', reason: 'x'.repeat(501) }).success
    ).toBe(false);
  });
});

describe('consentRevokeRequestSchema', () => {
  it('accepts empty body', () => {
    expect(consentRevokeRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts body with reason', () => {
    expect(
      consentRevokeRequestSchema.safeParse({ reason: 'changed my mind' }).success
    ).toBe(true);
  });

  it('accepts the choice to erase what was collected', () => {
    expect(consentRevokeRequestSchema.safeParse({ deleteData: true }).success).toBe(true);
    expect(consentRevokeRequestSchema.safeParse({ deleteData: 'yes' }).success).toBe(false);
  });
});

describe('consentResponseSchema', () => {
  it('accepts a complete state with null dates', () => {
    const result = consentResponseSchema.safeParse({
      level: 'none',
      storedLevel: 'none',
      noticeAnswered: false,
      notice: null,
      contributionEnabled: false,
      validationEnabled: false,
      graphEnabled: false,
      updatedAt: null,
      lastAuditAt: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts ISO datetime strings', () => {
    const result = consentResponseSchema.safeParse({
      level: 'full',
      storedLevel: 'full',
      noticeAnswered: true,
      notice: { id: 'n1', versione: 1, titolo: 't', corpo: 'c', conferma: 'ok', azione: 'vai' },
      contributionEnabled: true,
      validationEnabled: true,
      graphEnabled: true,
      updatedAt: '2026-05-22T18:00:00.000Z',
      lastAuditAt: '2026-05-22T18:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('preferencesForLevel', () => {
  it('none → everything off', () => {
    expect(preferencesForLevel('none')).toEqual({
      contributionEnabled: false,
      validationEnabled: false,
      graphEnabled: false,
    });
  });

  it('basic → only graph on', () => {
    expect(preferencesForLevel('basic')).toEqual({
      contributionEnabled: false,
      validationEnabled: false,
      graphEnabled: true,
    });
  });

  it('full → everything on', () => {
    expect(preferencesForLevel('full')).toEqual({
      contributionEnabled: true,
      validationEnabled: true,
      graphEnabled: true,
    });
  });
});
