import { describe, it, expect } from 'vitest';
import { classifyIngestionTriggerError } from '../graphApi';

describe('classifyIngestionTriggerError', () => {
  it('maps a 403 (consent guard) to "consent" — apiClient interceptor shape { status }', () => {
    // apiClient's response interceptor rejects with { status, message, data },
    // NOT the raw AxiosError: this is the shape production code receives.
    expect(classifyIngestionTriggerError({ status: 403, message: 'consent_required' })).toBe(
      'consent'
    );
  });

  it('still recognises the raw AxiosError shape as a fallback', () => {
    expect(classifyIngestionTriggerError({ response: { status: 403 } })).toBe('consent');
  });

  it('maps a 5xx to "unavailable" in both shapes', () => {
    expect(classifyIngestionTriggerError({ status: 500 })).toBe('unavailable');
    expect(classifyIngestionTriggerError({ status: 503, message: 'merlt_unavailable' })).toBe(
      'unavailable'
    );
    expect(classifyIngestionTriggerError({ response: { status: 500 } })).toBe('unavailable');
  });

  it('maps a network error (no status anywhere) to "unavailable"', () => {
    expect(classifyIngestionTriggerError(new Error('Network Error'))).toBe('unavailable');
    expect(classifyIngestionTriggerError(undefined)).toBe('unavailable');
    expect(classifyIngestionTriggerError('boom')).toBe('unavailable');
  });
});
