import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prisma } from './helpers';
import { runImportCli } from '../src/utils/importLingoTracce';

const TEXT = 'Tizio acquista da Caio un bene che si rivela difettoso. '.repeat(3);

function row(overrides: Record<string, unknown> = {}) {
  return {
    chiave: '2005-civile-atto-1',
    materia: 'DIRITTO_CIVILE',
    tipoProva: 'ATTO_GIUDIZIARIO',
    sottoTipoAtto: 'comparsa_risposta',
    titolo: 'Traccia di prova',
    testoTraccia: TEXT,
    fonteTraccia: 'sessione_2005',
    provenienza: { fonte: 'ministero_giustizia', statoUtilizzo: 'ufficiale_verificato' },
    ...overrides,
  };
}

describe('runImportCli (the exit code is what a script or a person acts on)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'lingo-import-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function fileWith(content: unknown): Promise<string> {
    const file = path.join(dir, 'tracce.json');
    await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
  }

  it('a valid file is a dry run: exit 0, nothing written', async () => {
    const file = await fileWith([row()]);
    expect(await runImportCli(['node', 'importLingoTracce', file])).toBe(0);
    expect(await prisma.lingoTraccia.count()).toBe(0);
  });

  it('a valid file with --apply writes it: exit 0', async () => {
    const file = await fileWith([row()]);
    expect(await runImportCli(['node', 'importLingoTracce', file, '--apply'])).toBe(0);
    expect(await prisma.lingoTraccia.count()).toBe(1);
  });

  it('a row of unverified origin is refused even with --apply: exit 1, nothing written', async () => {
    const file = await fileWith([row({ provenienza: { fonte: 'terzi', statoUtilizzo: 'da_verificare' } })]);
    expect(await runImportCli(['node', 'importLingoTracce', file, '--apply'])).toBe(1);
    expect(await prisma.lingoTraccia.count()).toBe(0);
  });

  it('one bad row among good ones refuses the whole file: exit 1', async () => {
    const file = await fileWith([row(), row({ chiave: '2005-civile-atto-2', materia: 'DIRITTO_TRIBUTARIO' })]);
    expect(await runImportCli(['node', 'importLingoTracce', file, '--apply'])).toBe(1);
    expect(await prisma.lingoTraccia.count()).toBe(0);
  });

  it('no file given: exit 2', async () => {
    expect(await runImportCli(['node', 'importLingoTracce'])).toBe(2);
    expect(await runImportCli(['node', 'importLingoTracce', '--apply'])).toBe(2);
  });

  it('a file that is missing or is not JSON: exit 2', async () => {
    expect(await runImportCli(['node', 'importLingoTracce', path.join(dir, 'non-esiste.json')])).toBe(2);
    const notJson = await fileWith('questo non è json');
    expect(await runImportCli(['node', 'importLingoTracce', notJson])).toBe(2);
  });
});
