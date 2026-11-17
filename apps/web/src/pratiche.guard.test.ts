import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// LC60: what a user reads says «pratica» / «Pratiche», not «dossier» (Luca, 16 Nov: «dossier lo rinominiamo come
// pratiche»). The code keeps `dossier` (identifiers, query keys, API paths, tour ids). This refuses the word in the
// Italian a screen shows: a string literal with a space in it or a capital «Dossier», and JSX text. The Forum keeps
// «Dossier pubblici» until Luca decides how a published practice is named.
const src = __dirname; // apps/web/src

/** Folders and files where «dossier» still reaches the screen on purpose, each with why. */
const ALLOWED: Record<string, string> = {
  [join('components', 'features', 'bulletin')]: 'the Forum: «Dossier pubblici» stays until Luca decides (LC60)',
};
/** Lines that name the Forum's area or its published copies («dossier pubblicati»), and English for developers. */
const FORUM_NAME = /[Dd]ossier pubblic/;
const FOR_DEVELOPERS = /console\.|new Error\(|dropped\.push\(/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && !path.includes('__fixtures__') ? [path] : [];
  });
}

/** Lines outside comments: `//` and `*` lines, and block comments (`/*`, `{/*`) opened at a line's start. */
function codeLines(text: string): [number, string][] {
  let inBlock = false;
  return text.split('\n').flatMap((line, i): [number, string][] => {
    const t = line.trim();
    if (inBlock) { inBlock = !t.includes('*/'); return []; }
    if (/^(\{?\/\*)/.test(t)) { inBlock = !t.includes('*/'); return []; }
    return t.startsWith('//') || t.startsWith('*') ? [] : [[i + 1, line.replace(/\s\/\/ .*$/, '')]];
  });
}

const WORD = /(?<![\w$.-])[Dd]ossier(?![\w$-])/;
const LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
// Italian words that come before the noun in prose; in code `dossier` follows `.`, `(`, `,`, `:` or a keyword.
const BEFORE = /\b(il|lo|un|uno|del|dello|al|dal|nel|sul|i|gli|dei|degli|ai|agli|dai|nei|tuo|tuoi|suo|suoi|questo|nuovo|ogni|altro|nessun|di|in|tra|per|con|da|Il|Un|Nel|Dal|Al|Del|Nuovo|Nessun|Questo|Ogni)\s+[Dd]ossier(?![\w$-])/;

/** Whether a line of code shows the word to a user. */
export function showsDossier(line: string): boolean {
  // A literal is text when it has a space or a capital «Dossier»; `'dossier'`, `?dossier=`, `tour-nav-dossier` are keys.
  const literals = line.match(LITERAL) ?? [];
  for (const literal of literals) {
    const text = literal.slice(1, -1).replace(/\$\{[^}]*\}/g, '');
    if (WORD.test(text) && (/\s/.test(text.trim()) || /(?<![\w$.-])Dossier(?![\w$-])/.test(text))) return true;
  }
  // JSX text: what is left once the literals are out, a word after an Italian article or between `>` and `<`.
  const rest = line.replace(LITERAL, '""');
  return BEFORE.test(rest) || /(?<!=)>\s*[^<>{}=():,;]*\b[Dd]ossier\b(?![.\w$])/.test(rest) 
    || (/^\s*(?=[A-Za-zÀ-ú«])[^=;(){}<>]*\b[Dd]ossier\b[^=;(){}]*$/.test(rest) && !/[\w$]:\s|,\s*$/.test(rest));
}

describe('«Pratiche» on screen (LC60)', () => {
  it('no line outside a comment shows «dossier», but the Forum\'s', () => {
    const found = sources(src).map((file) => relative(src, file))
      .filter((file) => !Object.keys(ALLOWED).some((allowed) => file === allowed || file.startsWith(`${allowed}/`)))
      .flatMap((file) => codeLines(readFileSync(join(src, file), 'utf8'))
        .filter(([, line]) => showsDossier(line) && !FORUM_NAME.test(line) && !FOR_DEVELOPERS.test(line)).map(([n, line]) => `${file}:${n}: ${line.trim()}`));
    expect(found).toEqual([]);
  });

  it('the pattern catches the word on screen and leaves the code alone', () => {
    for (const line of [
      `label="Dossier"`, `'Il dossier è vuoto'`, `title: 'Aggiungi al dossier',`, '`Dossier «${title}»: salvato`',
      `      Nessun dossier ancora.`, `<span>Nuovo dossier</span>`, `{ label: 'Apri il dossier', icon: FolderOpen }`,
      `aria-label={\`Togli dal dossier \${name}\`}`, `<span className="x">Dossier «{dossier.name}»</span>`,
      `                dossier, i titoli e i riferimenti delle voci, le tue note, il testo degli atti delle tue pratiche, e li passerà`, `pushSyncError('Impossibile creare il dossier. Riprova.');`,
    ]) {
      expect(showsDossier(line), line).toBe(true);
    }
    for (const line of [
      `const dossier = useDossier(id);`, `navigate(\`/pratiche?dossier=\${d.id}\`)`, `if (dossier.items.length === 0) return;`,
      `id="tour-nav-dossier"`, `apiClient.get('/dossiers')`, `scope: 'dossier:text'`, `function openDossier(dossier: Dossier) {`,
      `import { DossierPage } from './dossier/DossierPage';`, `type Kind = 'dossier' | 'forum';`, `dossier: () => import('./x'),`,
      `const items: Dossier[] = [];`, `onSelect={(d) => dossier.add(d)}`, `.map((dossier) => <Row key={dossier.id} />)`, `const held = x.length > 0 : contains(dossier, item);`, `{dossier.title}`, `<DossierRow dossier={dossier} />`, `      name: dossier.title,`,
      `      dossier: Dossier,`, `      rowKey, isOpen: open, name, dossier, children,`,
    ]) {
      expect(showsDossier(line), line).toBe(false);
    }
  });
});
