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
function server(routes: Record<string, { status: number; data?: unknown }>) {
  apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    const answer = routes[config.url ?? ''] ?? { status: 404 };
    const response = { status: answer.status, data: answer.data ?? {}, statusText: '', headers: {}, config };
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
});
