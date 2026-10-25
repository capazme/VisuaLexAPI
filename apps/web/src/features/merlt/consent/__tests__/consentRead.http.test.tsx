import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { apiClient } from '../../../../services/api';
import { ConsentProvider } from '../ConsentContext';
import { useConsent } from '../useConsent';
import { _resetConsentReadForTests } from '../consentRead';

/**
 * A server without MERL-T, through the real client: `apiClient` with its interceptors, only the
 * transport answered here. One page load asks once — StrictMode's second effect included, which runs
 * in development only — and the page never asks again (the owners' pass of 20 October 2026 counted
 * several requests per load).
 */
let calls: string[] = [];
const merltDisabled: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  calls.push(`${config.method?.toUpperCase()} ${config.url}`);
  const response = { status: 404, statusText: 'Not Found', data: { detail: 'merlt_disabled' }, headers: {}, config };
  throw new AxiosError('Request failed with status code 404', AxiosError.ERR_BAD_REQUEST, config, null, response);
};
const realAdapter = apiClient.defaults.adapter;

function Probe() {
  const { status, level, needsAnswer } = useConsent();
  return <span data-testid="state">{`${status} ${level} ${String(needsAnswer)}`}</span>;
}

beforeEach(() => {
  calls = [];
  _resetConsentReadForTests();
  apiClient.defaults.adapter = merltDisabled;
});
afterEach(() => {
  apiClient.defaults.adapter = realAdapter;
});

describe('the MERL-T consent with a server without MERL-T (404 merlt_disabled)', () => {
  it('is asked once per page load, under StrictMode, and reads as the disabled consent', async () => {
    render(<StrictMode><ConsentProvider><Probe /></ConsentProvider></StrictMode>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready none false'));
    expect(calls).toEqual(['GET /merlt/consent']);
  });

  it('is not asked again by a provider mounted later on the same page', async () => {
    const first = render(<StrictMode><ConsentProvider><Probe /></ConsentProvider></StrictMode>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready none false'));
    first.unmount();
    render(<StrictMode><ConsentProvider><Probe /></ConsentProvider></StrictMode>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready none false'));
    expect(calls).toEqual(['GET /merlt/consent']);
  });
});
