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
