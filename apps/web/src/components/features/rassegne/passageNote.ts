import { provenance } from './rassegnaFilters';
import type { RassegnePasso } from './types';

/** The server's limit on a note, in UTF-16 units (`MAX_NOTE_LENGTH`, `dossierController.ts`). */
export const MAX_NOTE_LENGTH = 4000;
/** What the server refuses in a note (`dossierController.ts`, `CONTROL`): below U+0020 but tab, new lines. */
// eslint-disable-next-line no-control-regex -- these are exactly the characters the server refuses
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * A passage of the reviews as a pratica's note (U3, D6): where it sits, the source, its text and the portal's link,
 * plain text. Past the note's limit the text is cut with «…»; the link stays whole. The decisions it cites stay words.
 */
export function passageNote(passo: RassegnePasso): string {
  const head = `${provenance(passo)}\nFonte: Ufficio del Massimario della Corte di cassazione\n\n`;
  const tail = `\n\n${passo.url}`;
  let text = passo.testo.replace(CONTROL, ' ').trim();
  const room = MAX_NOTE_LENGTH - head.length - tail.length;
  if (text.length > room) {
    text = text.slice(0, room - 1);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    text = `${text.trimEnd()}…`;
  }
  return `${head}${text}${tail}`;
}
