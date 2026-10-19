import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../legalFetch', () => ({ legalFetch: vi.fn() }));

import { legalFetch } from '../legalFetch';
import { cardSourcesAnswer, getHealthSnapshot } from '../healthService';

function answer(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 503, json: async () => body } as Response;
}

describe('getHealthSnapshot', () => {
  beforeEach(() => {
    vi.mocked(legalFetch).mockReset();
  });

  it('names unavailable sources by their label, the doctrine one credited to its source', async () => {
    vi.mocked(legalFetch).mockImplementation(async (url) =>
      String(url).startsWith('/api/')
        ? answer({ status: 'ok' })
        : answer(
            {
              services: {
                normattiva: { status: 'ok' },
                eurlex: { status: 'error' },
                brocardi: { status: 'error' },
              },
            },
            false,
          ),
    );
    const snapshot = await getHealthSnapshot(new AbortController().signal);
    const api = snapshot.services.find((s) => s.name === 'API normativa e fonti');
    expect(api?.state).toBe('degraded');
    expect(api?.detail).toBe('Non disponibili: EUR-Lex, Dottrina (Brocardi.it)');
  });
});

describe('cardSourcesAnswer', () => {
  beforeEach(() => {
    vi.mocked(legalFetch).mockReset();
  });

  it('is true only when Normattiva says ok, whatever the other sources say', async () => {
    vi.mocked(legalFetch).mockResolvedValue(answer({ services: { normattiva: { status: 'ok' }, eurlex: { status: 'error' } } }, false));
    expect(await cardSourcesAnswer(new AbortController().signal)).toBe(true);
    expect(legalFetch).toHaveBeenCalledWith('/health/detailed', expect.anything());

    vi.mocked(legalFetch).mockResolvedValue(answer({ services: { normattiva: { status: 'error' }, eurlex: { status: 'ok' } } }, false));
    expect(await cardSourcesAnswer(new AbortController().signal)).toBe(false);
  });

  it('is false for a body without the services, and when the probe cannot be reached', async () => {
    vi.mocked(legalFetch).mockResolvedValue(answer({ status: 'ok' }));
    expect(await cardSourcesAnswer(new AbortController().signal)).toBe(false);

    vi.mocked(legalFetch).mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await cardSourcesAnswer(new AbortController().signal)).toBe(false);
  });
});
