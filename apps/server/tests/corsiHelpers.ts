import { request, app, prisma, authHeader, type TestUser } from './helpers';
import { setSwitch } from '../src/assistant/switches';
import { exchangeCode, startAuthorization, tokenExchange } from './oauth/oauthHelpers';

// Shared by the Percorsi suites (spec docs/superpowers/specs/2026-10-23-gymnasium-courses-design.md, S1).

export const CORSI = '/api/lingo/corsi';
export type Headers = { Authorization: string };

const EVERY_SCOPE = 'dossier:read dossier:write lingo:cards:read lingo:cards:write lingo:courses:read lingo:courses:write';

/** An exchanged token carrying `scope` (space-separated), for a connection granted every scope. */
export async function delegatedAs(user: TestUser, scope = 'lingo:courses:read lingo:courses:write'): Promise<Headers> {
  const flow = await startAuthorization({ scope: EVERY_SCOPE });
  const auth = authHeader(user);
  await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(auth);
  const decision = await request(app).post(`/api/oauth/requests/${flow.requestId}/decision`).set(auth).send({ approve: true, allowDelete: true });
  const code = new URL(decision.body.redirectTo).searchParams.get('code')!;
  const access = (await exchangeCode(flow.clientId, code, flow.verifier)).body.access_token as string;
  const exchanged = await tokenExchange(access, { scope });
  if (exchanged.status !== 200) throw new Error(`exchange failed: ${JSON.stringify(exchanged.body)}`);
  return { Authorization: `Bearer ${exchanged.body.access_token}` };
}

/** As an administrator switches it: `GET /features`' few seconds of memory are cleared too. */
export async function switchCourses(enabled: boolean) {
  const admin = await prisma.user.findFirstOrThrow();
  await setSwitch('lingo_courses', enabled, admin.id);
}

export async function declarationId(): Promise<string> {
  return (await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'MATERIALE_STUDIO' }, orderBy: { versione: 'desc' } })).id;
}

export async function acceptDeclaration(user: TestUser) {
  await prisma.lingoAccettazioneTesto.create({ data: { utenteId: user.id, testoId: await declarationId() } });
}

const CC = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262';
export const normContent = (n: string) => ({
  tipo_atto: 'codice civile', tipo_atto_reale: 'regio decreto', data: '1942-03-16', numero_atto: '262', numero_articolo: n,
  allegato: '2', url: CC, urn: `${CC}:2~art${n}`, versione: 'vigente',
});
export const DECISION = {
  corte: 'cassazione', archivio: 'civile', numero: 12345, anno: 2024, sezione: '1', tipo: 'sentenza',
  data_deposito: '2024-03-12', etichetta: '-',
};

/** A study dossier with a norm, a decision and a note: `ids.norm`, `ids.decision`, `ids.note`. */
export async function studyDossier(user: TestUser, kind: 'studio' | 'lavoro' = 'studio') {
  const dossier = await prisma.dossier.create({ data: { userId: user.id, name: 'Proprietà intellettuale', kind } });
  const norm = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'norm', title: 'Art. 2563 c.c.', content: normContent('2563'), position: 0 } });
  const decision = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'sentenza', title: 'Cass. civ.', content: DECISION, position: 1 } });
  const note = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'note', title: 'Nota', content: 'Una nota', position: 2 } });
  return { id: dossier.id, ids: { norm: norm.id, decision: decision.id, note: note.id } };
}

export const COMPETENCES = [
  { testo: 'Qualificare un segno distintivo e i suoi impedimenti' },
  { testo: 'Distinguere la ditta dall’insegna e dal marchio' },
  { testo: 'Applicare le regole sul trasferimento della ditta' },
];

export const courseBody = (dossierId: string, over: Record<string, unknown> = {}) => ({
  titolo: 'Proprietà intellettuale',
  materia: 'DIRITTO_CIVILE',
  moduliPrevisti: 2,
  competenze: COMPETENCES,
  dossierId,
  ...over,
});

