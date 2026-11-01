import { describe, expect, it } from 'vitest';
import { DocxError } from '../docx/docxErrors';
import { docxText, locateChar, roman, type DocxText } from '../docx/docxText';
import { MAX_DEPTH, decodeXmlText, tokenize } from '../docx/xmlTokens';
import { DOCX_XML, paragraph } from './fixtures';
import { compactXml, fixtureParts, legacyDocxText } from './docxZip';

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const body = (inner: string) => `<?xml version="1.0"?><w:document ${W_NS}><w:body>${inner}</w:body></w:document>`;

function readFixture(name: string): { reading: DocxText; parts: Record<string, string> } {
  const parts = fixtureParts(name);
  const reading = docxText({
    document: parts['word/document.xml'],
    footnotes: parts['word/footnotes.xml'],
    endnotes: parts['word/endnotes.xml'],
  });
  return { reading, parts };
}

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof DocxError ? error.code : 'other';
  }
  return undefined;
}

describe('docxText — the same text as the reader it replaces', () => {
  it('reads a document without the defects exactly as before', () => {
    const { reading, parts } = readFixture('plain');
    expect(reading.text).toBe(legacyDocxText(parts['word/document.xml']));
    expect(reading.text).toBe([
      'Tribunale di Esempio',
      'Atto di citazione',
      "Il sottoscritto avvocato, ai sensi dell'art. 2043 c.c. e dell’art. 7 l. 241/1990, chiede quanto segue.",
      'art. 1453 c.c. già richiamato.',
      'Si veda art. 1218 c.c.',
      'Roma, 31 ottobre 2026',
      'Art. 5 Cost.',
      'Art. 24 Cost.',
      'Allegato\t1',
      'prima riga',
      'seconda riga',
      '',
      'Fine.',
    ].join('\n'));
    expect(reading.notes).toEqual([]);
  });

  it('reads the tests’ small memos as before', () => {
    for (const xml of [
      DOCX_XML,
      body(`${paragraph('  rientro  ')}<w:p></w:p><w:p></w:p><w:p></w:p>${paragraph('dopo\t')}`),
      body(`${paragraph('a &lt;b&gt; &quot;c&quot;')}<w:p/>${paragraph('d')}`),
    ]) {
      expect(docxText({ document: xml }).text).toBe(legacyDocxText(xml));
    }
  });
});

