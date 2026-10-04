import type { DecisionText } from '../types/decisions';

/**
 * Whether the source gave any block of text. A decision found without its text comes with
 * `testo` `{}` and the notice `testo_non_disponibile`, and then no text block is drawn at all.
 * Any block counts: many Corte costituzionale ordinanze have no motivazione.
 */
export function hasDecisionText(testo: DecisionText): boolean {
  return Boolean(testo.epigrafe || testo.motivazione || testo.dispositivo);
}

/**
 * The lines of a received decision text, grouped into paragraphs at empty lines. Only `\n` is
 * dropped: every other character, spaces included, reaches a text node (design 2026-10-01 S6,
 * the same contract as gotcha 23 for articles).
 */
export function decisionParagraphs(text: string): string[][] {
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of text.split('\n')) {
    if (line === '') {
      if (current.length > 0) paragraphs.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

// The classes DecisionTextView gives its blocks, paragraphs and lines (index.css styles them).
const BLOCK_CLASS = 'vlx-dec-block';
const PARAGRAPH_CLASS = 'vlx-dec-para';
const LINE_CLASS = 'vlx-dec-line';

/** Two lines of a paragraph, one space apart: none is added where either side already has one. */
function joinLines(lines: string[]): string {
  return lines.reduce((text, line) => (/\s$/.test(text) || /^\s/.test(line) ? text + line : `${text} ${line}`));
}

/**
 * A passage of a decision as it reads, for the clipboard. The space between two lines is CSS
 * generated content, so the browser's own copy glues the words ("ordinanzadel"): this puts one
 * space between consecutive lines of a paragraph and a blank line between paragraphs and between
 * blocks, and changes no character of a line. `fragment` is `range.cloneContents()` of a range
 * inside the text DecisionTextView draws, so a selection that starts or ends inside a line is
 * read as it is cut. It only reads the fragment: the text nodes of the page stay as received (S6).
 */
export function decisionClipboardText(fragment: DocumentFragment): string {
  const paragraphs: string[] = [];
  let lines: string[] = [];
  const endParagraph = () => {
    if (lines.length > 0) paragraphs.push(joinLines(lines));
    lines = [];
  };
  const read = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue) lines.push(node.nodeValue); // a selection inside one line is a bare text node
      return;
    }
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
    if (element?.classList.contains(LINE_CLASS)) {
      if (element.textContent) lines.push(element.textContent);
      return;
    }
    const breaks = element?.classList.contains(PARAGRAPH_CLASS) || element?.classList.contains(BLOCK_CLASS);
    if (breaks) endParagraph();
    node.childNodes.forEach(read);
    if (breaks) endParagraph();
  };
  read(fragment);
  endParagraph();
  return paragraphs.join('\n\n');
}