const options = (right: 'a' | 'b' = 'a') => ({
  opzioni: [
    { chiave: 'a', testo: 'Prima', spiegazione: 'Perché la prima.' },
    { chiave: 'b', testo: 'Seconda', spiegazione: 'Perché la seconda.' },
  ],
  corretta: right,
});
export const item = (competenze: string[], applicazione = true) => ({ testo: 'Qualifica il caso.', ...options(), applicazione, competenze });

/** A module whole: one block citing the norm and the decision, six quiz items, the open question. */
export const moduleBody = (cites: { norm: string; decision: string } | null, over: Record<string, unknown> = {}) => ({
  ordine: 1,
  titolo: 'La ditta',
  minuti: 30,
  competenze: ['C1', 'C2', 'C3'],
  domandePrima: ['Che cos’è la ditta?'],
  blocchi: [
    {
      titolo: 'Nozione',
      testo: cites
        ? '### La ditta\nLa ditta è il nome dell’imprenditore ([art. 2563](#c1)), come dice la **Cassazione** ([sentenza](#c2)).\n\n- primo punto\n- secondo\n\n> una citazione *testuale*'
        : 'La ditta è il nome **commerciale** dell’imprenditore.',
      citazioni: cites ? [{ marcatore: 'c1', voce: cites.norm }, { marcatore: 'c2', voce: cites.decision }] : [],
      richiamo: [item(['C1'], false)],
    },
  ],
  quiz: [item(['C1']), item(['C2']), item(['C3']), item(['C1'], false), item(['C2'], false), item(['C3'], false)],
  aperta: {
    testo: 'Scrivi un breve parere.',
    ...options('b'),
    rispostaModello: 'Questione, regola, esito.',
    rubrica: ['Questione', 'Regola', 'Esito'],
    competenze: ['C1'],
  },
  ...over,
});

export const examBody = (over: Record<string, unknown> = {}) => ({
  domande: ['C1', 'C1', 'C2', 'C2', 'C3', 'C3'].map((c) => item([c])),
  aperta: { testo: 'Redigi un parere.', rispostaModello: 'Questione, regola, esito.', rubrica: ['Questione', 'Regola', 'Esito'], competenze: ['C1', 'C2'] },
  ...over,
});

/** Five draft cards per competence of the course, tied to `moduloId` (as the card route would). */
export async function courseCards(user: TestUser, corsoId: string, moduloId: string, perCompetence = 5) {
  const competences = await prisma.lingoCorsoCompetenza.findMany({ where: { corsoId }, orderBy: { ordine: 'asc' } });
  for (const competence of competences) {
    for (let i = 0; i < perCompetence; i++) {
      await prisma.lingoCard.create({
        data: {
          autoreId: user.id, materia: 'DIRITTO_CIVILE', istituto: `Ditta ${competence.codice}`, domanda: `Domanda ${i}?`, risposta: 'Risposta.',
          moduloId, daPercorso: true, competenze: { create: { competenzaId: competence.id } },
        },
      });
    }
  }
}

/** A course created through the route by `token`, its dossier, and (with `modules`) that many modules. */
export async function course(user: TestUser, token: Headers, modules = 0, over: Record<string, unknown> = {}) {
  const dossier = await studyDossier(user);
  const created = await request(app).post(CORSI).set(token).send(courseBody(dossier.id, over));
  if (created.status !== 201) throw new Error(`course: ${created.status} ${JSON.stringify(created.body)}`);
  const moduleIds: string[] = [];
  for (let i = 0; i < modules; i++) {
    const added = await request(app).post(`${CORSI}/${created.body.id}/moduli`).set(token).send(moduleBody(dossier.ids, { ordine: i + 1, titolo: `Modulo ${i + 1}` }));
    if (added.status !== 201) throw new Error(`module: ${added.status} ${JSON.stringify(added.body)}`);
    moduleIds.push(added.body.id);
  }
  return { id: created.body.id as string, dossier, moduleIds };
}

export { request, app, prisma };