describe('docxText — what Word does not show is not read (spec #391 §2.1)', () => {
  it('drops a tracked deletion, a field’s instruction, a text box’s fallback, a move away and hidden runs', () => {
    const { reading, parts } = readFixture('defects');
    // The old reader on the same part: every defect of §10.1 is there.
    const legacy = legacyDocxText(parts['word/document.xml']);
    expect(legacy).toContain("l'art. 5 c.c.");
    expect(legacy).toContain('REF _Ref1');
    expect(legacy).toContain('BOX\nBOX');
    expect(legacy).toContain('1270635');
    expect(legacy).toContain('art. 10 c.c.');

    expect(reading.text).toBe([
      "Visto l'art. 6 c.c. e art. 7.",
      'BOX',
      '',
      'Spostato: art. 9 c.p.',
      'art. 11 c.c. e art. 12 c.c.',
    ].join('\n'));
  });

  it('reads the result of a field and of nested fields, never their instructions', () => {
    const run = (inner: string) => `<w:r>${inner}</w:r>`;
    const xml = body(`<w:p>${[
      run('<w:fldChar w:fldCharType="begin"/>'), run('<w:instrText> IF </w:instrText>'),
      run('<w:fldChar w:fldCharType="begin"/>'), run('<w:instrText> REF x </w:instrText>'),
      run('<w:fldChar w:fldCharType="separate"/>'), run('<w:t>dentro</w:t>'), run('<w:fldChar w:fldCharType="end"/>'),
      run('<w:fldChar w:fldCharType="separate"/>'), run('<w:t>risultato</w:t>'), run('<w:fldChar w:fldCharType="end"/>'),
      run('<w:t xml:space="preserve"> poi</w:t>'),
    ].join('')}</w:p>`);
    expect(docxText({ document: xml }).text).toBe('risultato poi');
  });

  it('closes a field opened outside a deletion and closed inside it, so the text after it is read', () => {
    const xml = body([
      `<w:p><w:r><w:t xml:space="preserve">Prima </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>`,
      `<w:r><w:instrText> REF x </w:instrText></w:r>`,
      `<w:del w:id="1" w:author="Autore di prova"><w:r><w:fldChar w:fldCharType="separate"/></w:r>`,
      `<w:r><w:delText>vecchio</w:delText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:del>`,
      `<w:r><w:t xml:space="preserve"> dopo</w:t></w:r></w:p>`,
      paragraph('art. 5 c.c.'),
    ].join(''));
    expect(docxText({ document: xml }).text).toBe('Prima  dopo\nart. 5 c.c.');
  });

  it('does not count the field characters of a fallback copy', () => {
    const xml = body(`<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a"><w:t>uno</w:t></mc:Choice><mc:Fallback><w:r><w:fldChar w:fldCharType="begin"/></w:r></mc:Fallback></mc:AlternateContent></w:r></w:p>${paragraph('due')}`);
    expect(docxText({ document: xml }).text).toBe('uno\ndue');
  });

  it('reads the first choice of an alternate content and none of the others', () => {
    const xml = body(`<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a"><w:t>uno</w:t></mc:Choice><mc:Choice Requires="b"><w:t>due</w:t></mc:Choice><mc:Fallback><w:t>tre</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>`);
    expect(docxText({ document: xml }).text).toBe('uno');
  });

  it('resolves the namespace, not the prefix', () => {
    const xml = `<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w="urn:other"><x:body><x:p><x:r><x:t>vero</x:t></x:r><w:r><w:t>altro</w:t></w:r></x:p></x:body></x:document>`;
    expect(docxText({ document: xml }).text).toBe('vero');
  });
});

describe('docxText — a run’s special characters are characters of the text', () => {
  it('reads a page break, a carriage return, hyphens, a symbol, a positional tab and a formula', () => {
    const { reading } = readFixture('special');
    expect(reading.text).toBe([
      'Art. 21‑bis l. 241/1990 & art. 3',
      'respon­sabilità § 2',
      'l’art. 2043 c.c. — nota',
      'a capo',
      'prima pagina',
      'seconda pagina\tfine',
      'formula x',
    ].join('\n'));
  });
});

describe('docxText — footnotes and endnotes under «Note»', () => {
  it('numbers the notes in the order the body refers to them, skipping separators and notes not shown', () => {
    const { reading } = readFixture('notes');
    expect(reading.text).toBe([
      'Primo richiamo e secondo.*',
      '',
      'Note',
      '1. Cfr. art. 2043 c.c.',
      'Seconda riga della nota.',
      '2. V. art. 7 l. 241/1990.',
      '* Nota con segno proprio.',
      'i. Art. 1453 c.c.',
    ].join('\n'));
    expect(reading.notes).toEqual([
      { kind: 'footnote', id: '3', label: '1' },
      { kind: 'footnote', id: '2', label: '2' },
      { kind: 'footnote', id: '6', label: '' },
      { kind: 'endnote', id: '2', label: 'i' },
    ]);
    expect(reading.text).not.toContain('cancellata');
    expect(reading.text).not.toContain('senza richiamo');
  });

  it('adds nothing when the body refers to no note', () => {
    const { parts } = readFixture('notes');
    const reading = docxText({ document: body(paragraph('Senza note')), footnotes: parts['word/footnotes.xml'] });
    expect(reading.text).toBe('Senza note');
  });

  it('counts endnotes in roman numerals, as Word does by default', () => {
    expect([1, 4, 9, 14, 40, 90, 400, 1994].map(roman)).toEqual(['i', 'iv', 'ix', 'xiv', 'xl', 'xc', 'cd', 'mcmxciv']);
  });
});

