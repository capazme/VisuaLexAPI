import { describe, expect, it } from 'vitest';
import { responseErrorMessage } from './responseError';

const json = (body: unknown, status = 503) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('responseErrorMessage', () => {
  it("gives the server's own words", async () => {
    const message = "Non riesco a leggere ora l'indice di quest'atto, quindi non posso aprire gli artt. 1-5.";
    expect(await responseErrorMessage(json({ error: message }), 'Errore nella richiesta')).toBe(message);
  });

  it('falls back when the body says nothing readable', async () => {
    expect(await responseErrorMessage(json({}), 'Errore nella richiesta')).toBe('Errore nella richiesta');
    expect(await responseErrorMessage(json({ error: '  ' }), 'Errore nella richiesta')).toBe('Errore nella richiesta');
    expect(await responseErrorMessage(json({ error: 42 }), 'Errore nella richiesta')).toBe('Errore nella richiesta');
    expect(await responseErrorMessage(new Response('<html>502</html>', { status: 502 }), 'Errore nella richiesta')).toBe('Errore nella richiesta');
  });
});
