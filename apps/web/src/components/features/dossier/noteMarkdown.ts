import { parseLesson, type Inline, type LessonNode } from '../studia/corsi/lessonFormat';

/** `#`, `##` and `###` are one small title in a note: the lessons' parser reads `###` only. */
const HEADINGS = /^#{1,3}[ \t]+/gm;
/** A line of `---`, `***` or `___` alone: a rule between the note's parts. */
const RULE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m;

/**
 * An application's note (D4) as the lessons' closed Markdown (`lessonFormat`), its lines kept: one list of blocks per
 * part, the parts apart by a rule. Everything else, HTML and links included, stays text.
 */
export function parseNote(text: string): LessonNode[][] {
  return text
    .replace(HEADINGS, '### ')
    .split(RULE)
    .map((part) => parseLesson(part, '\n'))
    .filter((nodes) => nodes.length > 0);
}

const words = (inline: Inline[]): string => inline.map((node) => (node.kind === 'text' ? node.text : words(node.children))).join('');

/** The note's words without its marks, for the PDF: a line per block, list items with «•» or their number, no rule. */
export function notePlainText(text: string): string {
  return parseNote(text)
    .flat()
    .map((node) => {
      switch (node.kind) {
        case 'h3':
        case 'p':
          return words(node.inline);
        case 'ul':
          return node.items.map((item) => `• ${words(item)}`).join('\n');
        case 'ol':
          return node.items.map((item, k) => `${node.start + k}. ${words(item)}`).join('\n');
        case 'quote':
          return node.paragraphs.map(words).join('\n');
      }
    })
    .join('\n');
}
