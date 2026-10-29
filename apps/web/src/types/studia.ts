/** VisuaLex Studia: the study cards (`/api/lingo/cards`). The UI says «scheda»; the code keeps the API's names. */

export type Materia =
  | 'DIRITTO_CIVILE'
  | 'DIRITTO_PENALE'
  | 'DIRITTO_AMMINISTRATIVO'
  | 'DIRITTO_PROCESSUALE_CIVILE'
  | 'DIRITTO_PROCESSUALE_PENALE';
export type StatoScheda = 'BOZZA_PERSONALE' | 'PROPOSTA_COMMUNITY' | 'VALIDATA' | 'DA_RIVEDERE' | 'ARCHIVIATA';
export type TipoScheda = 'ISTITUTO_DEFINIZIONE' | 'DISTINZIONE_CONCETTUALE' | 'CASO_APPLICATIVO' | 'REQUISITO_FORMA_ATTO';

export interface AncoraScheda {
  normaKey: string;
  articleId: string;
  /** The official URN of the article, cut from the address the reader holds. */
  urn: string;
  isPrimary: boolean;
}

/** What a validator judged against a card: only the two verdicts that carry a reason, and never who gave it. */
export interface RilievoValidatore {
  giudizio: 'MIGLIORABILE' | 'ERRATA';
  motivazione: string;
  createdAt: string;
}

export interface Scheda {
  id: string;
  materia: Materia;
  istituto: string;
  tipo: TipoScheda;
  domanda: string;
  risposta: string;
  spiegazione: string | null;
  stato: StatoScheda;
  createdAt: string;
  updatedAt: string;
  ancore: AncoraScheda[];
  /** The connected application that wrote the card; null for a card written here. */
  origine: { clientName: string | null } | null;
  /** Approvals so far. Only the card read by its id (`studiaService.get`) carries it, with `rilievi`. */
  approvazioni?: number | null;
  rilievi?: RilievoValidatore[];
  /**
   * The day of the next review, 'YYYY-MM-DD' in Rome; null when the user has never reviewed the card or it can no longer be reviewed.
   * Carried by the list (`/lingo/cards`); absent where the card is read some other way.
   */
  prossimoRipasso?: string | null;
}

/** A card in the reader's panel: the community's come with the validation (PR B). */
export interface SchedaDellArticolo extends Scheda {
  comunita: boolean;
  approvazioni: number | null;
}

/**
 * A text the user must accept before an action (the notice for proposing a card), as the server's
 * current version of it. Nothing of its wording is in the web app.
 */
export interface TestoDaAccettare {
  id: string;
  /**
   * The card proposal's notice, the MERL-T notice (answered through the consent screen), or the declaration on one's
   * study material, accepted in «Percorsi» before the first course.
   */
  chiave: 'PROPOSTA_SCHEDA' | 'INFORMATIVA_MERLT' | 'MATERIALE_STUDIO';
  versione: number;
  titolo: string;
  corpo: string;
  /** The checkbox's label. */
  conferma: string;
  /** The button's label. */
  azione: string;
}

/** `GET /lingo/testi/:chiave`: the current version, and whether this user has accepted it. */
export interface TestoCorrente extends TestoDaAccettare {
  accettata: boolean;
}

/** What a validator can say about a card. */
export type Giudizio = 'APPROVATA' | 'MIGLIORABILE' | 'ERRATA';

/**
 * Proposing a card answers the card, with the points it earned (`xp`, Gymnasium XP spec §5.3), or the notice to
 * accept first, which carries none (the 409).
 */
export type EsitoProposta = (Scheda & { xp?: XpEsito }) | { richiedeTesto: TestoDaAccettare };

/** What the form sends: anchors as references («art. 1453 c.c.»), which the server resolves and checks. */
export interface SchedaInput {
  materia: Materia;
  istituto: string;
  tipo: TipoScheda;
  domanda: string;
  risposta: string;
  spiegazione?: string;
  ancore: Array<{ riferimento: string; principale?: boolean }>;
}

export interface FiltriSchede {
  materia?: Materia;
  stato?: StatoScheda;
  tipo?: TipoScheda;
  /** Any anchor on this act (the norm key, e.g. `codice_civile`). */
  normaKey?: string;
  q?: string;
  origine?: 'applicazione';
  /** Only the cards whose next review is today or earlier. */
  dovuteOggi?: 'true';
  ordine?: 'recenti' | 'materia';
  limit?: number;
  offset?: number;
}

/** An anchor the server could not verify, with its words: shown on the chip that failed. */
export interface EsitoAncoraRifiutata {
  outcome: 'not_recognised' | 'does_not_exist' | 'ambiguous' | 'unavailable';
  reference: string;
  detail: string;
}

export interface EsitoRifiuto {
  outcome: 'refused';
  detail: string;
  anchors?: EsitoAncoraRifiutata[];
}

export type EsitoCreazione = { outcome: 'created'; id: string } | EsitoRifiuto;
export type EsitoModifica = { outcome: 'updated'; card: Scheda } | EsitoRifiuto;

/** What moving cards to the trash answers: the ids moved, and those that are not the user's or not deletable. */
export interface EsitoCestino {
  trashId?: string;
  moved: string[];
  notFound: string[];
  notDeletable: string[];
}

export type Voto = 1 | 2 | 3 | 4;

/** A card of the review session: `nuova` when never reviewed, `anteprima` the days FSRS would schedule for each grade. */
export interface SchedaDiRipasso extends Scheda {
  nuova: boolean;
  comunita: boolean;
  anteprima: Record<`${Voto}`, number>;
}

