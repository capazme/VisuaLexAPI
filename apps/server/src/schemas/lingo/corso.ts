import { LingoMateria } from '@prisma/client';
import { z } from 'zod';
import { CITATION_MARKER } from '../../lingo/courseFormat';

/**
 * What the assistant sends to create a course, a module or a final exam (Percorsi, A1; spec 2026-10-23 §10.3,
 * §10.12). Every object is `.strict()`: an unknown key is a 400, never ignored, so nothing the assistant names
 * slips in unseen (G-362's first limit: only what a tool writes into a course reaches the server). The checks
 * that need the course (its competences, its dossier, its modules) are in `lingo/courses.ts`.
 */

export const LIMITS = {
  coursesPerUser: 30,
  competences: { min: 1, max: 15 },
  /** Live modules not superseded (and `moduliPrevisti`), and rows with the corrections. */
  liveModules: 40,
  moduleRows: 60,
  blocks: { min: 1, max: 12 },
  blockChars: 12_000,
  lessonChars: 80_000,
  citationsPerModule: 60,
  preQuestions: 3,
  recallPerBlock: 3,
  quiz: { min: 6, max: 10 },
  options: { min: 2, max: 6 },
  optionChars: 500,
  explanationChars: 1_500,
  rubric: { min: 3, max: 5 },
  examItems: 60,
  /** Per competence, for an exam: application items, and live cards (§10.7). */
  examItemsPerCompetence: 2,
  cardsPerCompetence: 5,
  cardsPerModule: 20,
  /** A module's body, measured before the rest so a refusal is an Italian 400, not a 413. */
  moduleBodyChars: 300_000,
} as const;

/** A competence's code, as the server gives it at creation: C1 … C15. */
export const competenceCode = z.string().regex(/^C[1-9][0-9]?$/, 'Codice di competenza non valido (C1, C2…).');
const codes = z.array(competenceCode).min(1, 'Ogni elemento serve almeno una competenza.').max(LIMITS.competences.max);
const id = z.string().min(1).max(64);

export const courseCreateSchema = z
  .object({
    titolo: z.string().trim().min(1).max(200),
    materia: z.nativeEnum(LingoMateria),
    descrizione: z.string().trim().min(1).max(2_000).optional(),
    moduliPrevisti: z.number().int().min(1).max(LIMITS.liveModules),
    // The order given is the codes' order: C1, C2, …
    competenze: z
      .array(z.object({ testo: z.string().trim().min(10).max(300) }).strict())
      .min(LIMITS.competences.min)
      .max(LIMITS.competences.max),
    dossierId: id,
  })
  .strict();
export type CourseCreateInput = z.infer<typeof courseCreateSchema>;

const option = z
  .object({
    chiave: z.enum(['a', 'b', 'c', 'd', 'e', 'f']),
    testo: z.string().trim().min(1).max(LIMITS.optionChars),
    spiegazione: z.string().trim().min(1).max(LIMITS.explanationChars),
  })
  .strict();
const options = z
  .array(option)
  .min(LIMITS.options.min)
  .max(LIMITS.options.max)
  .refine((list) => new Set(list.map((o) => o.chiave)).size === list.length, { message: 'Le chiavi delle opzioni devono essere diverse.' });

/** A graded item: its options, the right one among them, and the competences it serves. */
const graded = z
  .object({
    testo: z.string().trim().min(1).max(2_000),
    opzioni: options,
    corretta: z.enum(['a', 'b', 'c', 'd', 'e', 'f']),
    applicazione: z.boolean().default(false),
    competenze: codes,
  })
  .strict()
  .refine((item) => item.opzioni.some((o) => o.chiave === item.corretta), { message: 'La risposta corretta non è tra le opzioni.', path: ['corretta'] });

const rubric = z.array(z.string().trim().min(1).max(300)).min(LIMITS.rubric.min).max(LIMITS.rubric.max);

export const moduleCreateSchema = z
  .object({
    ordine: z.number().int().min(1).max(200),
    titolo: z.string().trim().min(1).max(200),
    minuti: z.number().int().min(5).max(120).optional(),
    competenze: codes,
    // The module this one corrects (§5.1): the user withdraws the old one in the web.
    sostituisceId: id.optional(),
    domandePrima: z.array(z.string().trim().min(1).max(300)).max(LIMITS.preQuestions).default([]),
    blocchi: z
      .array(
        z
          .object({
            titolo: z.string().trim().min(1).max(200).optional(),
            testo: z.string().min(1).max(LIMITS.blockChars),
            // Each `#cN` of the text names an entry of the course's dossier (§10.3): norms and decisions only.
            citazioni: z
              .array(z.object({ marcatore: z.string().regex(CITATION_MARKER, 'Marcatore di citazione non valido (c1, c2…).'), voce: id }).strict())
              .max(LIMITS.citationsPerModule)
              .default([]),
            richiamo: z.array(graded).max(LIMITS.recallPerBlock).default([]),
          })
          .strict(),
      )
      .min(LIMITS.blocks.min)
      .max(LIMITS.blocks.max),
    quiz: z.array(graded).min(LIMITS.quiz.min).max(LIMITS.quiz.max),
    // One open question: the hybrid's options for a quiz under 70%, then the model answer and the rubric.
    aperta: z
      .object({
        testo: z.string().trim().min(1).max(2_000),
        opzioni: options,
        corretta: z.enum(['a', 'b', 'c', 'd', 'e', 'f']),
        rispostaModello: z.string().trim().min(1).max(3_000),
        rubrica: rubric,
        competenze: codes,
      })
      .strict()
      .refine((item) => item.opzioni.some((o) => o.chiave === item.corretta), { message: 'La risposta corretta non è tra le opzioni.', path: ['corretta'] }),
  })
  .strict();
export type ModuleCreateInput = z.infer<typeof moduleCreateSchema>;

export const examCreateSchema = z
  .object({
    domande: z.array(graded).min(1).max(LIMITS.examItems),
    // The opinion (questione, regola, esito): self-assessed only, never scored (G-377, Q6), so no options.
    aperta: z
      .object({
        testo: z.string().trim().min(1).max(2_000),
        rispostaModello: z.string().trim().min(1).max(3_000),
        rubrica: rubric,
        competenze: codes,
      })
      .strict(),
  })
  .strict();
export type ExamCreateInput = z.infer<typeof examCreateSchema>;

export const coursePatchSchema = z
  .object({
    titolo: z.string().trim().min(1).max(200).optional(),
    moduliPrevisti: z.number().int().min(1).max(LIMITS.liveModules).optional(),
  })
  .strict()
  .refine((body) => body.titolo !== undefined || body.moduliPrevisti !== undefined, { message: 'Niente da modificare.' });

/** Every control character but the line feed, anywhere in a body: NUL would be a 500 in Postgres. */
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/;

/** The first string of a body that holds a control character other than `\n`, as its path; null when none. */
export function controlCharacterAt(value: unknown, path: string[] = []): string | null {
  if (typeof value === 'string') return CONTROL.test(value) ? path.join('.') || 'corpo' : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = controlCharacterAt(value[i], [...path, String(i)]);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const found = controlCharacterAt(key, [...path, key]) ?? controlCharacterAt(inner, [...path, key]);
      if (found) return found;
    }
  }
  return null;
}
