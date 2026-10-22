import { describe, expect, it } from 'vitest';
import { documentKind, formatSize } from '../documentJob';

describe('documentJob (D6)', () => {
  it('names the kind by the file\'s name, for its colour on the row', () => {
    expect(documentKind('Parere.DOCX')).toBe('docx');
    expect(documentKind('pagina.htm')).toBe('html');
    expect(documentKind('note.markdown')).toBe('md');
    expect(documentKind('atto.txt')).toBe('txt');
    expect(documentKind('scansione.pdf')).toBe('other');
  });

  it('writes the size as an Italian reader does', () => {
    expect(formatSize(300)).toBe('1 KB');
    expect(formatSize(840 * 1024)).toBe('840 KB');
    expect(formatSize(2.4 * 1024 * 1024)).toBe('2,4 MB');
    expect(formatSize(15 * 1024 * 1024)).toBe('15 MB');
  });
});
