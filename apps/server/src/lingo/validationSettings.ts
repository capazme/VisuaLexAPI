import { LingoCardStato, LingoGiudizio, Prisma } from '@prisma/client';
import { SOGLIE_PREDEFINITE, Soglie, stateAfterVotes } from './validationRule';

/**
 * The validation thresholds an administrator sets (Studia spec 2026-10-18). The
 * database holds one row per key (`lingo_impostazioni`), every change is logged
 * (`lingo_impostazioni_log`), and a missing row reads as the default: the test
 * reset truncates `users` with cascade, which empties the rows.
 *
 * Every function takes the transaction it runs in. The locks are taken in one
 * order: the settings rows, then the proposed cards by id. A vote locks its card
 * and reads the thresholds after that lock (see routes/lingoValidazione.ts).
 */

/** The range of each value; the database checks it too (`lingo_impostazioni_valore_check`). */
export const LIMITI_SOGLIE = {
  approvazioni: { min: 1, max: 5 },
  errate: { min: 1, max: 3 },
} as const;

type Db = Pick<Prisma.TransactionClient, 'lingoImpostazione' | 'lingoImpostazioneLog' | 'lingoCard' | '$queryRaw'>;

export type AnteprimaSoglie = { validate: number; archiviate: number };
export type EsitoSoglie = AnteprimaSoglie & { soglie: Soglie };

/** The two values in force now. */
export async function leggiSoglie(db: Db): Promise<Soglie> {
  const righe = await db.lingoImpostazione.findMany({ select: { chiave: true, valore: true } });
  const valoreDi = (chiave: 'SOGLIA_APPROVAZIONI' | 'SOGLIA_ERRATE') =>
    righe.find((riga) => riga.chiave === chiave)?.valore;
  return {
    approvazioni: valoreDi('SOGLIA_APPROVAZIONI') ?? SOGLIE_PREDEFINITE.approvazioni,
    errate: valoreDi('SOGLIA_ERRATE') ?? SOGLIE_PREDEFINITE.errate,
  };
}

/** Every proposed card and its votes, the new state each would get under `soglie`. */
async function calcolaProposte(db: Db, soglie: Soglie) {
  const schede = await db.lingoCard.findMany({
    where: { stato: 'PROPOSTA_COMMUNITY' },
    select: {
      id: true,
      autoreId: true,
      validazioni: { select: { giudizio: true } },
    },
    orderBy: { id: 'asc' },
  });
  return schede.map((scheda) => ({
    id: scheda.id,
    autoreId: scheda.autoreId,
    prossimo: stateAfterVotes(
      scheda.validazioni.map((v) => v.giudizio as LingoGiudizio),
      soglie,
    ) as LingoCardStato,
  }));
}

function conta(proposte: { prossimo: LingoCardStato }[]): AnteprimaSoglie {
  return {
    validate: proposte.filter((p) => p.prossimo === 'VALIDATA').length,
    archiviate: proposte.filter((p) => p.prossimo === 'ARCHIVIATA').length,
  };
}

/** How many proposed cards would be validated and archived under `soglie`. Read-only. */
export async function anteprimaSoglie(db: Db, soglie: Soglie): Promise<AnteprimaSoglie> {
  return conta(await calcolaProposte(db, soglie));
}

/**
 * Saves both values and recomputes every proposed card, in the caller's transaction.
 * Validated and archived cards are never touched. An archived card whose author's
 * account is gone is deleted, as the vote route does: nobody could see it.
 */
export async function applicaSoglie(db: Db, nuove: Soglie, utenteId: string): Promise<EsitoSoglie> {
  // Two administrators' changes take turns; a vote reads the values after its card lock.
  await db.$queryRaw`SELECT chiave FROM lingo_impostazioni ORDER BY chiave FOR UPDATE`;
  const precedenti = await leggiSoglie(db);
  const cambi = [
    { chiave: 'SOGLIA_APPROVAZIONI' as const, da: precedenti.approvazioni, a: nuove.approvazioni },
    { chiave: 'SOGLIA_ERRATE' as const, da: precedenti.errate, a: nuove.errate },
  ].filter((c) => c.da !== c.a);
  for (const cambio of cambi) {
    await db.lingoImpostazione.upsert({
      where: { chiave: cambio.chiave },
      create: { chiave: cambio.chiave, valore: cambio.a, aggiornataDa: utenteId },
      update: { valore: cambio.a, aggiornataDa: utenteId, aggiornataIl: new Date() },
    });
    await db.lingoImpostazioneLog.create({
      data: { chiave: cambio.chiave, valorePrecedente: cambio.da, valoreNuovo: cambio.a, utenteId },
    });
  }

  // The proposed cards are locked in id order before their votes are read: a vote
  // that committed before the lock is counted, one still in flight finishes first.
  await db.$queryRaw`SELECT id FROM lingo_cards WHERE stato = 'PROPOSTA_COMMUNITY' ORDER BY id FOR UPDATE`;
  const proposte = await calcolaProposte(db, nuove);

  const daValidare = proposte.filter((p) => p.prossimo === 'VALIDATA').map((p) => p.id);
  const daArchiviare = proposte.filter((p) => p.prossimo === 'ARCHIVIATA' && p.autoreId !== null).map((p) => p.id);
  const daEliminare = proposte.filter((p) => p.prossimo === 'ARCHIVIATA' && p.autoreId === null).map((p) => p.id);
  if (daValidare.length > 0) {
    await db.lingoCard.updateMany({ where: { id: { in: daValidare } }, data: { stato: 'VALIDATA' } });
  }
  if (daArchiviare.length > 0) {
    await db.lingoCard.updateMany({ where: { id: { in: daArchiviare } }, data: { stato: 'ARCHIVIATA' } });
  }
  if (daEliminare.length > 0) {
    await db.lingoCard.deleteMany({ where: { id: { in: daEliminare } } });
  }

  return { soglie: nuove, ...conta(proposte) };
}
