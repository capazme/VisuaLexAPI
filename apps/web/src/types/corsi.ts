import type { Materia, XpCredito, XpEsito } from './studia';

/**
 * Gymnasium's courses, «Percorsi» (spec `2026-10-23-gymnasium-courses-design.md`, §10.5): what `/api/lingo/corsi`
 * answers. The list is S1's contract (PR «What S1 exposes»); the course page, «Oggi»'s row and a module's session are
 * S2's (#375, «What S2 exposes»), the session's routes for the user's session only.
 */

export type StatoCorso = 'in-preparazione' | 'in-corso' | 'superato';

/** What the list offers next: a module to study, the final exam, or nothing (a course passed, or one still empty). */
export type ProssimoPasso =
  | { tipo: 'modulo'; id: string; ordine: number; titolo: string }
  | { tipo: 'esame'; id: string }
  | null;

/** One row of «Percorsi» (`GET /lingo/corsi`, newest first). */
export interface CorsoInLista {
  id: string;
  titolo: string;
  materia: Materia;
  stato: StatoCorso;
  competenze: { acquisite: number; totale: number };
  /** The counting modules (live, not withdrawn, not superseded) and the programme's. */
  moduli: { contati: number; previsti: number };
  prossimo: ProssimoPasso;
  createdAt: string;
}

/** A competence's mastery for this enrolment (§4): the state and the numbers the page shows. */
export type StatoPadronanza = 'da-iniziare' | 'in-corso' | 'acquisita' | 'da-riprendere';

export interface CompetenzaPagina {
  /** `C1`…, given by the server in the order the assistant sent them. */
  codice: string;
  ordine: number;
  testo: string;
  stato: StatoPadronanza;
  /** The valid sessions at 80% counted towards «acquisita» (again from 0 once «da riprendere»), of the two it needs. */
  sessioni: { contate: number; servono: number };
  /** The Rome day (`YYYY-MM-DD`) the next session counts from; null when none is waited for. */
  prossimaDal: string | null;
  /** The last valid session: its Rome day and score (0–100); null before the first. */
  ultima: { giorno: string; percentuale: number } | null;
}

/** A module's state for this enrolment: «ritirato» once withdrawn, whatever it was before. */
export type StatoModulo = 'da-iniziare' | 'in-corso' | 'fatto' | 'ritirato';

/** The connected application that wrote something (from the delegation); null when written otherwise. */
export type CreatoDa = { clientName: string | null } | null;

export interface ModuloPagina {
  id: string;
  ordine: number;
  titolo: string;
  /** The reading's estimate, in minutes. */
  minuti: number | null;
  /** The competences it serves, by code. */
  competenze: string[];
  stato: StatoModulo;
  /** The Rome day it was done. */
  fattoGiorno: string | null;
  quizPercentuale: number | null;
  /** Whether it counts towards the programme: live, not withdrawn, not superseded by a live correction. */
  conta: boolean;
  /** The module this one corrects. */
  sostituisceId: string | null;
  /** The live corrections of this module. */
  sostituitoDa: string[];
  /** Never opened: it can go to the trash. */
  eliminabile: boolean;
  /** Opened, superseded by a live correction, not withdrawn: «Ritira questo modulo». */
  ritirabile: boolean;
  creatoDa: CreatoDa;
  createdAt: string;
}

/** What a course «in preparazione» still lacks (§6.4): null once it lacks nothing. */
export interface Mancanze {
  moduli: { contati: number; previsti: number };
  /** `esame` true while no first exam exists. */
  manca: { esame: boolean };
  /** The competences no counting module serves. */
  competenzeSenzaModulo: string[];
  /** The competences with fewer live cards than an exam needs. */
  schede: { codice: string; schede: number; servono: number }[];
}

export type StatoEsame = 'assente' | 'bloccato' | 'aperto' | 'in-corso' | 'non-superato' | 'superato';

/** The final exam's state on the course page (§6.4); taking it is the web's pull request (d). */
export interface EsamePagina {
  stato: StatoEsame;
  /** The exam the state is about; null while there is none. */
  esameId: string | null;
  /** That exam's attempt; `perCompetenza` as graded, `{ codice: percentuale }`. */
  tentativo: {
    id: string;
    consegnatoIl: string | null;
    giorno: string | null;
    percentuale: number | null;
    superato: boolean | null;
    perCompetenza: Record<string, number> | null;
  } | null;
  /** After a failed attempt, the Rome day a new exam can be asked for. */
  nuovoEsameDal: string | null;
  /** Whether that day has come (the server decides «today»). */
  chiediNuovoEsame: boolean;
  /** The competences under 60% in the failed attempt. */
  competenzeSotto: string[];
}

/** The course page (`GET /lingo/corsi/:id`, S2 #375). */
export interface CorsoPagina {
  id: string;
  titolo: string;
  materia: Materia;
  descrizione: string | null;
  stato: StatoCorso;
  /** The Rome day the course was passed. */
  superatoIl: string | null;
  moduliPrevisti: number;
  competenze: CompetenzaPagina[];
  moduli: ModuloPagina[];
  inPreparazione: Mancanze | null;
  esame: EsamePagina;
  /** The course's dossier, null once deleted. */
  dossier: { id: string; name: string } | null;
  /** The course's cards: due today, new, waiting for their module to be done, today's check cards. */
  schede: { dovute: number; nuove: number; inAttesa: number; verifica: number };
  creatoDa: CreatoDa;
  createdAt: string;
  /** The credits this read settled (a module the daily net held back, «Supera un percorso»). */
  xp: { crediti: XpCredito[] };
}

