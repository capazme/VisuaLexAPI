import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES, htmlText, readDocumentFile } from '../documentFile';
import { DOCX_XML, storedDocx, testFile as file } from './fixtures';

describe('readDocumentFile', () => {
  it('reads the text of a DOCX in the browser, a paragraph per line', async () => {
    const result = await readDocumentFile(file([storedDocx(DOCX_XML)], 'memoria.docx'));
    expect(result).toEqual({ ok: true, text: "Memoria difensiva\nSi richiama l'art. 2043 c.c. e la l. 241/1990 art. 3." });
  });

  it('reads a TXT as it is and an HTML as its text', async () => {
    expect(await readDocumentFile(file(['  riga uno\n\triga due  '], 'nota.txt'))).toEqual({ ok: true, text: '  riga uno\n\triga due  ' });
    expect(await readDocumentFile(file(['<p>art. <b>2043</b> c.c.</p>'], 'nota.html'))).toEqual({ ok: true, text: 'art. 2043 c.c.\n' });
  });

  it('ends each block of an HTML with a line break, and adds nothing else (a paragraph is a line)', () => {
    const html = '<h1>Memoria</h1><p>Visto il d.lgs. 196/2003,</p><p>l’art. 7 <i>prevede</i></p>'
      + '<ul><li>uno</li><li>due<br>e tre</li></ul><div><p>annidato</p></div><table><tr><td>a</td><td>b</td></tr></table>'
      + '<blockquote>citato</blockquote>coda';
    const text = htmlText(html);
    expect(text).toBe('Memoria\nVisto il d.lgs. 196/2003,\nl’art. 7 prevede\nuno\ndue\ne tre\nannidato\nab\ncitato\ncoda');
    // The characters are textContent's, in order: only line breaks were added.
    const body = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
    expect(text.replace(/\n/g, '')).toBe(body);
  });

  it('keeps the words it has always used for a file it cannot read', async () => {
    expect(await readDocumentFile(file(['%PDF'], 'atto.pdf'))).toEqual({
      ok: false,
      error: 'I PDF scansionati o non testuali richiedono OCR. Per ora importa un PDF testuale o copia il testo in formato TXT/HTML. Il file non è stato inviato al server.',
    });
    expect(await readDocumentFile(file(['x'], 'foglio.xlsx'))).toEqual({ ok: false, error: 'Formato non supportato. Usa TXT, Markdown, HTML o DOCX.' });
    expect(await readDocumentFile(file(['   \n  '], 'vuoto.txt'))).toEqual({ ok: false, error: 'Il documento non contiene testo leggibile.' });
    expect(await readDocumentFile(file(['non è uno zip'], 'rotto.docx'))).toEqual({ ok: false, error: 'Impossibile leggere il documento localmente.' });
    expect(await readDocumentFile(file([storedDocx(DOCX_XML, 'word/styles.xml')], 'senza-testo.docx'))).toEqual({ ok: false, error: 'Impossibile leggere il documento localmente.' });
  });

  it('refuses a file over 15 MB before reading it', async () => {
    const big = file(['x'], 'grande.txt');
    Object.defineProperty(big, 'size', { value: MAX_DOCUMENT_BYTES + 1 });
    expect(await readDocumentFile(big)).toEqual({ ok: false, error: 'Il documento supera il limite locale di 15 MB.' });
  });
});
