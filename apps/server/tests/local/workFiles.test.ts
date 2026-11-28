import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { localSkips, workFiles } from '../localRun';

/**
 * The local job's two lists (spec §8) stay true to the files: every Work file it names exists, none is both run and
 * not run, and every skipped test is still a test of a file it runs. A renamed test or file fails here, in the server
 * job too, rather than leaving a stale skip that hides nothing or a file that silently stops running.
 */
const SERVER = path.resolve(__dirname, '../..');

describe("the local job's lists", () => {
  it('names Work files that exist, each once, run or not run with a reason', () => {
    const { run, notRun } = workFiles();
    expect(run.length).toBeGreaterThan(0);
    for (const file of [...run, ...notRun.map((entry) => entry.file)]) expect({ file, exists: existsSync(path.join(SERVER, file)) }).toEqual({ file, exists: true });
    const all = [...run, ...notRun.map((entry) => entry.file)];
    expect(new Set(all).size).toBe(all.length);
    for (const entry of notRun) expect(entry.reason.length).toBeGreaterThan(20);
  });

  it('skips only tests that exist, in files the job runs, each under a reason', () => {
    const { run } = workFiles();
    for (const [name, reason] of localSkips()) {
      const [file, ...titles] = name.split(' > ');
      expect({ name, runs: run.includes(file) || file.startsWith('tests/local/') }).toEqual({ name, runs: true });
      // The title as the source spells it, an escaped quote read as the quote.
      const source = readFileSync(path.join(SERVER, file), 'utf8').replace(/\\(['"`])/g, '$1');
      expect({ name, found: source.includes(titles[titles.length - 1]) }).toEqual({ name, found: true });
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
