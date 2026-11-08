/**
 * The lesson's format (Percorsi, A1; spec 2026-10-23 §10.3): a closed subset of Markdown — paragraphs, `###`
 * headings, one level of `-` and `1.` lists, `>` quotes, `**bold**`, `*italic*`, and citation links `[testo](#c1)`.
 * Anything else is refused, never stripped: what the assistant sent is what is stored. The text comes from
 * material the user did not write, so the web renders the subset with its own parser and escapes the rest (no
 * `dangerouslySetInnerHTML`: stored XSS, OWASP A03); refusing HTML and links here keeps a second line.
 *
 * Root rule 23 does not apply: a lesson is not `article_text`, and highlights on it stay in the session.
 */

/** A citation marker as the text links it: `#c1` … `#c60`. */
export const CITATION_MARKER = /^c[1-9][0-9]?$/;

/** Every control character but the line feed (tabs and `\r` included; NUL as everywhere, `noNul.ts`). */
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/;
/** An HTML tag, comment, declaration or processing instruction: `<` followed by a letter, `/`, `!` or `?`. */
const HTML = /<[A-Za-z/!?]/;
/** A link or an image as Markdown writes it inline. */
const INLINE_LINK = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g;

export type FormatCheck = { ok: true; markers: string[]; words: number } | { ok: false; reason: string };

/** Lines no subset allows: fences, other heading levels or setext underlines, rules, indented or nested lists, code. */
function lineProblem(line: string): string | null {
  if (line === '') return null;
  if (/^\s/.test(line)) return 'una riga rientrata (elenchi annidati, codice) non è ammessa';
  if (line.startsWith('```') || line.startsWith('~~~')) return 'i blocchi di codice non sono ammessi';
  if (line.startsWith('#') && !/^### \S/.test(line)) return 'sono ammessi solo titoli di terzo livello («### »)';
  if (/^(?:\*{3,}|-{3,}|_{3,}|={2,})\s*$/.test(line)) return 'linee orizzontali e sottolineature di titolo non sono ammesse';
  if (/^[*+] /.test(line)) return 'gli elenchi puntati usano «- »';
  if (/^\d{1,3}[)] /.test(line)) return 'gli elenchi numerati usano «1. »';
  if (/^>\s*>/.test(line)) return 'le citazioni annidate non sono ammesse';
  // A link definition, at the start of a line or inside a quote or a list item, as CommonMark reads one.
  if (/^(?:>\s*|- |\d{1,3}\. )?\[[^\]\n]+\]:/.test(line)) return 'i riferimenti a link non sono ammessi';
  if (line.includes('|') && /^\|.*\|$/.test(line.trim())) return 'le tabelle non sono ammesse';
  return null;
}

/**
 * Checks one block's text. Answers the citation markers it links (in order of first use, without `#`) and its
 * words; a refusal says why, in Italian, for the assistant to correct (the caller names the block).
 */
export function checkLessonText(text: string): FormatCheck {
  if (CONTROL.test(text)) return { ok: false, reason: 'contiene caratteri di controllo (sono ammessi solo gli a capo)' };
  if (HTML.test(text)) return { ok: false, reason: 'contiene tag HTML' };
  if (text.includes('`')) return { ok: false, reason: 'il codice («`») non è ammesso' };
  for (const line of text.split('\n')) {
    const problem = lineProblem(line);
    if (problem) return { ok: false, reason: problem };
  }
  const markers: string[] = [];
  for (const match of text.matchAll(INLINE_LINK)) {
    const [, bang, label, target] = match;
    if (bang) return { ok: false, reason: 'le immagini non sono ammesse' };
    if (!target.startsWith('#') || !CITATION_MARKER.test(target.slice(1))) {
      return { ok: false, reason: `un link può solo citare una voce del dossier («[testo](#c1)»), non «${target.slice(0, 40)}»` };
    }
    if (label.trim() === '') return { ok: false, reason: `la citazione «#${target.slice(1)}» non ha testo` };
    if (!markers.includes(target.slice(1))) markers.push(target.slice(1));
  }
  // What is left once the citation links are taken out may not hold another link's pieces: `](`, `][`, `<…>`.
  const rest = text.replace(INLINE_LINK, '');
  if (/\]\(|\]\[/.test(rest)) return { ok: false, reason: 'un link non è scritto nella forma «[testo](#c1)»' };
  return { ok: true, markers, words: countWords(text) };
}

/** The words of a text as the reading estimate counts them: runs of letters or digits between blanks. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}
