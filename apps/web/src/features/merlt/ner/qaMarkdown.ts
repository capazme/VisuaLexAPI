/**
 * Minimal markdown parser for the Q&A synthesis (bold/italic, headings,
 * lists, paragraphs — no external dependency). It produces:
 *  - `blocks`: the render tree (headings / lists / paragraphs of inline spans)
 *  - `plainText`: the full text with all markdown markers stripped, one line
 *    per source line.
 * Every inline span records `plainStart`, its offset inside `plainText`, so
 * citation extraction (and the ±500-char NER context window) runs on the
 * stripped text and maps back onto the rendered spans exactly.
 */

export interface InlineSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Offset of this span's first char inside `plainText`. */
  plainStart: number;
}

export type MarkdownBlock =
  | { kind: 'heading'; level: number; spans: InlineSpan[] }
  | { kind: 'paragraph'; spans: InlineSpan[] }
  | { kind: 'list'; ordered: boolean; items: InlineSpan[][] };

export interface ParsedMarkdown {
  blocks: MarkdownBlock[];
  plainText: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_ITEM_RE = /^\s*[-•]\s+(.*)$|^\s*\*\s+(.*)$/;
const OL_ITEM_RE = /^\s*\d+[.)]\s+(.*)$/;
// ***bold italic*** | **bold** | *italic* | _italic_ — no nesting (minimal).
const INLINE_TOKEN_RE = /\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_]+)_/g;

function parseInline(raw: string, plainOffset: number): { spans: InlineSpan[]; plain: string } {
  const spans: InlineSpan[] = [];
  let plain = '';
  const push = (text: string, bold: boolean, italic: boolean): void => {
    if (!text) return;
    spans.push({ text, bold, italic, plainStart: plainOffset + plain.length });
    plain += text;
  };

  let last = 0;
  for (const m of raw.matchAll(INLINE_TOKEN_RE)) {
    const idx = m.index ?? 0;
    push(raw.slice(last, idx), false, false);
    if (m[1] !== undefined) push(m[1], true, true);
    else if (m[2] !== undefined) push(m[2], true, false);
    else if (m[3] !== undefined) push(m[3], false, true);
    else push(m[4], false, true);
    last = idx + m[0].length;
  }
  push(raw.slice(last), false, false);
  return { spans, plain };
}

export function parseQaMarkdown(text: string): ParsedMarkdown {
  const blocks: MarkdownBlock[] = [];
  let plainText = '';
  let paragraph: InlineSpan[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', spans: paragraph });
      paragraph = [];
    }
  };

  text.split('\n').forEach((line, idx) => {
    // plainText mirrors the source line structure: one '\n' between lines.
    if (idx > 0) plainText += '\n';
    const lineStart = plainText.length;

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      const { spans, plain } = parseInline(heading[2], lineStart);
      plainText += plain;
      blocks.push({ kind: 'heading', level: heading[1].length, spans });
      return;
    }

    const ul = UL_ITEM_RE.exec(line);
    const ol = ul ? null : OL_ITEM_RE.exec(line);
    if (ul || ol) {
      flushParagraph();
      const ordered = ol !== null;
      const content = ol ? ol[1] : (ul?.[1] ?? ul?.[2] ?? '');
      const { spans, plain } = parseInline(content, lineStart);
      plainText += plain;
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && lastBlock.kind === 'list' && lastBlock.ordered === ordered) {
        lastBlock.items.push(spans);
      } else {
        blocks.push({ kind: 'list', ordered, items: [spans] });
      }
      return;
    }

    if (line.trim() === '') {
      // Blank line: paragraph separator; contributes only the '\n' above.
      flushParagraph();
      return;
    }

    // Plain paragraph line. Consecutive lines join into one paragraph; the
    // separating '\n' becomes a plain span so whitespace-pre-wrap keeps it.
    const { spans, plain } = parseInline(line, lineStart);
    if (paragraph.length > 0) {
      paragraph.push({ text: '\n', bold: false, italic: false, plainStart: lineStart - 1 });
    }
    paragraph.push(...spans);
    plainText += plain;
  });

  flushParagraph();
  return { blocks, plainText };
}
