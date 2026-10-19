import { createHash } from 'node:crypto';
import { LingoMateria, LingoTipoProva } from '@prisma/client';
import { z } from 'zod';

/**
 * The contract of one row in a file of exam traces to import (LingoLex, first
 * slice). The columns of `LingoTraccia` come first; `provenienza` is about the
 * row and is **not** stored.
 *
 * Why `provenienza` travels with every row: the collections of traces found
 * around are mostly other people's work, and the repository is public. A row
 * enters the database only when its source is verified as official
 * (`isImportable`); a file with any other row is refused whole, so nothing of
 * unknown origin lands by omission.
 *
 * Every object is `.strict()`: a key the contract does not know is the cleaning
 * step drifting (a stray third-party solution, a renamed column), and the import
 * should stop there rather than drop it silently.
 */

/** "sessione_<year>" | "scuola_forense" | "creata_validata". */
const FONTE_TRACCIA = /^(sessione_\d{4}|scuola_forense|creata_validata)$/;

/** A stable human-readable key, e.g. "2005-civile-atto-1": the identity of a trace across imports. */
const CHIAVE = /^[a-z0-9][a-z0-9._-]{2,79}$/;

/** snake_case, e.g. "comparsa_risposta". Shared with the query filter of the read routes. */
export const SOTTO_TIPO_ATTO = /^[a-z0-9]+(_[a-z0-9]+)*$/;

export const lingoProvenienzaSchema = z
  .object({
    fonte: z.enum(['ministero_giustizia', 'terzi', 'originale']),
    url: z.string().url().optional(),
    statoUtilizzo: z.enum(['ufficiale_verificato', 'da_verificare', 'escluso']),
    note: z.string().max(500).optional(),
  })
  .strict()
  // A collection of someone else's work cannot be "official" by being labelled so:
  // it stays "da_verificare" or "escluso" until the trace is taken from the official
  // source and imported from there.
  .superRefine((p, ctx) => {
    if (p.fonte === 'terzi' && p.statoUtilizzo === 'ufficiale_verificato') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statoUtilizzo'],
        message: 'material from third parties cannot be "ufficiale_verificato": import the official source instead',
      });
    }
  });
export type LingoProvenienza = z.infer<typeof lingoProvenienzaSchema>;

export const lingoTracciaImportRowSchema = z
  .object({
    chiave: z.string().regex(CHIAVE),
    materia: z.nativeEnum(LingoMateria),
    tipoProva: z.nativeEnum(LingoTipoProva),
    sottoTipoAtto: z.string().max(80).regex(SOTTO_TIPO_ATTO),
    titolo: z.string().trim().min(1).max(200),
    testoTraccia: z.string().min(80).max(20_000),
    normeRiferimento: z.array(z.string().min(1)).default([]),
    questioniForma: z.array(z.string().min(1)).default([]),
    questioniSostanza: z.array(z.string().min(1)).default([]),
    fonteTraccia: z.string().regex(FONTE_TRACCIA),
    attiva: z.boolean().default(true),
    difficolta: z.number().int().min(1).max(5).default(3),
    provenienza: lingoProvenienzaSchema,
  })
  .strict();
export type LingoTracciaImportRow = z.infer<typeof lingoTracciaImportRowSchema>;

/** Only a row whose source is verified as official may enter the database. */
export function isImportable(row: LingoTracciaImportRow): boolean {
  return row.provenienza.statoUtilizzo === 'ufficiale_verificato';
}

/**
 * The row's database id, derived from its key. The same key always lands on the
 * same row, so importing a file twice updates instead of duplicating. A
 * name-based (version 5 shaped) uuid, like every other id in the schema.
 */
export function tracciaIdFromChiave(chiave: string): string {
  const bytes = createHash('sha256').update(`lingo-traccia:${chiave}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
