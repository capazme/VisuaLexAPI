import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** LC61 (D-157): what a user reads from the API's refusals says «LexCraft»; the code keeps «VisuaLex». */
describe('exchange.ts: the words a user reads', () => {
  it('no tool error names «VisuaLex»', () => {
    const source = readFileSync(new URL('../src/exchange.ts', import.meta.url), 'utf8');
    const said = [...source.matchAll(/new (?:ToolError|NoAnswer)\([^)]*?'([^']*)'/g), ...source.matchAll(/\?\? '([^']*)'/g)].map((m) => m[1]);
    expect(said.some((words) => words.includes('LexCraft'))).toBe(true);
    expect(said.filter((words) => words.includes('VisuaLex'))).toEqual([]);
  });
});

describe('the confirmations, the dossier tools and the instructions: the words a user or Claude reads (LC61)', () => {
  const code = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    .split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

  it.each(['confirm.ts', 'tools/dossier.ts'])('%s names LexCraft, never VisuaLex', (file) => {
    expect(code(file).filter((line) => line.includes('VisuaLex'))).toEqual([]);
  });

  it('the server instructions say LexCraft', async () => {
    const { SERVER_INSTRUCTIONS } = await import('../src/server.js');
    expect(SERVER_INSTRUCTIONS).toContain('LexCraft');
    expect(SERVER_INSTRUCTIONS).not.toContain('VisuaLex');
  });
});
