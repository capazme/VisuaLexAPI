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
