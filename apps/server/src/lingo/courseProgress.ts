import { Prisma } from '@prisma/client';
import { isSwitchOn } from '../assistant/switches';
import { courseMastery, type CompetenceMastery, type MasteryAnswer } from './courseMastery';
import { dayToDate, dateToDay } from './studyDays';

/**
 * What mastery reads, for one or more of the caller's enrolments (Percorsi, A1; spec 2026-10-23 §4, §10.4), and
 * «Percorso superato». The content rows first (competences, modules, items), then the person's (states, outcomes,
 * the review log), joined in memory by id (T30's rule: a row gone between two statements is left out, never a 500).
 */

type Db = Prisma.TransactionClient;

export interface CompetenceRow {
  id: string;
  corsoId: string;
  codice: string;
  ordine: number;
  testo: string;
}

export interface CourseMastery {
  competenze: CompetenceRow[];
  padronanza: Map<string, CompetenceMastery>;
}

/** The answers of each enrolment (by course id) and every competence's mastery on `today`. */
export async function masteryFor(db: Db, userId: string, enrolments: { id: string; corsoId: string }[], today: string): Promise<Map<string, CourseMastery>> {
  const out = new Map<string, CourseMastery>();
  if (enrolments.length === 0) return out;
  const corsoIds = enrolments.map((e) => e.corsoId);
  const competenze = await db.lingoCorsoCompetenza.findMany({
    where: { corsoId: { in: corsoIds } },
    orderBy: [{ corsoId: 'asc' }, { ordine: 'asc' }],
    select: { id: true, corsoId: true, codice: true, ordine: true, testo: true },
  });
  const items = await db.lingoCorsoDomanda.findMany({
    where: { OR: [{ modulo: { corsoId: { in: corsoIds } } }, { esame: { corsoId: { in: corsoIds } } }] },
    select: { id: true, moduloId: true, competenze: { select: { competenzaId: true } } },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const enrolmentIds = enrolments.map((e) => e.id);
  const withdrawnRows = await db.lingoCorsoModuloStato.findMany({
    where: { iscrizioneId: { in: enrolmentIds }, ritiratoIl: { not: null } },
    select: { moduloId: true },
  });
  // A module belongs to one course and one enrolment of the user is per course: one set serves them all.
  const withdrawn = new Set(withdrawnRows.map((r) => r.moduloId));
  const esiti = await db.lingoCorsoEsito.findMany({
    where: { iscrizioneId: { in: enrolmentIds }, corretto: { not: null } },
    select: { iscrizioneId: true, domandaId: true, giorno: true, corretto: true },
  });
  const competenceIds = competenze.map((c) => c.id);
  // A card's first grade of each Rome day (only that one is recorded; DISTINCT ON keeps it so if that ever changes).
  const grades = competenceIds.length === 0
    ? []
    : await db.$queryRaw<{ competenza_id: string; giorno: string; giusta: boolean; modulo_id: string }[]>`
        SELECT cc.competenza_id, g.giorno, g.giusta, g.modulo_id
        FROM (
          SELECT DISTINCT ON (r.card_id, ((r.data_revisione AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date)
                 r.card_id, c.modulo_id,
                 to_char(((r.data_revisione AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date, 'YYYY-MM-DD') AS giorno,
                 (r.rating >= 3) AS giusta
          FROM lingo_revisioni_srs r JOIN lingo_cards c ON c.id = r.card_id
          WHERE r.utente_id = ${userId} AND c.modulo_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM lingo_card_competenze x WHERE x.card_id = r.card_id AND x.competenza_id IN (${Prisma.join(competenceIds)}))
          ORDER BY r.card_id, ((r.data_revisione AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date, r.data_revisione
        ) g
        JOIN lingo_card_competenze cc ON cc.card_id = g.card_id
        WHERE cc.competenza_id IN (${Prisma.join(competenceIds)})`;

  const corsoOfCompetence = new Map(competenze.map((c) => [c.id, c.corsoId]));
  const corsoOfEnrolment = new Map(enrolments.map((e) => [e.id, e.corsoId]));
  const answers = new Map<string, MasteryAnswer[]>(corsoIds.map((id) => [id, []]));
  for (const e of esiti) {
    const item = itemById.get(e.domandaId);
    if (!item || (item.moduloId && withdrawn.has(item.moduloId))) continue;
    answers.get(corsoOfEnrolment.get(e.iscrizioneId)!)?.push({
      competenzaIds: item.competenze.map((c) => c.competenzaId),
      giorno: dateToDay(e.giorno),
      giusta: e.corretto === true,
    });
  }
  for (const g of grades) {
    if (withdrawn.has(g.modulo_id)) continue;
    answers.get(corsoOfCompetence.get(g.competenza_id)!)?.push({ competenzaIds: [g.competenza_id], giorno: g.giorno, giusta: g.giusta });
  }
  for (const corsoId of corsoIds) {
    const own = competenze.filter((c) => c.corsoId === corsoId);
    out.set(corsoId, { competenze: own, padronanza: courseMastery(own.map((c) => c.id), answers.get(corsoId)!, today) });
  }
  return out;
}

/**
 * «Percorso superato» (§4, §10.4): every competence «acquisita» and a final exam passed. Written once, with the Rome
 * day, never cleared, and never while the switch `lingo_courses` is off (off hides, §10.10). The caller holds the
 * enrolment's row lock. Returns whether it was written now.
 */
export async function evaluatePassed(tx: Db, userId: string, enrolment: { id: string; corsoId: string }, today: string): Promise<boolean> {
  if (!(await isSwitchOn('lingo_courses', tx))) return false;
  const row = await tx.lingoCorsoIscrizione.findUnique({ where: { id: enrolment.id }, select: { superatoIl: true } });
  if (!row || row.superatoIl) return false;
  const passed = await tx.lingoCorsoTentativo.findFirst({ where: { iscrizioneId: enrolment.id, superato: true }, select: { id: true } });
  if (!passed) return false;
  const mastery = (await masteryFor(tx, userId, [enrolment], today)).get(enrolment.corsoId)!;
  if (mastery.competenze.length === 0 || mastery.competenze.some((c) => mastery.padronanza.get(c.id)!.stato !== 'acquisita')) return false;
  const written = await tx.lingoCorsoIscrizione.updateMany({ where: { id: enrolment.id, superatoIl: null }, data: { superatoIl: dayToDate(today) } });
  return written.count === 1;
}

/** A competence's mastery as the reads answer it, with its code and words. */
export function serializeMastery(c: CompetenceRow, m: CompetenceMastery) {
  return {
    codice: c.codice,
    ordine: c.ordine,
    testo: c.testo,
    stato: m.stato,
    sessioni: { contate: m.sessioni, servono: 2 },
    prossimaDal: m.prossimaDal,
    ultima: m.ultima,
  };
}
