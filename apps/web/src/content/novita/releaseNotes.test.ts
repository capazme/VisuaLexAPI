import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELEASE_NOTES, VERSION_PATTERN, newsSince, parseInline, parseNote } from './releaseNotes';

const folder = __dirname;
const notes = readdirSync(folder).filter((name) => name.endsWith('.md'));

describe('the release notes kept with the web app', () => {
  it('has the note of the version in version.txt, so a release cannot forget it', () => {
    const version = readFileSync(resolve(folder, '../../../../../version.txt'), 'utf8').trim();

    expect(version).toMatch(VERSION_PATTERN);
    expect(
      RELEASE_NOTES[version]?.trim(),
      `apps/web/src/content/novita/${version}.md is missing: the release pull request adds it (docs/git-workflow.md)`
    ).toBeTruthy();
  });

  it('names every file after a version, so none is silently left out', () => {
    for (const name of notes) expect(name).toMatch(/^\d+\.\d+\.\d+\.md$/);
    expect(Object.keys(RELEASE_NOTES).sort()).toEqual(notes.map((name) => name.replace(/\.md$/, '')).sort());
  });

  it('writes no # heading (the window names the version) and never names the doctrine source by name', () => {
    for (const name of notes) {
      const text = readFileSync(resolve(folder, name), 'utf8');
      expect(text, name).not.toMatch(/^\s*#/m);
      expect(text, name).not.toMatch(/brocardi/i);
    }
  });
});

describe('newsSince', () => {
  const notes = { '1.8.5': 'a', '1.9.0': 'b', '1.9.1': 'c', '1.10.0': 'd' };

  it('gives the new version its note', () => {
    expect(newsSince('1.9.0', '1.9.1', notes)).toEqual([{ version: '1.9.1', note: 'c' }]);
  });

  it('lists the versions skipped since the last visit, the newest first, compared as numbers', () => {
    expect(newsSince('1.8.5', '1.10.0', notes).map((n) => n.version)).toEqual(['1.10.0', '1.9.1', '1.9.0']);
  });

  it('keeps a version with no note, with no text, and lists no note of a version not yet released', () => {
    expect(newsSince('1.9.1', '1.9.2', notes)).toEqual([{ version: '1.9.2', note: null }]);
    expect(newsSince('1.8.5', '1.9.0', notes)).toEqual([{ version: '1.9.0', note: 'b' }]);
  });

  it('takes an empty file for no note', () => {
    expect(newsSince(null, '2.0.0', { '2.0.0': ' \n' })).toEqual([{ version: '2.0.0', note: null }]);
  });

  it('with no version seen before, gives the current one only', () => {
    expect(newsSince(null, '1.10.0', notes).map((n) => n.version)).toEqual(['1.10.0']);
  });
});

describe('parseNote', () => {
  it('reads a bold line as a heading, items, and paragraphs', () => {
    expect(parseNote('**Accesso**\n- uno\n- due\n\nUna riga\nche continua.')).toEqual([
      { kind: 'heading', text: 'Accesso' },
      { kind: 'list', items: [[{ kind: 'text', text: 'uno' }], [{ kind: 'text', text: 'due' }]] },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'Una riga che continua.' }] },
    ]);
  });

  it('joins an indented line to its item, and a heading right after a list ends it', () => {
    expect(parseNote('- primo\n  segue\n**Dopo**\n- altro')).toEqual([
      { kind: 'list', items: [[{ kind: 'text', text: 'primo segue' }]] },
      { kind: 'heading', text: 'Dopo' },
      { kind: 'list', items: [[{ kind: 'text', text: 'altro' }]] },
    ]);
  });

  it('reads bold, italic and code inside a line, and leaves an unclosed mark as written', () => {
    expect(parseInline('Il **menu** e *la* pagina `/crediti`, 2 * 3')).toEqual([
      { kind: 'text', text: 'Il ' },
      { kind: 'strong', text: 'menu' },
      { kind: 'text', text: ' e ' },
      { kind: 'em', text: 'la' },
      { kind: 'text', text: ' pagina ' },
      { kind: 'code', text: '/crediti' },
      { kind: 'text', text: ', 2 * 3' },
    ]);
  });

  it('keeps every character of the real notes, marks aside', () => {
    for (const [version, note] of Object.entries(RELEASE_NOTES)) {
      const drawn = parseNote(note)
        .flatMap((block) =>
          block.kind === 'heading'
            ? [block.text]
            : block.kind === 'list'
              ? block.items.map((item) => item.map((part) => part.text).join(''))
              : [block.content.map((part) => part.text).join('')]
        )
        .join('');
      const written = note.replace(/\*\*|`|^- /gm, '').replace(/\s+/g, '');
      expect(drawn.replace(/\s+/g, ''), version).toBe(written);
    }
  });
});
