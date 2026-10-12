/**
 * The administrative courts in the source convention (design
 * docs/superpowers/specs/2026-10-12-administrative-courts-design.md, the owner's D1–D6): the
 * Consiglio di Stato and the C.G.A.R.S. keyed by kind, number and year, a TAR by its seat too. The
 * closed values the item schema, the citation and the key read; the web's twin is
 * `apps/web/src/utils/adminCourts.ts`. `SEATS` is a copy of `conventions/sources/tar-seats.json`,
 * pinned by `tests/norms/adminCourts.test.ts`.
 */
export const ADMIN_COURTS = ['consiglio_di_stato', 'cgars', 'tar'] as const;
export type AdminCourt = (typeof ADMIN_COURTS)[number];
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
/** The family of the kinds the design names (§2): `sent`/`senb` a sentenza, `ocau`/`ocol` an
 *  ordinanza, `dcau`/`ddec` a decreto; another kind belongs to none. */
const FAMILY: Record<string, 'sentenza' | 'ordinanza' | 'decreto'> = {
  sent: 'sentenza', senb: 'sentenza', ocau: 'ordinanza', ocol: 'ordinanza', dcau: 'decreto', ddec: 'decreto',
};
export const kindFamily = (provvedimento: string | null | undefined): 'sentenza' | 'ordinanza' | 'decreto' | null =>
  provvedimento && Object.hasOwn(FAMILY, provvedimento) ? FAMILY[provvedimento] : null;
const FAMILY_ABBR = { sentenza: 'sent.', ordinanza: 'ord.', decreto: 'decr.' } as const;
/** The kind in a citation (§3): `sent.`, `ord.`, `decr.`; none for another kind. */
export const kindAbbreviation = (provvedimento: string | null | undefined): string | null => {
  const family = kindFamily(provvedimento);
  return family ? FAMILY_ABBR[family] : null;
};

/** The section: I…X, with -bis, -ter or -quater (TAR of Rome), or the Adunanza plenaria. */
export const ADMIN_SECTION = /^(?:(?:I|II|III|IV|V|VI|VII|VIII|IX|X)(?:-(?:bis|ter|quater))?|plenaria)$/;

/** «Cons. Stato», «C.G.A.R.S.», «TAR Lazio, Roma», «TAR Toscana», «T.R.G.A. Bolzano». */
export function adminCourtName(corte: AdminCourt, sede: string | null | undefined): string {
  if (corte === 'consiglio_di_stato') return 'Cons. Stato';
  if (corte === 'cgars') return 'C.G.A.R.S.';
  if (!isSeat(sede)) return 'TAR';
  const [name, region, , body] = SEATS[sede];
  if (body === 'TRGA') return `T.R.G.A. ${name}`;
  const several = Object.values(SEATS).filter((s) => s[1] === region).length > 1;
  return several ? `TAR ${region}, ${name}` : `TAR ${region}`;
}

/** «sez. VI», «sez. II-quater», «ad. plen.»; null for none or an unknown one. */
export function adminSectionLabel(sezione: string | null | undefined): string | null {
  if (!sezione || !ADMIN_SECTION.test(sezione)) return null;
  return sezione === 'plenaria' ? 'ad. plen.' : `sez. ${sezione}`;
}