/** «Oggi»'s row (`GET /lingo/corsi/oggi`, S2 #375): only the courses with something to do today. */
export interface CorsoDiOggi {
  corso: { id: string; titolo: string; materia: Materia };
  /** The first counting module not done; null on a Rome day a module was done. */
  modulo: { id: string; ordine: number; titolo: string } | null;
  /** The course's cards due today and its check cards (§10.7). */
  schede: { dovute: number; verifica: number };
}

/** `DELETE /lingo/corsi/:id`: the trash entry «Annulla» restores, and the dossier that stays. */
export interface CorsoCestinato {
  trashId: string;
  dossier: { id: string; name: string } | null;
}

// ─── A module's session (`/studia/percorsi/:id/moduli/:moduloId`, the web's pull request b) ─────────────────────────
// S2's `GET /lingo/corsi/:id/moduli/:moduloId`, `POST …/apri` and `POST …/risposte` (#375, «What S2 exposes»). The
// quiz, the open question and the end are read here as the module carries them; pull request (c) draws them.

/** An option's key, as the server stores it. */
export type Chiave = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

/** An option of a graded item; its explanation only once the item is answered (§10.4: never before). */
export interface Opzione {
  chiave: Chiave;
  testo: string;
  spiegazione?: string;
}

/** The caller's outcome on an item, as graded by the server. */
export interface Risposta {
  scelta: Chiave;
  corretto: boolean;
  /** The right key: sent only with an outcome. */
  corretta: Chiave;
  /** The Rome day it was graded; absent on an outcome merged from `POST …/risposte`, which does not carry it. */
  giorno?: string;
  /** Flagged by the user (§5.1). */
  segnalata: boolean;
}

/** A graded item of a module: no key and no explanation until it is answered. */
export interface DomandaModulo {
  id: string;
  tipo: 'RICHIAMO' | 'QUIZ' | 'APERTA';
  ordine: number;
  applicazione: boolean;
  testo: string;
  /** The competences it serves, by code. */
  competenze: string[];
  opzioni: Opzione[];
  risposta: Risposta | null;
}

/**
 * A citation of the lesson (§10.3): `[testo](#c1)` in the text names `marcatore` `c1`, a copy of a norm or a decision of
 * the course's dossier as it was when the module was written (`voce` is that entry's id, which may be gone since).
 * `riferimento` is the entry's identity as the dossier stores it: a norm's `NormaVisitata` fields, or a decision's content.
 */
export interface CitazioneLezione {
  marcatore: string;
  voce: string;
  tipo: 'norm' | 'sentenza';
  riferimento: Record<string, unknown>;
  /** The citation the server wrote for it, «Art. 2569 c.c.»; null when it could not write one. */
  citation: string | null;
}

/** One block of the lesson: about 1,200 words of the closed Markdown subset (§10.3), closed by its recall (§5, step 4). */
export interface BloccoLezione {
  id: string;
  ordine: number;
  titolo: string | null;
  testo: string;
  /** Counted by the server. */
  parole: number;
  citazioni: CitazioneLezione[];
  /** Its 0–3 recall questions. */
  richiamo: DomandaModulo[];
}

/** The module's state row for this enrolment (`apri` answers it): null in the read until the module is opened. */
export interface AvanzamentoModulo {
  apertoIl: string;
  fattoIl: string | null;
  fattoGiorno: string | null;
  quizPercentuale: number | null;
  giudizio: number | null;
  nota: string | null;
  ritiratoIl: string | null;
}

/** A module as its session reads it (`GET /lingo/corsi/:id/moduli/:moduloId`, S2 #375). Reading never opens it. */
export interface ModuloLezione {
  id: string;
  corso: { id: string; titolo: string };
  ordine: number;
  titolo: string;
  /** The reading's estimate for the whole module, in minutes. */
  minuti: number | null;
  /** The competences it serves, with their words: the start says what the module is for. */
  competenze: { codice: string; testo: string }[];
  stato: StatoModulo;
  ritirato: boolean;
  avanzamento: AvanzamentoModulo | null;
  sostituisceId: string | null;
  /** Its corrections, by id. */
  sostituitoDa: string[];
  creatoDa: CreatoDa;
  /** The 0–3 pre-questions, never answered to the server (§5, step 1). */
  domandePrima: string[];
  blocchi: BloccoLezione[];
  /** Pull request (c) draws these four. */
  quiz: DomandaModulo[];
  quizStato: { totale: number; risposte: number; giuste: number; percentuale: number };
  domandaAperta: DomandaModulo | null;
  rispostaModello: { domandaId: string; rispostaModello: string; rubrica: string[]; spuntate: number[] } | null;
}

/**
 * `POST …/risposte { domandaId, scelta }`: the outcome, the right key and every option's explanation; a second send of
 * the same item answers the stored outcome with `registrata: false` and `xp: null` (§10.4).
 */
export interface EsitoRisposta {
  registrata: boolean;
  domandaId: string;
  scelta: Chiave;
  corretto: boolean;
  corretta: Chiave;
  opzioni: Required<Opzione>[];
  /** What the answer credited («Supera un percorso» when it completes the course); null for a retry. */
  xp: XpEsito | null;
}
