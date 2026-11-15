/**
 * The sign-in form against the real `useAuth`, `authService` and axios client, the server answering through the
 * adapter: what the reader sees when the server says no (LC14).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import axios, { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

vi.mock('../../../services/assistantService', () => ({ assistantService: { features: vi.fn(async () => ({ assistantPassages: false })) } }));

import { memoryStorage } from '../../../test/memoryStorage';
import { apiClient, TOO_MANY_REQUESTS_MESSAGE } from '../../../services/api';
import { renderAuth } from './renderAuth';

const realLocation = window.location;
const form = () => within(screen.getByRole('tabpanel'));

/** The server: `routes` answers by URL; a status is a failure with that status and detail. */
function server(routes: Record<string, { status: number; data?: unknown; headers?: Record<string, string> }>) {
  apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    const answer = routes[config.url ?? ''] ?? { status: 404 };
    const response = { status: answer.status, data: answer.data ?? {}, statusText: '', headers: answer.headers ?? {}, config };
    return answer.status < 400 ? Promise.resolve(response) : Promise.reject(new AxiosError('failed', undefined, config, null, response));
  };
}

function signIn(email = 'a@b.it') {
  fireEvent.change(form().getByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(form().getByLabelText(/^password$/i), { target: { value: 'wrong' } });
  fireEvent.submit(form().getByLabelText(/email/i).closest('form')!);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('location', { pathname: '/login', search: '', hash: '', href: 'http://localhost/login' });
});

afterEach(() => {
  vi.stubGlobal('location', realLocation);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LoginForm — the server says no (LC14)', () => {
  it('a wrong password or an unknown email (401): the Italian words, the email kept, no refresh, no reload', async () => {
    const refresh = vi.spyOn(axios, 'post');
    server({ '/auth/login': { status: 401, data: { detail: 'Invalid credentials' } } });
    renderAuth('/login');
    signIn('mario@studio.it');

    expect(await screen.findByRole('alert')).toHaveTextContent('Email o password non corrette.');
    expect(form().getByLabelText(/email/i)).toHaveValue('mario@studio.it');
    expect(refresh).not.toHaveBeenCalled();
    expect(window.location.href).toBe('http://localhost/login');
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('the limit of requests at sign-in (429): says to retry in a while, in Italian', async () => {
    server({ '/auth/login': { status: 429, data: { detail: 'Too many requests, please try again later' } } });
    renderAuth('/login');
    signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent(TOO_MANY_REQUESTS_MESSAGE);
    // The server blocks for 15 minutes after five attempts: the words promise no time they do not know (#463).
    expect(TOO_MANY_REQUESTS_MESSAGE).toBe('Troppe richieste in poco tempo. Riprova più tardi.');
  });

  it('the limit of requests with the server\'s Retry-After: says how long, in minutes', async () => {
    server({ '/auth/login': { status: 429, data: { detail: 'Too many requests' }, headers: { 'retry-after': '900' } } });
    renderAuth('/login');
    signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Troppe richieste in poco tempo. Riprova tra 15 minuti.');
  });

  it('the limit of requests with a Retry-After under a minute: «tra un minuto»', async () => {
    server({ '/auth/login': { status: 429, headers: { 'retry-after': '40' } } });
    renderAuth('/login');
    signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Troppe richieste in poco tempo. Riprova tra un minuto.');
  });

  it.each([
    [429, TOO_MANY_REQUESTS_MESSAGE],
    [403, 'Richiesta non riuscita (errore 403). Riprova tra poco.'],
  ])('signed in, then /auth/me answers %s: Italian words, never axios’s English', async (status, words) => {
    server({
      '/auth/login': { status: 200, data: { access_token: 'a1', refresh_token: 'r1', token_type: 'bearer' } },
      '/auth/me': { status },
    });
    renderAuth('/login');
    signIn();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(words);
    expect(alert).not.toHaveTextContent(/Request failed/);
  });

  // #463, agreed with Irnerio: the sign-in succeeded and stored its two tokens, then the account was refused. The form
  // says so; the tokens must not stay behind it. A 429 is no refusal: the session stays (LC13).
  it.each([403, 401])('signed in, then /auth/me refuses (%s): both tokens go, no redirect', async (status) => {
    // A 401 starts the refresh, which hands out tokens again; the retried /auth/me is refused once more.
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'a2', refresh_token: 'r2' } });
    server({
      '/auth/login': { status: 200, data: { access_token: 'a1', refresh_token: 'r1', token_type: 'bearer' } },
      '/auth/me': { status },
    });
    renderAuth('/login');
    signIn();

    await screen.findByRole('alert');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(window.location.href).toBe('http://localhost/login');
  });

  it('signed in, then /auth/me answers 429: the tokens stay', async () => {
    server({
      '/auth/login': { status: 200, data: { access_token: 'a1', refresh_token: 'r1', token_type: 'bearer' } },
      '/auth/me': { status: 429 },
    });
    renderAuth('/login');
    signIn();

    await screen.findByRole('alert');
    expect(localStorage.getItem('access_token')).toBe('a1');
    expect(localStorage.getItem('refresh_token')).toBe('r1');
  });
});
