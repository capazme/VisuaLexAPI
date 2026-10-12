/**
 * The administrative courts in the source convention (design
 * docs/superpowers/specs/2026-10-12-administrative-courts-design.md, the owner's D1–D6): the
 * Consiglio di Stato and the C.G.A.R.S. keyed by kind, number and year, a TAR by its seat too. The
 * server's twin is `apps/server/src/norms/adminCourts.ts`; both are pinned to
 * `conventions/sources/golden.json`, and `SEATS` to `conventions/sources/tar-seats.json`
 * (`__tests__/adminCourts.test.ts`).
 */
import type { DecisionCourt } from '../types/decisions';

export type AdminCourt = Extract<DecisionCourt, 'consiglio_di_stato' | 'cgars' | 'tar'>;

export const ADMIN_FIRST_YEAR = 1990;
export const ADMIN_MAX_NUMERO = 99_999;

export const isAdminCourt = (corte: unknown): corte is AdminCourt =>
  corte === 'consiglio_di_stato' || corte === 'cgars' || corte === 'tar';

/** slug → [seat, region, main seat of its region, body]. */
export const SEATS: Record<string, readonly [string, string, boolean, 'TAR' | 'TRGA']> = {
  ancona: ['Ancona', 'Marche', true, 'TAR'], aosta: ['Aosta', "Valle d'Aosta", true, 'TAR'],
  bari: ['Bari', 'Puglia', true, 'TAR'], lecce: ['Lecce', 'Puglia', false, 'TAR'],
  bologna: ['Bologna', 'Emilia-Romagna', true, 'TAR'], parma: ['Parma', 'Emilia-Romagna', false, 'TAR'],
  trento: ['Trento', 'Trentino-Alto Adige', true, 'TRGA'], bolzano: ['Bolzano', 'Trentino-Alto Adige', false, 'TRGA'],
  milano: ['Milano', 'Lombardia', true, 'TAR'], brescia: ['Brescia', 'Lombardia', false, 'TAR'],
  cagliari: ['Cagliari', 'Sardegna', true, 'TAR'], campobasso: ['Campobasso', 'Molise', true, 'TAR'],
  palermo: ['Palermo', 'Sicilia', true, 'TAR'], catania: ['Catania', 'Sicilia', false, 'TAR'],
  catanzaro: ['Catanzaro', 'Calabria', true, 'TAR'], 'reggio-calabria': ['Reggio Calabria', 'Calabria', false, 'TAR'],
  firenze: ['Firenze', 'Toscana', true, 'TAR'], genova: ['Genova', 'Liguria', true, 'TAR'],
  'l-aquila': ["L'Aquila", 'Abruzzo', true, 'TAR'], pescara: ['Pescara', 'Abruzzo', false, 'TAR'],
  roma: ['Roma', 'Lazio', true, 'TAR'], latina: ['Latina', 'Lazio', false, 'TAR'],
  napoli: ['Napoli', 'Campania', true, 'TAR'], salerno: ['Salerno', 'Campania', false, 'TAR'],
  perugia: ['Perugia', 'Umbria', true, 'TAR'], potenza: ['Potenza', 'Basilicata', true, 'TAR'],
  torino: ['Torino', 'Piemonte', true, 'TAR'], trieste: ['Trieste', 'Friuli Venezia Giulia', true, 'TAR'],
  venezia: ['Venezia', 'Veneto', true, 'TAR'],
};
export const isSeat = (sede: unknown): sede is string => typeof sede === 'string' && Object.hasOwn(SEATS, sede);

/** The kind of a measure: the ECLI's suffix in lower case (sent, ocau, …). */
export const PROVVEDIMENTO = /^[a-z]{3,6}$/;
/** The section: I…X, with -bis, -ter or -quater (TAR of Rome), or the Adunanza plenaria. */
export const ADMIN_SECTION = /^(?:(?:I|II|III|IV|V|VI|VII|VIII|IX|X)(?:-(?:bis|ter|quater))?|plenaria)$/;

/** The family of each kind, as the reader's `FAMIGLIE` (decisions/model.py) has it, pinned by the
 *  adminCourts tests: the design's six (§2) and the portal's `ord` and `dpres`; another kind
 *  belongs to none. */
