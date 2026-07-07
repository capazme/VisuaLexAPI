import { describe, it, expect } from 'vitest';
import {
  classifyIngestionTriggerError,
  defaultGraphDepth,
  GRAPH_LIMIT_MAX,
  GRAPH_LIMIT_STEPS,
  nextGraphLimit,
  PAGE_GRAPH_LIMIT_DEFAULT,
} from '../graphApi';

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

// Wave 2 payload-diet defaults (F4).
describe('graph fetch-size defaults', () => {
  it('the ladder never exceeds the BFF clamp (limit ∈ [1,200])', () => {
    expect(Math.max(...GRAPH_LIMIT_STEPS)).toBe(GRAPH_LIMIT_MAX);
    expect(PAGE_GRAPH_LIMIT_DEFAULT).toBeLessThanOrEqual(GRAPH_LIMIT_MAX);
  });

  it('nextGraphLimit walks the 25→50→100→200 ladder', () => {
    expect(nextGraphLimit(25)).toBe(50);
    expect(nextGraphLimit(50)).toBe(100);
    expect(nextGraphLimit(100)).toBe(200);
    // From the page default (150) the next honest step is the cap.
    expect(nextGraphLimit(PAGE_GRAPH_LIMIT_DEFAULT)).toBe(200);
  });

  it('nextGraphLimit returns null once the ladder is exhausted', () => {
    expect(nextGraphLimit(200)).toBeNull();
    expect(nextGraphLimit(500)).toBeNull();
  });

  it('defaultGraphDepth: 2 for article centers, 1 for concepts', () => {
    expect(defaultGraphDepth(true)).toBe(2);
    expect(defaultGraphDepth(false)).toBe(1);
  });
});