describe('docxText — the map from each character to the XML', () => {
  it('maps every character of every fixture to the character it reads, or to its element', () => {
    for (const name of ['plain', 'defects', 'special', 'notes']) {
      const { reading, parts } = readFixture(name);
      const { text, map } = reading;
      // The segments cover the text, in order, without gaps.
      expect(map.segments[0]?.start).toBe(0);
      expect(map.segments[map.segments.length - 1]?.end).toBe(text.length);
      map.segments.forEach((segment, index) => {
        if (index > 0) expect(segment.start).toBe(map.segments[index - 1].end);
      });

      for (let at = 0; at < text.length; at += 1) {
        const found = locateChar(map, at);
        expect(found, `${name} ${at}`).not.toBeNull();
        const { origin, offset } = found!;
        if (origin.kind === 'text') {
          const xml = parts[origin.part];
          expect(xml.slice(origin.tagStart).startsWith(`<${origin.element}`)).toBe(true);
          expect(decodeXmlText(xml.slice(origin.contentStart, origin.contentEnd))[offset], `${name} ${at}`).toBe(text[at]);
          if (origin.runStart >= 0) expect(xml.slice(origin.runStart, origin.runStart + 5)).toMatch(/^<[wm]:r[ >]/);
        } else if (origin.kind === 'mark') {
          const tag = parts[origin.part].slice(origin.tagStart, origin.tagEnd);
          if (origin.element === 'p') expect(tag).toBe('</w:p>');
          else expect(tag.startsWith(`<w:${origin.element}`)).toBe(true);
        } else {
          expect(name).toBe('notes');
        }
      }
      expect(locateChar(map, text.length)).toBeNull();
    }
  });

  it('counts a w:t’s offsets in its decoded text, across entities', () => {
    const xml = body(paragraph('l&apos;art. 2043 &amp; l&#8217;art. 7'));
    const { text, map } = docxText({ document: xml });
    expect(text).toBe("l'art. 2043 & l’art. 7");
    const seven = text.indexOf('7');
    const found = locateChar(map, seven)!;
    expect(found.origin.kind).toBe('text');
    expect(found.offset).toBe(seven);
    if (found.origin.kind === 'text') {
      expect(xml.slice(found.origin.contentStart, found.origin.contentEnd)).toBe('l&apos;art. 2043 &amp; l&#8217;art. 7');
    }
  });

  it('maps the characters the folding keeps, not the ones it drops', () => {
    const xml = body(`${paragraph('uno   ')}<w:p></w:p><w:p></w:p><w:p></w:p>${paragraph('due')}`);
    const { text, map } = docxText({ document: xml });
    expect(text).toBe('uno\n\ndue');
    expect(locateChar(map, 3)!.origin).toMatchObject({ kind: 'mark', element: 'p' });
    const d = locateChar(map, 5)!;
    expect(d.origin.kind).toBe('text');
    expect(d.offset).toBe(0);
  });
});

describe('docxText — refusals', () => {
  it('refuses a DOCTYPE, so no entity can be declared', () => {
    expect(code(() => docxText({ document: `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaa">]><w:document ${W_NS}/>` }))).toBe('unsafe');
  });

  it('refuses an entity it does not know, and a reference to no character', () => {
    expect(code(() => docxText({ document: body(paragraph('&nbsp;')) }))).toBe('malformed');
    expect(code(() => docxText({ document: body(paragraph('&#0;')) }))).toBe('malformed');
    expect(code(() => docxText({ document: body(paragraph('&#xD800;')) }))).toBe('malformed');
    expect(code(() => docxText({ document: body(paragraph('a & b')) }))).toBe('malformed');
  });

  it('refuses Strict Open XML', () => {
    expect(code(() => docxText({ document: '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body/></w:document>' }))).toBe('strict');
  });

  it('refuses XML that does not nest', () => {
    expect(code(() => docxText({ document: `<w:document ${W_NS}><w:body><w:p></w:body></w:document>` }))).toBe('malformed');
    expect(code(() => docxText({ document: `<w:document ${W_NS}><w:body>` }))).toBe('malformed');
    expect(code(() => docxText({ document: `<w:document ${W_NS}/><w:document ${W_NS}/>` }))).toBe('malformed');
    expect(code(() => docxText({ document: `<w:document ${W_NS} a="1" a="2"/>` }))).toBe('malformed');
  });
});

