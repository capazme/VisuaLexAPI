import type { Materia } from './studia';

/**
 * Gymnasium's courses, «Percorsi» (spec `2026-10-23-gymnasium-courses-design.md`, §10.5): what `/api/lingo/corsi`
 * answers. The list is S1's contract (PR «What S1 exposes»); the course page and «Oggi»'s row are S2's routes, which the
 * spec names without fixing every field: their shapes here are the smallest the screens of §6 need, to be checked
 * against S2.
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
  testo: string;
  stato: StatoPadronanza;
  /** The valid sessions at 80% counted towards «acquisita» (0–2; again from 0 once «da riprendere»). */
  sessioni: number;
  /** The Rome day (`YYYY-MM-DD`) the next session counts from; null when none is waited for. */
  prossimaDal: string | null;
  /** The last valid session's score, 0–100; null before the first. */
  ultima: number | null;
}

export type StatoModulo = 'da-iniziare' | 'in-corso' | 'fatto';

export interface ModuloPagina {
  id: string;
  ordine: number;
  titolo: string;
  /** The reading's estimate, in minutes. */
  minuti: number | null;
  /** The competences it serves, by code. */
  competenze: string[];
  stato: StatoModulo;
  /** The connected application that wrote it (from the delegation). */
  creatoDa: string | null;
  /** The module this one corrects. */
  sostituisceId: string | null;
  /** A live correction of this module: once it exists an opened module can be withdrawn. */
  sostituitoDa: string | null;
  /** Withdrawn by the user from this enrolment: its items no longer count. */
  ritirato: boolean;
}

/** What a course «in preparazione» still lacks (§6.4): null once it lacks nothing. */
export interface Mancanze {
  moduli: { contati: number; previsti: number };
  /** True while no first exam exists. */
  esame: boolean;
  /** The competences with fewer live cards than an exam needs. */
  schede: { codice: string; schede: number; minimo: number }[];
}

/** The final exam's state on the course page (§6.4); taking it is the web's pull request (d). */
export type EsamePagina =
  | { stato: 'bloccato'; id: string }
  | { stato: 'aperto'; id: string }
  | {
      stato: 'non-superato';
      id: string;
      percentuale: number;
      /** The Rome day a new exam can be asked for, and whether that day has come (the server decides «today»). */
      nuovoDal: string;
      nuovoPossibile: boolean;
      /** The competences under 60% in the attempt. */
      sotto60: string[];
    }
  | { stato: 'superato'; id: string; percentuale: number; giorno: string };

/** The course page (`GET /lingo/corsi/:id`, S2). */
export interface CorsoPagina {
  id: string;
  titolo: string;
  materia: Materia;
  descrizione: string | null;
  stato: StatoCorso;
  moduliPrevisti: number;
  /** The Rome day the course was passed. */
  superatoIl: string | null;
  competenze: CompetenzaPagina[];
  moduli: ModuloPagina[];
  inPreparazione: Mancanze | null;
  /** Null while the course has no exam yet. */
  esame: EsamePagina | null;
  /** The course's dossier, null once deleted. */
  dossier: { id: string; name: string } | null;
  schede: { dovute: number; nuove: number; inAttesa: number };
}

/** «Oggi»'s row (`GET /lingo/corsi/oggi`, S2): per course, the module to suggest and the course's due cards. */
export interface CorsoDiOggi {
  corsoId: string;
  titolo: string;
  /** The first module not done, from the Rome day after the last one done; null when there is none to suggest. */
  modulo: { id: string; ordine: number; titolo: string } | null;
  /** The course's cards due today, check cards included (§10.7). */
  schedeDovute: number;
}

/** `DELETE /lingo/corsi/:id`: the trash entry «Annulla» restores, and the dossier that stays. */
export interface CorsoCestinato {
  trashId: string;
  dossier: { id: string; name: string } | null;
}

// ─── A module's session (`/studia/percorsi/:id/moduli/:moduloId`, the web's pull request b) ─────────────────────────
// S2's `GET /lingo/corsi/:id/moduli/:moduloId` and `POST …/apri`, `POST …/risposte` (§10.4, §10.5): the spec names what
// they carry, not every field, so these shapes are the smallest the reading and the recall need, to be checked against
// S2. The quiz, the open question and the end are the web's pull request (c), which adds their fields.

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
}

/** A graded item of a module (here a block's recall question): no key and no explanation until it is answered. */
export interface DomandaModulo {
  id: string;
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

/** A module as its session reads it (`GET /lingo/corsi/:id/moduli/:moduloId`, S2). */
export interface ModuloLezione {
  id: string;
  corso: { id: string; titolo: string };
  ordine: number;
  titolo: string;
  /** The reading's estimate for the whole module, in minutes. */
  minuti: number | null;
  /** The competences it serves, with their words: the intro says what the module is for. */
  competenze: { codice: string; testo: string }[];
  /** For this enrolment: `da-iniziare` until `apri` or a first answer. */
  stato: StatoModulo;
  ritirato: boolean;
  /** The 0–3 pre-questions, never answered to the server (§5, step 1). */
  domandePrima: string[];
  blocchi: BloccoLezione[];
}

/** `POST …/risposte`: the outcome, the right key and every option's explanation; `registrata` false for a retry (§10.4). */
export interface EsitoRisposta {
  registrata: boolean;
  scelta: Chiave;
  corretto: boolean;
  corretta: Chiave;
  opzioni: Required<Opzione>[];
}
