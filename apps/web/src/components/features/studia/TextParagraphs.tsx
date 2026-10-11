import { cn } from '../../../lib/utils';

/**
 * A text's paragraphs: blank lines (empty, or only spaces) separate them, a single line break stays
 * inside one. Read line by line rather than by a pattern, so a long run of whitespace costs one pass.
 */
function splitParagraphs(body: string): string[] {
  const paragraphs: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length > 0) paragraphs.push(lines.join('\n'));
    lines = [];
  };
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') flush();
    else lines.push(line);
  }
  flush();
  return paragraphs;
}

/**
 * A stored text drawn as paragraphs of plain text: React text nodes, never HTML or Markdown, so
 * what an administrator writes cannot carry markup. The one place both the dialog that asks the user
 * to accept a text and the admin's preview of it draw its body.
 */
export function TextParagraphs({ body, className }: { body: string; className?: string }) {
  return (
    <>
      {splitParagraphs(body).map((paragraph, index) => (
        <p key={index} className={cn('whitespace-pre-line break-words', className)}>
          {paragraph}
        </p>
      ))}
    </>
  );
}