describe('docxText — a hostile part ends quickly', () => {
  it('refuses a part nested deeper than Word ever nests', () => {
    const deep = `<w:document ${W_NS}>${'<w:sdt>'.repeat(MAX_DEPTH)}${'</w:sdt>'.repeat(MAX_DEPTH)}</w:document>`;
    expect(code(() => docxText({ document: deep }))).toBe('unsafe');
  });

  it('costs a new prefix on every level its length, not its square', () => {
    const levels = MAX_DEPTH - 4; // the document, the paragraph, the run and the text take the other four
    let xml = `<w:document ${W_NS}>`;
    for (let level = 0; level < levels; level += 1) xml += `<w:sdt xmlns:p${level}="urn:x">`;
    xml += `<w:p><w:r><w:t>fondo</w:t></w:r></w:p>${'</w:sdt>'.repeat(levels)}</w:document>`;
    const started = performance.now();
    expect(docxText({ document: xml }).text).toBe('fondo');
    expect(performance.now() - started).toBeLessThan(1000);
    // A prefix declared deep down is gone once its element closes.
    expect(docxText({ document: `<w:document ${W_NS}><w:body><w:sdt xmlns:q="${'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}"></w:sdt><w:p><q:r><q:t>no</q:t></q:r></w:p></w:body></w:document>` }).text).toBe('');
  });

  it('reads many fields left open in linear time', () => {
    const fields = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'.repeat(20_000);
    const started = performance.now();
    expect(docxText({ document: body(`<w:p>${fields}<w:r>${'<w:tab/>'.repeat(20_000)}<w:t>x</w:t></w:r></w:p>`) }).text).toMatch(/x$/);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('tokenize', () => {
  it('reports each token where it lies, reading quoted > and CDATA, skipping comments and declarations', () => {
    const source = '<?xml version="1.0"?><a x="1 > 0" y=\'&amp;\'><!-- c --><b/>t&lt;<![CDATA[<raw>]]></a>';
    const tokens = [...tokenize(source)];
    expect(tokens.map(token => token.type)).toEqual(['open', 'open', 'text', 'text', 'close']);
    const [a, b, text, cdata, close] = tokens;
    expect(a).toMatchObject({ name: 'a', attributes: [{ name: 'x', value: '1 > 0' }, { name: 'y', value: '&' }], selfClosing: false });
    expect(b).toMatchObject({ name: 'b', selfClosing: true });
    expect(text).toMatchObject({ raw: 't&lt;', text: 't<' });
    expect(cdata).toMatchObject({ text: '<raw>' });
    for (const token of tokens) {
      if (token.type === 'text') expect(source.slice(token.start, token.end)).toBe(token.raw);
    }
    expect(source.slice(close.start, close.end)).toBe('</a>');
  });

  it('normalises a literal line end, never an escaped one', () => {
    expect(decodeXmlText('a\r\nb\rc&#13;d')).toBe('a\nb\nc\rd');
  });

  it('keeps the indentation helper honest: compacting leaves a w:t’s spaces alone', () => {
    expect(compactXml('<a>\n  <w:t xml:space="preserve"> x </w:t>\n</a>')).toBe('<a><w:t xml:space="preserve"> x </w:t></a>');
  });
});

describe('the fixtures are clean (the repository is public, spec #391 §10.2)', () => {
  const files = import.meta.glob('./docx/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('carry no path, no e-mail address and no author but the neutral one', () => {
    expect(Object.keys(files).length).toBeGreaterThan(0);
    for (const [path, content] of Object.entries(files)) {
      expect(content, path).not.toMatch(/\/Users\/|\/home\/|[A-Za-z]:\\|\\\\/);
      expect(content, path).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      for (const [, author] of content.matchAll(/w:(?:author|initials)="([^"]*)"/g)) expect(author, path).toBe('Autore di prova');
      for (const tag of ['dc:creator', 'cp:lastModifiedBy', 'Company']) expect(content, path).not.toContain(`<${tag}>`);
    }
  });
});
