import { beforeEach, describe, expect, it, vi } from 'vitest';

const legalFetch = vi.fn();
vi.mock('../legalFetch', () => ({ legalFetch: (...args: unknown[]) => legalFetch(...args) }));

import { fetchOriginalPdf } from '../decisionPdfService';

const IDENTITY = { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 } as const;
const reply = (status: number, type: string, extra: object) =>
  ({ status, ok: status < 400, headers: new Headers({ 'Content-Type': type }), ...extra }) as unknown as Response;

beforeEach(() => legalFetch.mockReset());

describe('fetchOriginalPdf', () => {
  it('posts the identity and hands back the PDF as a Blob', async () => {
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    legalFetch.mockResolvedValue(reply(200, 'application/pdf', { blob: async () => blob }));
    expect(await fetchOriginalPdf(IDENTITY)).toBe(blob);
    expect(legalFetch).toHaveBeenCalledWith('/fetch_decision_pdf', expect.objectContaining({
      method: 'POST', body: JSON.stringify(IDENTITY) }));
  });

  it('a JSON answer is the route\'s esito', async () => {
    legalFetch.mockResolvedValue(reply(404, 'application/json', { json: async () => ({ esito: 'non_disponibile' }) }));
    expect(await fetchOriginalPdf(IDENTITY)).toEqual({ esito: 'non_disponibile' });
  });

  it('a limit of requests is the source being unreachable, never "not available"', async () => {
    legalFetch.mockResolvedValue(reply(429, 'application/json', { json: async () => ({ error: 'too many' }) }));
    expect(await fetchOriginalPdf(IDENTITY)).toEqual({ esito: 'fonte_non_raggiungibile' });
  });

  it('an answer that is not the route\'s is unreachable too', async () => {
    legalFetch.mockResolvedValue(reply(502, 'text/html', { json: async () => { throw new Error('not json'); } }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await fetchOriginalPdf(IDENTITY)).toEqual({ esito: 'fonte_non_raggiungibile' });
  });
});