export const FAMILY: Record<string, 'sentenza' | 'ordinanza' | 'decreto'> = {
  sent: 'sentenza', senb: 'sentenza', ocau: 'ordinanza', ocol: 'ordinanza', ord: 'ordinanza',
  dcau: 'decreto', ddec: 'decreto', dpres: 'decreto',
};
export const kindFamily = (provvedimento: string | null | undefined): 'sentenza' | 'ordinanza' | 'decreto' | null =>
  provvedimento && Object.hasOwn(FAMILY, provvedimento) ? FAMILY[provvedimento] : null;
const FAMILY_ABBR = { sentenza: 'sent.', ordinanza: 'ord.', decreto: 'decr.' } as const;
/** The kind in a citation (§3): `sent.`, `ord.`, `decr.`; none for another kind. */
export const kindAbbreviation = (provvedimento: string | null | undefined): string | null => {
  const family = kindFamily(provvedimento);
  return family ? FAMILY_ABBR[family] : null;
};

/** The kinds a sentenza's path takes without naming them (design §2: one register numbers both). */
export const SENTENZA_KINDS: readonly string[] = ['sent', 'senb'];

/** The kinds the design names, as the decision's tab spells them; another kind has no name. */
export const KIND_NAME: Record<string, string> = {
  sent: 'Sentenza', senb: 'Sentenza in forma semplificata', ocau: 'Ordinanza cautelare',
  ocol: 'Ordinanza collegiale', ord: 'Ordinanza', dcau: 'Decreto cautelare', ddec: 'Decreto decisorio',
  dpres: 'Decreto presidenziale',
};

const several = (region: string) => Object.values(SEATS).filter((s) => s[1] === region).length > 1;

/** «Cons. Stato», «C.G.A.R.S.», «TAR Lazio, Roma», «TAR Toscana», «T.R.G.A. Bolzano». */
export function adminCourtName(corte: AdminCourt, sede: string | null | undefined): string {
  if (corte === 'consiglio_di_stato') return 'Cons. Stato';
  if (corte === 'cgars') return 'C.G.A.R.S.';
  if (!isSeat(sede)) return 'TAR';
  const [name, region, , body] = SEATS[sede];
  if (body === 'TRGA') return `T.R.G.A. ${name}`;
  return several(region) ? `TAR ${region}, ${name}` : `TAR ${region}`;
}

/** The court in the identity line: «Consiglio di Stato», «TAR Lazio, sede di Roma», «T.R.G.A., sezione autonoma di Bolzano». */
export function adminCourtFullName(corte: AdminCourt, sede: string | null | undefined): string {
  if (corte === 'consiglio_di_stato') return 'Consiglio di Stato';
  if (corte === 'cgars') return 'Consiglio di giustizia amministrativa per la Regione siciliana';
  if (!isSeat(sede)) return 'Tribunale amministrativo regionale';
  const [name, region, main, body] = SEATS[sede];
  if (body === 'TRGA') {
    return main ? `T.R.G.A. ${name}` : `T.R.G.A., sezione autonoma di ${name}`;
  }
  return several(region) ? `TAR ${region}, sede di ${name}` : `TAR ${region}`;
}

/** «sez. VI», «sez. II-quater», «ad. plen.»; null for none or an unknown one. */
export function adminSectionLabel(sezione: string | null | undefined): string | null {
  if (!sezione || !ADMIN_SECTION.test(sezione)) return null;
  return sezione === 'plenaria' ? 'ad. plen.' : `sez. ${sezione}`;
}

/** The section in the identity line: «Sez. VI», «Adunanza plenaria». */
export function adminSectionName(sezione: string | null | undefined): string | null {
  if (!sezione || !ADMIN_SECTION.test(sezione)) return null;
  return sezione === 'plenaria' ? 'Adunanza plenaria' : `Sez. ${sezione}`;
}

/** The slug of an administrative court's page: `consiglio-di-stato`, `cgars`, `tar-roma`; a TAR
 *  with no seat known is `tar` (its region goes in the query). */
export function adminSlug(corte: AdminCourt, sede: string | null | undefined): string {
  if (corte === 'consiglio_di_stato') return 'consiglio-di-stato';
  if (corte === 'cgars') return 'cgars';
  return isSeat(sede) ? `tar-${sede}` : 'tar';
}