export interface SessioneRipasso {
  conteggi: { dovute: number; nuove: number };
  /** Due cards first, then new ones. */
  cards: SchedaDiRipasso[];
}

export interface RevisioneInput {
  cardId: string;
  rating: Voto;
  /** Milliseconds from the question shown to the grade. */
  durataMs?: number;
}

/** Today's goal as a recorded grade leaves it; `appenaRaggiunto` on the one grade that made the day count. */
export interface OggiDelVoto {
  /** The Rome day of the goal, 'YYYY-MM-DD'. */
  giorno: string;
  ripassi: number;
  obiettivo: number;
  raggiunto: boolean;
  appenaRaggiunto: boolean;
  /** The streak in days, today included once it counts. */
  serie: number;
}

/** `registrata: false`: the card had already been graded today (another device), so nothing was written and there is no `oggi`. */
export interface EsitoRevisione {
  registrata: boolean;
  prossimoRipasso: string;
  scheduledDays: number;
  oggi?: OggiDelVoto;
  /** The points the grade earned; only on a recorded grade. */
  xp?: XpEsito;
}

export interface PreferenzeStudio {
  nuoveAlGiorno: number;
  /** The reviews that make a day count for the streak (1–200). */
  ripassiAlGiorno: number;
  /** The subjects whose validated community cards enter the review. */
  materieComunita: Materia[];
}

/** A day of the last seven: counted, a rest that kept the streak, missed, or today still open. */
export type StatoGiorno = 'fatto' | 'riposo' | 'saltato' | 'oggi';

export interface ConteggiStati {
  nuove: number;
  apprendimento: number;
  consolidate: number;
}

/** A Rome day of the activity calendar; days with nothing are left out. */
export interface GiornoAttivita {
  giorno: string;
  ripassi: number;
  nuove: number;
  sbagliate: number;
  /** The day counted for the streak (always the whole day's, whatever the subject asked). */
  valido: boolean;
  riposo: boolean;
}

/**
 * Gymnasium's level (Gymnasium XP spec §4, §5.3), computed by the server from its ledger on every read: never
 * stored, never computed here. Seen by its owner only (G-316).
 */
export interface XpLivello {
  /** From 1, no ceiling. */
  livello: number;
  /** Every point earned. */
  totale: number;
  /** The points earned inside the current level. */
  nelLivello: number;
  /** What the next level costs in all: `nelLivello` of `perIlProssimo`. */
  perIlProssimo: number;
  /** The points earned on today's Rome day. */
  oggi: number;
}

/** The missions' ids, the server's catalogue in its order (Gymnasium XP spec §3.1). */
export type MissioneId = 'dovute' | 'nuove' | 'obiettivo' | 'materia-ferma' | 'scrivi' | 'convalida' | 'caso' | 'settimana' | 'consolida';

/** A credit just written: a mission done, and what it was worth. */
export interface XpCredito {
  missione: MissioneId;
  punti: number;
}

/** What a grade, a proposal or a vote earned (`crediti` may be empty); `nuovoLivello` on the event that crossed a level. */
export interface XpEsito {
  crediti: XpCredito[];
  livello: XpLivello;
  nuovoLivello: boolean;
}

/**
 * A mission as the server decides it (Gymnasium XP spec §5.3): `fatta` if and only if its credit exists. `progresso`
 * is absent for «scrivi», «caso» and a `vuota` with nothing to count; `motivo` only on «nuove» not done (the daily
 * quota stops it); `materia` only on «materia-ferma».
 */
export interface MissioneServer {
  id: MissioneId;
  gruppo: 'giornaliera' | 'settimanale' | 'lungo';
  /** One of «Le missioni di oggi». */
  principale: boolean;
  punti: number;
  stato: 'fatta' | 'aperta' | 'vuota' | 'in-arrivo';
  progresso?: { fatte: number; di: number };
  motivo?: 'quota';
  materia?: Materia;
}

/** Everything the dashboard draws (`GET /lingo/srs/progressi`, Studia progress spec §5.2). Days are Rome days, 'YYYY-MM-DD'. */
export interface Progressi {
  oggi: { giorno: string; ripassi: number; obiettivo: number; raggiunto: boolean; dovute: number; nuove: number };
  serie: { attuale: number; record: number; ultimiGiorni: { giorno: string; stato: StatoGiorno }[] };
  stati: ConteggiStati;
  materie: (ConteggiStati & { materia: Materia; ripassi30: number })[];
  calendario: GiornoAttivita[];
  prossimi: { giorno: string; schede: number }[];
  /**
   * The level, the missions and the credits this read wrote: the whole day's, never narrowed by `materia`. Absent
   * from a server without the points (#253): the page draws no level bar and no mission, and the rest stays.
   */
  livello?: XpLivello;
  /** In catalogue order; «convalida» only for a validator. */
  missioni?: MissioneServer[];
  crediti?: XpCredito[];
}

/**
 * An institute's stop on the road (`GET /lingo/srs/percorso`, Gymnasium restyle spec §6, G5): the cards of the
 * user's review scope in one institute, by the same three states as `Progressi.materie`. `dovute` is no fourth
 * state: the cards studied and due by the end of today in Rome, a subset of `apprendimento + consolidate`.
 * `istituto` is the card's own label, passed back verbatim to narrow the session.
 */
export interface TappaIstituto extends ConteggiStati {
  materia: Materia;
  istituto: string;
  dovute: number;
}
