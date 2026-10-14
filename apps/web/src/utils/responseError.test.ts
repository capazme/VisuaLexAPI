import { describe, expect, it } from 'vitest';
import { responseErrorMessage } from './responseError';

const json = (body: unknown, status = 503) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('responseErrorMessage', () => {
  it("gives the server's own words", async () => {
    const message = "Non riesco a leggere ora l'indice di quest'atto, quindi non posso aprire gli artt. 1-5.";
    expect(await responseErrorMessage(json({ error: message }), 'Errore nella richiesta')).toBe(message);
  });

  it('never shows what a 429 or another 5xx carries (English, or an exception\'s text)', async () => {
    expect(await responseErrorMessage(json({ error: 'Rate limit exceeded. Try again later.' }, 429), 'Errore nella richiesta')).toBe('Errore nella richiesta');
    expect(await responseErrorMessage(json({ error: 'KeyError: url' }, 500), 'Errore nella richiesta')).toBe('Errore nella richiesta');
    expect(await responseErrorMessage(json({ error: 'Nessun articolo tra 500 e 510.' }, 404), 'x')).toBe('Nessun articolo tra 500 e 510.');
    expect(await responseErrorMessage(json({ error: 'Formato dell\'articolo non valido: «5a»' }, 400), 'x')).toBe('Formato dell\'articolo non valido: «5a»');
  });

  it('falls back when the body says nothing readable', async () => {
    expect(await responseErrorMessage(json({}), 'Errore nella richiesta')).toBe('Errore nella richiesta');
    expect(await responseErrorMessage(json({ error: '  ' }), 'Errore nella richiesta')).toBe('Errore nella richiesta');
    expect(await responseErrorMessage(json({ error: 42 }), 'Errore nella richiesta')).toBe('Errore nella richiesta');
    expect(await responseErrorMessage(new Response('<html>502</html>', { status: 502 }), 'Errore nella richiesta')).toBe('Errore nella richiesta');
  });
});
