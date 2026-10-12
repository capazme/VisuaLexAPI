/**
 * The courts of the Union in the source convention (design
 * docs/superpowers/specs/2026-10-12-decisions-mcp-and-eu-courts-design.md §3, decided by the
 * owner, Q10–Q13): the Court of Justice and the General Court, each named by its case — a number
 * of at most four digits and the year the case was registered. The closed values the item schema,
 * the citation and the key read; the web's twin is in `apps/web/src/utils/decisionLinks.ts`.
 */
export const EU_COURTS = ['corte_giustizia_ue', 'tribunale_ue'] as const;
export type EuCourt = (typeof EU_COURTS)[number];

export const EU_FIRST_YEAR: Record<EuCourt, number> = { corte_giustizia_ue: 1953, tribunale_ue: 1989 };
export const EU_MAX_NUMERO = 9999;

export const isEuCourt = (corte: unknown): corte is EuCourt =>
  typeof corte === 'string' && (EU_COURTS as readonly string[]).includes(corte);

/** The formation as the source's title names it: «I»…«X», with « ampliata» for an extended
 *  composition, «grande», «plenaria», «impugnazioni». */
export const EU_SECTION = /^(?:(?:I|II|III|IV|V|VI|VII|VIII|IX|X)(?: ampliata)?|grande|plenaria|impugnazioni)$/;

/** A case as the convention writes it: «C-634/21», «T-612/17», «26/62». */
export const EU_CASE = /^(?:[CT]-)?[1-9]\d{0,3}\/\d{2}$/;

/** «C-634/21», «T-612/17», «26/62» (a Court of Justice case registered before 1989 has no letter). */
export function euCaseLabel(corte: EuCourt, numero: number, anno: number): string {
  const letter = corte === 'tribunale_ue' ? 'T' : anno >= 1989 ? 'C' : '';
  return `${letter ? `${letter}-` : ''}${numero}/${String(anno % 100).padStart(2, '0')}`;
}

export const EU_COURT_NAME: Record<EuCourt, string> = { corte_giustizia_ue: 'Corte giust. UE', tribunale_ue: 'Trib. UE' };

/** «sez. I», «grande sez.», «sez. IX ampliata», «seduta plenaria», «sez. impugnazioni». */
export function euSectionLabel(sezione: string | null | undefined): string | null {
  if (!sezione || !EU_SECTION.test(sezione)) return null;
  if (sezione === 'grande') return 'grande sez.';
  if (sezione === 'plenaria') return 'seduta plenaria';
  return `sez. ${sezione}`;
}

/** «C-293/12 e C-594/12», «A, B e C». */
export function joinCases(cases: readonly string[]): string {
  return cases.length < 2 ? (cases[0] ?? '') : `${cases.slice(0, -1).join(', ')} e ${cases[cases.length - 1]}`;
}
