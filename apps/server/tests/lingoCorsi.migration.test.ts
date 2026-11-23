import { randomUUID } from 'node:crypto';
import type { LingoFonteXp, LingoMissione } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, createTestUser, type TestUser } from './helpers';
import { declarationId } from './corsiHelpers';

// The migrations 20261029100000_lingo_courses and 20261029100001_lingo_courses_declaration (Percorsi, spec
// 2026-10-23 §10.2, §10.8): the CHECKs written in SQL, and the ledger's period rewritten for the two missions.

let user: TestUser;
let corsoId: string;
let moduloId: string;

beforeEach(async () => {
  user = await createTestUser('corsi_migration');
  const corso = await prisma.lingoCorso.create({
    data: { autoreId: user.id, titolo: 'Corso', materia: 'DIRITTO_CIVILE', moduliPrevisti: 1, dichiarazioneTestoId: await declarationId() },
  });
  corsoId = corso.id;
  moduloId = (await prisma.lingoCorsoModulo.create({ data: { corsoId, ordine: 1, titolo: 'Modulo', domandePrima: [] } })).id;
});

const OPTIONS = [{ chiave: 'a', testo: 'x', spiegazione: 'y' }, { chiave: 'b', testo: 'x', spiegazione: 'y' }];

describe('lingo_corsi and its tables', () => {
  it('holds a course’s ranges', async () => {
    const textId = await declarationId();
    const base = { autoreId: user.id, titolo: 'Corso', materia: 'DIRITTO_CIVILE' as const, dichiarazioneTestoId: textId };
    await expect(prisma.lingoCorso.create({ data: { ...base, moduliPrevisti: 0 } })).rejects.toThrow(/moduli_previsti_check/);
    await expect(prisma.lingoCorso.create({ data: { ...base, moduliPrevisti: 41 } })).rejects.toThrow(/moduli_previsti_check/);
    await expect(prisma.lingoCorso.create({ data: { ...base, titolo: '', moduliPrevisti: 1 } })).rejects.toThrow(/titolo_check/);
    await expect(prisma.lingoCorsoCompetenza.create({ data: { corsoId, codice: 'X1', ordine: 1, testo: 'Qualificare un caso' } })).rejects.toThrow(/codice_check/);
    await expect(prisma.lingoCorsoModulo.create({ data: { corsoId, ordine: 1, titolo: 'M', domandePrima: ['a', 'b', 'c', 'd'] } })).rejects.toThrow(/domande_prima_check/);
  });

  it('holds an item to one parent, its kind’s keys, and the exam’s open question without options', async () => {
    const exam = await prisma.lingoCorsoEsame.create({ data: { corsoId } });
    const quiz = { tipo: 'QUIZ' as const, ordine: 1, testo: 'Domanda', opzioni: OPTIONS, corretta: 'a' };
    await prisma.lingoCorsoDomanda.create({ data: { ...quiz, moduloId } });
    await expect(prisma.lingoCorsoDomanda.create({ data: { ...quiz, moduloId, esameId: exam.id } })).rejects.toThrow(/parent_check|esame_check/);
    await expect(prisma.lingoCorsoDomanda.create({ data: { ...quiz, moduloId, corretta: null } })).rejects.toThrow(/opzioni_check/);
    await expect(prisma.lingoCorsoDomanda.create({ data: { ...quiz, moduloId, corretta: 'g' } })).rejects.toThrow(/corretta_check/);
    // A recall question names its block.
    await expect(prisma.lingoCorsoDomanda.create({ data: { ...quiz, tipo: 'RICHIAMO', moduloId } })).rejects.toThrow(/blocco_check/);
    // An exam's kinds only under an exam.
    await expect(prisma.lingoCorsoDomanda.create({ data: { ...quiz, tipo: 'ESAME', moduloId } })).rejects.toThrow(/esame_check/);
    const open = { tipo: 'ESAME_APERTA' as const, ordine: 2, testo: 'Parere', esameId: exam.id, rispostaModello: 'Modello', rubrica: ['a', 'b', 'c'] };
    await prisma.lingoCorsoDomanda.create({ data: open });
    await expect(prisma.lingoCorsoDomanda.create({ data: { ...open, opzioni: OPTIONS, corretta: 'a' } })).rejects.toThrow(/opzioni_check/);
    await expect(prisma.lingoCorsoDomanda.create({ data: { ...open, rubrica: ['a', 'b'] } })).rejects.toThrow(/aperta_check/);
    // A quiz item has no model answer.
    await expect(prisma.lingoCorsoDomanda.create({ data: { ...quiz, moduloId, rispostaModello: 'x', rubrica: ['a', 'b', 'c'] } })).rejects.toThrow(/aperta_check/);
  });

  it('holds an attempt once per exam and enrolment, and a state once per module', async () => {
    const enrolment = await prisma.lingoCorsoIscrizione.create({ data: { corsoId, utenteId: user.id } });
    const exam = await prisma.lingoCorsoEsame.create({ data: { corsoId } });
    await prisma.lingoCorsoTentativo.create({ data: { iscrizioneId: enrolment.id, esameId: exam.id } });
    await expect(prisma.lingoCorsoTentativo.create({ data: { iscrizioneId: enrolment.id, esameId: exam.id } })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.lingoCorsoModuloStato.create({ data: { iscrizioneId: enrolment.id, moduloId } });
    await expect(prisma.lingoCorsoModuloStato.create({ data: { iscrizioneId: enrolment.id, moduloId } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.lingoCorsoModuloStato.update({ where: { iscrizioneId_moduloId: { iscrizioneId: enrolment.id, moduloId } }, data: { fattoIl: new Date() } })).rejects.toThrow(/fatto_check/);
  });

  it('keeps the enrolment when its dossier goes (SET NULL)', async () => {
    const dossier = await prisma.dossier.create({ data: { userId: user.id, name: 'D', kind: 'studio' } });
    const enrolment = await prisma.lingoCorsoIscrizione.create({ data: { corsoId, utenteId: user.id, dossierId: dossier.id } });
    await prisma.dossier.delete({ where: { id: dossier.id } });
    expect((await prisma.lingoCorsoIscrizione.findUniqueOrThrow({ where: { id: enrolment.id } })).dossierId).toBeNull();
  });
});

describe('lingo_crediti_xp, the period rewritten', () => {
  const credit = (missione: LingoMissione, periodo: string, fonte: LingoFonteXp = 'MODULO') =>
    prisma.lingoCreditoXp.create({ data: { utenteId: user.id, missione, periodo, giorno: new Date('2026-10-29T00:00:00Z'), punti: 30, fonte, fonteId: randomUUID() } });

  it('takes M:<module> for «Completa un modulo» and C:<course> for «Supera un percorso»', async () => {
    await credit('MODULO', `M:${randomUUID()}`);
    await credit('PERCORSO', `C:${randomUUID()}`, 'ESAME');
  });

  it('refuses them with another period, and a daily mission with theirs', async () => {
    await expect(credit('MODULO', 'G:2026-10-29')).rejects.toThrow(/periodo_check/);
    await expect(credit('PERCORSO', `M:${randomUUID()}`)).rejects.toThrow(/periodo_check/);
    await expect(credit('MODULO', 'M:not-a-uuid')).rejects.toThrow(/periodo_check/);
    await expect(credit('DOVUTE', `M:${randomUUID()}`, 'REVISIONE')).rejects.toThrow(/periodo_check/);
    // The old shapes still hold.
    await credit('DOVUTE', 'G:2026-10-29', 'REVISIONE');
    await credit('SETTIMANA', 'S:2026-10-26', 'REVISIONE');
  });
});
