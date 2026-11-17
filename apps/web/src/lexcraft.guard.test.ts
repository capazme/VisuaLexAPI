import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// The name a user reads is LexCraft (D-157); the code keeps VisuaLex (D-120). This refuses «VisuaLex» on any line of
// the sources that is not a comment, outside the files below. Commands and ids use `SERVER_NAME` or lower case, so
// they never match; the release notes (`content/novita/*.md`) are Markdown, outside the scan.
const src = __dirname; // apps/web/src

/** Files where «VisuaLex» still reaches the screen on purpose, each with why. */
const ALLOWED: Record<string, string> = {
  [join('components', 'features', 'dossier', 'PublishDossierDialog.tsx')]: 'the owner\'s publication warning: to confirm',
  [join('features', 'merlt', 'ops', 'ingestion', 'IngestionRunForm.tsx')]: 'admin only: names the backend\'s `visualex_tree` source',
  [join('features', 'merlt', 'ops', 'ingestion', 'BatchListTable.tsx')]: 'admin only: names the backend\'s `visualex_tree` source',
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** Lines outside comments: `//` and `*` lines, and block comments (`/*`, `{/*`) opened at a line's start. */
function codeLines(text: string): [number, string][] {
  let inBlock = false;
  return text.split('\n').flatMap((line, i): [number, string][] => {
    const t = line.trim();
    if (inBlock) { inBlock = !t.includes('*/'); return []; }
    if (/^(\{?\/\*)/.test(t)) { inBlock = !t.includes('*/'); return []; }
    return t.startsWith('//') || t.startsWith('*') ? [] : [[i + 1, line]];
  });
}

describe('the name LexCraft on screen', () => {
  it('no line outside a comment writes «VisuaLex», but in the allowed files', () => {
    const found = sources(src).map((file) => relative(src, file)).filter((file) => !(file in ALLOWED))
      .flatMap((file) => codeLines(readFileSync(join(src, file), 'utf8'))
        .filter(([, line]) => line.includes('VisuaLex')).map(([n]) => `${file}:${n}`));
    expect(found).toEqual([]);
  });

  it('every allowed file still writes it: one that no longer does leaves the list', () => {
    const stale = Object.keys(ALLOWED).filter((file) => !codeLines(readFileSync(join(src, file), 'utf8')).some(([, l]) => l.includes('VisuaLex')));
    expect(stale).toEqual([]);
  });

  // LC48: Work's search is «Ricerca» and the tool «Pseudonimizzatore» (it pseudonymises, it does not anonymise). The Labs
  // graph keeps «Corpus» as a node type.
  it('no line outside a comment writes «Corpus» or «Anonimizzatore», but the Labs graph\'s node type', () => {
    const graph = join('features', 'merlt', 'graph', 'page', 'NodeDetailsDrawer.tsx');
    const found = sources(src).map((file) => relative(src, file)).filter((file) => file !== graph)
      .flatMap((file) => codeLines(readFileSync(join(src, file), 'utf8'))
        .filter(([, line]) => /\bCorpus\b|Anonimizzator/.test(line)).map(([n]) => `${file}:${n}`));
    expect(found).toEqual([]);
  });

  it('the page\'s title, its description, the splash and the installed app say LexCraft', () => {
    // Comments cut by splitting, not by a regex replace: CodeQL reads that as an incomplete HTML sanitizer.
    const html = readFileSync(join(src, '..', 'index.html'), 'utf8')
      .split('<!--').map((part, i) => (i ? part.slice(part.indexOf('-->') + 3) : part)).join('');
    expect(html).toContain('<title>LexCraft</title>');
    expect(html).not.toContain('VisuaLex');
    const manifest = JSON.parse(readFileSync(join(src, '..', 'public', 'manifest.json'), 'utf8'));
    expect([manifest.name, manifest.short_name]).toEqual(['LexCraft', 'LexCraft']);
  });

  it('the splash and the tab\'s icon draw the column, not VisuaLex\'s book (LC7)', () => {
    const html = readFileSync(join(src, '..', 'index.html'), 'utf8');
    const icon = readFileSync(join(src, '..', 'public', 'favicon.svg'), 'utf8');
    for (const mark of [html, icon]) {
      expect(mark).not.toContain('M12 7v14'); // the book's spine
      expect(mark).toContain('vlx-column-shaft');
    }
  });
});
