import type { Annotation, Highlight } from '../types';
import { saveBlob } from './saveBlob';

/** The reader's notes or highlights as the plain text the «Esporta in .txt» actions write. */
function header(kind: 'Evidenziazioni' | 'Note', title: string, now: Date): string {
  return [`${kind} — ${title}`, `Esportato il ${now.toLocaleString('it-IT')}`, '─'.repeat(60), ''].join('\n');
}

export function notesTxt(title: string, notes: readonly Annotation[], now: Date = new Date()): string {
  const body = notes.map((n, i) => {
    const lines = [`${i + 1}. ${n.text}`];
    if (n.anchorText) lines.push(`   Ancorata a: "${n.anchorText}"`);
    return lines.join('\n');
  }).join('\n\n');
  return header('Note', title, now) + body + '\n';
}

export function highlightsTxt(title: string, highlights: readonly Highlight[], now: Date = new Date()): string {
  const body = highlights.map((h, i) => `${i + 1}. [${h.color}] ${h.text}`).join('\n\n');
  return header('Evidenziazioni', title, now) + body + '\n';
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function downloadTxt(content: string, filenameBase: string): void {
  saveBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${filenameBase}.txt`);
}
