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
  it('accepts level only', () => {
    expect(consentSetRequestSchema.safeParse({ level: 'basic' }).success).toBe(true);
  });

  it('accepts level + reason', () => {
    expect(
      consentSetRequestSchema.safeParse({ level: 'full', reason: 'training mode opt-in' }).success
    ).toBe(true);
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
});

describe('consentResponseSchema', () => {
  it('accepts a complete state with null dates', () => {
    const result = consentResponseSchema.safeParse({
      level: 'none',
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
