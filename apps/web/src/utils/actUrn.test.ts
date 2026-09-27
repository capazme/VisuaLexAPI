import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveAct } from './actUrn';

const originalFetch = global.fetch;

function mockFetchOnce(payload: unknown) {
  const spy = vi.fn().mockResolvedValue({ json: async () => payload });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

/** What the backend returns for "codice civile": the alias, expanded. */
const RESOLVED_CC = {
  norma_data: [
    {
      tipo_atto: 'codice civile',
      tipo_atto_reale: 'regio decreto',
      data: '1942-03-16',
      numero_atto: '262',
      url: 'urn:act-level',
      urn: 'urn:article-level',
    },
  ],
};

describe('resolveAct', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the act parameters plus the article probe', async () => {
    const spy = mockFetchOnce(RESOLVED_CC);

    await resolveAct({ act_type: 'codice civile' });

    expect(spy).toHaveBeenCalledOnce();
    const [endpoint, init] = spy.mock.calls[0];
    expect(endpoint).toBe('/fetch_norma_data');
    const body = JSON.parse((init as RequestInit).body as string);
    // '1' is a probe, not a request for article 1: the endpoint refuses to
    // build a NormaVisitata without an article value.
    expect(body.article).toBe('1');
    expect(body.act_type).toBe('codice civile');
  });

  it('omits blank optional parameters rather than sending empty strings', async () => {
    const spy = mockFetchOnce(RESOLVED_CC);

    await resolveAct({ act_type: 'codice civile', act_number: '', date: '' });

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.act_number).toBeUndefined();
    expect(body.date).toBeUndefined();
  });

  it('keeps the RESOLVED identity, not the requested one', async () => {
    mockFetchOnce(RESOLVED_CC);

    const { norma } = await resolveAct({ act_type: 'codice civile' });

    // The whole point: a block seeded from the request would carry no date and
    // no act number, and would never merge with the same act arriving from a
    // search — the workspace would grow a duplicate tab.
    expect(norma.numero_atto).toBe('262');
    expect(norma.data).toBe('1942-03-16');
    expect(norma.tipo_atto_reale).toBe('regio decreto');
  });

  it('stores the act-level url on the norma, matching search-built blocks', async () => {
    mockFetchOnce(RESOLVED_CC);

    const { urn, norma } = await resolveAct({ act_type: 'codice civile' });

    expect(norma.urn).toBe('urn:act-level');
    // The tree endpoint keeps the article-level identifier it has always used.
    expect(urn).toBe('urn:article-level');
  });

  it('falls back to the act-level url when no article-level urn is present', async () => {
    mockFetchOnce({ norma_data: [{ tipo_atto: 'codice civile', url: 'urn:act-level' }] });

    const { urn } = await resolveAct({ act_type: 'codice civile' });

    expect(urn).toBe('urn:act-level');
  });

  it('falls back to the requested parameters for fields the backend omits', async () => {
    mockFetchOnce({ norma_data: [{ url: 'urn:act-level' }] });

    const { norma } = await resolveAct({
      act_type: 'legge',
      act_number: '241',
      date: '1990-08-07',
    });

    expect(norma.tipo_atto).toBe('legge');
    expect(norma.numero_atto).toBe('241');
    expect(norma.data).toBe('1990-08-07');
  });

  it('surfaces a backend error instead of resolving to nothing', async () => {
    mockFetchOnce({ error: 'tipo atto sconosciuto' });

    await expect(resolveAct({ act_type: 'codice inesistente' }))
      .rejects.toThrow('tipo atto sconosciuto');
  });

  it('throws when the response carries no usable identifier', async () => {
    mockFetchOnce({ norma_data: [{}] });

    await expect(resolveAct({ act_type: 'codice civile' })).rejects.toThrow(/URN/);
  });

  it('throws when norma_data is missing entirely', async () => {
    mockFetchOnce({});

    await expect(resolveAct({ act_type: 'codice civile' })).rejects.toThrow(/URN/);
  });
});
