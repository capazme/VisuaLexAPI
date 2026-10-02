/**
 * Imports a file of exam traces into the bank (LingoLex, first slice).
 *
 * Usage:
 *   npx tsx src/utils/importLingoTracce.ts <file.json>            # dry run: reports, writes nothing
 *   npx tsx src/utils/importLingoTracce.ts <file.json> --apply    # writes
 *
 * The file is a JSON array of rows in the contract of `schemas/lingo/traccia.ts`.
 * All or nothing: if any row breaks the contract, repeats a key, or comes from a
 * source not verified as official, nothing is written and every offending row is
 * reported. A row's id derives from its key, so importing a file again updates
 * its rows in place.
 *
 * Updating in place rewrites the text and the classification of the trace, but
 * leaves alone what a lawyer curates after the import (the answer key, the
 * difficulty, whether the trace is active) unless the file names that field.
 * The contract fills defaults in for missing fields; using them on an update
 * would wipe the answer key of every trace the new file does not mention it for.
 */

import { readFile } from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  isImportable,
  lingoTracciaImportRowSchema,
  tracciaIdFromChiave,
  type LingoTracciaImportRow,
} from '../schemas/lingo/traccia';

export interface ImportOptions {
  apply: boolean;
}

export interface RejectedRow {
  index: number;
  chiave?: string;
  reason: string;
}

/** How many rows fall under each value, for reading a dry run at a glance. */
export interface ImportSummary {
  materia: Record<string, number>;
  tipoProva: Record<string, number>;
  /** By `fonteTraccia`, i.e. by exam session ("sessione_2005") or other origin. */
  fonte: Record<string, number>;
}

export interface ImportReport {
  /** True only when the rows were written. */
  applied: boolean;
  total: number;
  /** Rows that are (or, in a dry run, would be) new. */
  created: number;
  /** Rows whose key is already in the bank and are (or would be) rewritten. */
  updated: number;
  rejected: RejectedRow[];
  /** Empty when the file is refused: nothing is going in, so nothing to count. */
  summary: ImportSummary;
}

function tally(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function summarise(rows: LingoTracciaImportRow[]): ImportSummary {
  return {
    materia: tally(rows.map((r) => r.materia)),
    tipoProva: tally(rows.map((r) => r.tipoProva)),
    fonte: tally(rows.map((r) => r.fonteTraccia)),
  };
}

function keyOf(raw: unknown): string | undefined {
  if (typeof raw === 'object' && raw !== null && 'chiave' in raw) {
    const { chiave } = raw as { chiave: unknown };
    return typeof chiave === 'string' ? chiave : undefined;
  }
  return undefined;
}

function dataOf(row: LingoTracciaImportRow) {
  return {
    materia: row.materia,
    tipoProva: row.tipoProva,
    sottoTipoAtto: row.sottoTipoAtto,
    titolo: row.titolo,
    testoTraccia: row.testoTraccia,
    normeRiferimento: row.normeRiferimento,
    questioniForma: row.questioniForma,
    questioniSostanza: row.questioniSostanza,
    fonteTraccia: row.fonteTraccia,
    attiva: row.attiva,
    difficolta: row.difficolta,
  };
}

/**
 * The columns an update may write. The curated ones (answer key, difficulty,
 * state) only when the file itself has the field: a missing one is not the same
 * as an empty one, and only the raw row can tell them apart.
 */
function updateDataOf(row: LingoTracciaImportRow, raw: Record<string, unknown>): Prisma.LingoTracciaUpdateInput {
  const { normeRiferimento, questioniForma, questioniSostanza, attiva, difficolta, ...always } = dataOf(row);
  return {
    ...always,
    ...('normeRiferimento' in raw && { normeRiferimento }),
    ...('questioniForma' in raw && { questioniForma }),
    ...('questioniSostanza' in raw && { questioniSostanza }),
    ...('attiva' in raw && { attiva }),
    ...('difficolta' in raw && { difficolta }),
  };
}

export async function importLingoTracce(input: unknown, options: ImportOptions): Promise<ImportReport> {
  if (!Array.isArray(input)) {
    throw new Error('The import file must hold an array of rows');
  }

  const rejected: RejectedRow[] = [];
  const rows: LingoTracciaImportRow[] = [];
  // The rows as they came, in step with `rows`, to tell "left out" from "empty".
  const rawRows: Array<Record<string, unknown>> = [];
  const firstSeenAt = new Map<string, number>();

  input.forEach((raw, index) => {
    const parsed = lingoTracciaImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((i) => `${i.path.join('.') || '(row)'}: ${i.message}`).join('; ');
      rejected.push({ index, chiave: keyOf(raw), reason });
      return;
    }
    const row = parsed.data;
    if (!isImportable(row)) {
      rejected.push({
        index,
        chiave: row.chiave,
        reason: `provenienza.statoUtilizzo is "${row.provenienza.statoUtilizzo}": only "ufficiale_verificato" rows may be imported`,
      });
      return;
    }
    const earlier = firstSeenAt.get(row.chiave);
    if (earlier !== undefined) {
      rejected.push({ index, chiave: row.chiave, reason: `duplicate key: already used by row ${earlier}` });
      return;
    }
    firstSeenAt.set(row.chiave, index);
    rows.push(row);
    rawRows.push(raw as Record<string, unknown>); // parsed as an object just above
  });

  if (rejected.length > 0) {
    return { applied: false, total: input.length, created: 0, updated: 0, rejected, summary: summarise([]) };
  }

  const ids = rows.map((row) => tracciaIdFromChiave(row.chiave));
  const existing = await prisma.lingoTraccia.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const updated = existing.length;
  const created = rows.length - updated;

  if (options.apply) {
    await prisma.$transaction(
      rows.map((row, i) =>
        prisma.lingoTraccia.upsert({
          where: { id: ids[i] },
          create: { id: ids[i], ...dataOf(row) },
          update: updateDataOf(row, rawRows[i]),
        })
      )
    );
  }

  return { applied: options.apply, total: input.length, created, updated, rejected: [], summary: summarise(rows) };
}

/** The command line, returning the exit code: 0 done (or a dry run), 1 the file was refused, 2 it could not be read. */
export async function runImportCli(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: tsx src/utils/importLingoTracce.ts <file.json> [--apply]');
    return 2;
  }

  let input: unknown;
  try {
    input = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${file}: ${(e as Error).message}`);
    return 2;
  }

  const report = await importLingoTracce(input, { apply });
  for (const r of report.rejected) {
    console.error(`  row ${r.index}${r.chiave ? ` (${r.chiave})` : ''}: ${r.reason}`);
  }
  if (report.rejected.length > 0) {
    console.error(`\nRefused: ${report.rejected.length} of ${report.total} rows are not importable. Nothing was written.`);
    return 1;
  }
  console.log(
    `${report.applied ? 'Imported' : 'Dry run (nothing written; add --apply)'}: ` +
      `${report.total} rows, ${report.created} new, ${report.updated} already in the bank.`
  );
  const line = (counts: Record<string, number>) =>
    Object.entries(counts)
      .map(([value, n]) => `${value} ${n}`)
      .join(', ');
  console.log(`  by subject: ${line(report.summary.materia)}`);
  console.log(`  by kind:    ${line(report.summary.tipoProva)}`);
  console.log(`  by source:  ${line(report.summary.fonte)}`);
  return 0;
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  runImportCli(process.argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      console.error('Import failed:', e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
