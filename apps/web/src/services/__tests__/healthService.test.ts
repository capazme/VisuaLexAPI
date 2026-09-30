import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../legalFetch', () => ({ legalFetch: vi.fn() }));

import { legalFetch } from '../legalFetch';
import { getHealthSnapshot } from '../healthService';

function answer(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 503, json: async () => body } as Response;
}

describe('getHealthSnapshot', () => {
  beforeEach(() => {
    vi.mocked(legalFetch).mockReset();
  });

  it('names unavailable sources by their label, the doctrine one as Dottrina', async () => {
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
    expect(api?.detail).toBe('Non disponibili: EUR-Lex, Dottrina');
  });
});
