import { describe, expect, it } from 'vitest';
import type { Annotation, Highlight } from '../../types';
import { highlightsTxt, notesTxt, slugify } from '../annotationExport';

const NOW = new Date('2026-10-07T10:00:00Z');
const stamp = NOW.toLocaleString('it-IT');
const n = (text: string, anchorText?: string) => ({ id: text, text, anchorText }) as Annotation;
const h = (text: string, color: string) => ({ id: text, text, color }) as Highlight;

// The expected strings are what ArticleTabContent wrote before the helper existed
// (`articleHeader(kind) + body + '\n'`, header lines joined by '\n' with a trailing '').
describe('annotationExport', () => {
  it('writes the notes exactly as the article always did', () => {
    expect(notesTxt('art. 5 c.c.', [n('prima', 'ancora'), n('seconda')], NOW)).toBe(
      `Note — art. 5 c.c.\nEsportato il ${stamp}\n${'─'.repeat(60)}\n` + '1. prima\n   Ancorata a: "ancora"\n\n2. seconda' + '\n',
    );
  });

  it('writes the highlights exactly as the article always did', () => {
    expect(highlightsTxt('art. 5 c.c.', [h('uno', 'yellow'), h('due', 'red')], NOW)).toBe(
      `Evidenziazioni — art. 5 c.c.\nEsportato il ${stamp}\n${'─'.repeat(60)}\n` + '1. [yellow] uno\n\n2. [red] due' + '\n',
    );
  });

  it('slugifies', () => {
    expect(slugify('Codice civile-art-2043')).toBe('codice-civile-art-2043');
  });
});
