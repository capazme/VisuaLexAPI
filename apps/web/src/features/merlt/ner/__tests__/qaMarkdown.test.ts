import { describe, it, expect } from 'vitest';
import { parseQaMarkdown, type InlineSpan } from '../qaMarkdown';

/** Every span's plainStart must map exactly onto plainText. */
function expectOffsetsAligned(spans: InlineSpan[], plainText: string): void {
  for (const s of spans) {
    expect(plainText.slice(s.plainStart, s.plainStart + s.text.length)).toBe(s.text);
  }
}

describe('parseQaMarkdown', () => {
  it('parses plain text as a single paragraph with identical plainText', () => {
    const text = 'La risoluzione è disciplinata dall’art. 1453 c.c.';
    const { blocks, plainText } = parseQaMarkdown(text);
    expect(plainText).toBe(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('paragraph');
  });

  it('strips heading markers and records the level', () => {
    const { blocks, plainText } = parseQaMarkdown('## Sintesi');
    expect(blocks).toEqual([
      {
        kind: 'heading',
        level: 2,
        spans: [{ text: 'Sintesi', bold: false, italic: false, plainStart: 0 }],
      },
    ]);
    expect(plainText).toBe('Sintesi');
  });

  it('groups consecutive list items into one list block', () => {
    const { blocks } = parseQaMarkdown('- uno\n- due\n\n1. primo\n2. secondo');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
    if (blocks[0].kind === 'list') expect(blocks[0].items).toHaveLength(2);
    if (blocks[1].kind === 'list') expect(blocks[1].items).toHaveLength(2);
  });

  it('parses bold/italic and keeps plainStart offsets aligned with plainText', () => {
    const { blocks, plainText } = parseQaMarkdown('a **b** *c* _d_ ***e***');
    expect(plainText).toBe('a b c d e');
    expect(blocks[0].kind).toBe('paragraph');
    if (blocks[0].kind !== 'paragraph') return;
    const spans = blocks[0].spans;
    expectOffsetsAligned(spans, plainText);
    expect(spans.find((s) => s.text === 'b')).toMatchObject({ bold: true, italic: false });
    expect(spans.find((s) => s.text === 'c')).toMatchObject({ bold: false, italic: true });
    expect(spans.find((s) => s.text === 'd')).toMatchObject({ bold: false, italic: true });
    expect(spans.find((s) => s.text === 'e')).toMatchObject({ bold: true, italic: true });
  });

  it('joins consecutive paragraph lines preserving the newline in offsets', () => {
    const { blocks, plainText } = parseQaMarkdown('riga uno\nriga due');
    expect(plainText).toBe('riga uno\nriga due');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('paragraph');
    if (blocks[0].kind !== 'paragraph') return;
    expectOffsetsAligned(blocks[0].spans, plainText);
    expect(blocks[0].spans.map((s) => s.text).join('')).toBe('riga uno\nriga due');
  });

  it('keeps offsets aligned across mixed blocks (heading + list + bold)', () => {
    const text = '## Titolo\n\n- **grassetto** e resto\n- secondo\n\nchiusura';
    const { blocks, plainText } = parseQaMarkdown(text);
    for (const b of blocks) {
      if (b.kind === 'list') b.items.forEach((item) => expectOffsetsAligned(item, plainText));
      else expectOffsetsAligned(b.spans, plainText);
    }
    expect(plainText).not.toContain('**');
    expect(plainText).not.toContain('##');
  });

  it('does not treat a bold line start as an unordered list marker', () => {
    const { blocks, plainText } = parseQaMarkdown('**Nota** importante');
    expect(blocks[0].kind).toBe('paragraph');
    expect(plainText).toBe('Nota importante');
  });
});
