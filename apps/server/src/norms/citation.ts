/**
 * How a lawyer cites an article, in the owner's style (the same as the web
 * app's `apps/web/src/utils/citation.ts`, whose golden file is the
 * specification): "art. 2, l. 7 agosto 1990, n. 241" for an act cited by type,
 * date and number; "art. 1284 c.c." for a code and the Constitution, with no
 * comma. Two acts of the same type always differ by date and number, so two
 * laws in one dossier are never confused ("art. 3, l. 31 dicembre 2012, n. 247"
 * and "art. 3, l. 21 aprile 2023, n. 49").
 *
 * Used for the answers the API gives about norms (the norms route, the
 * dossier items), which the MCP tools pass on as they are. Change the wording
 * here and in the web app together.
 */

export interface CitableNorm {
  tipo_atto: string;
  numero_articolo: string;
  tipo_atto_reale?: string | null;
  numero_atto?: string | null;
  data?: string | null;
  allegato?: string | null;
}

// Cited by their abbreviation, with no number and no date. Keys are lower case.
const CODE_ABBREVIATIONS: Record<string, string> = {
  'codice civile': 'c.c.',
  'codice penale': 'c.p.',
  'codice di procedura civile': 'c.p.c.',
  'codice di procedura penale': 'c.p.p.',
  costituzione: 'Cost.',
  // Part of R.D. 262/1942 and cited by their own name.
  preleggi: 'preleggi',
  "disposizioni per l'attuazione del codice civile e disposizioni transitorie": 'disp. att. c.c.',
  "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie": 'disp. att. c.p.c.',
};

const TYPE_ABBREVIATIONS: Record<string, string> = {
  'regio decreto': 'r.d.',
  'decreto legislativo': 'd.lgs.',
  'decreto legge': 'd.l.',
  'decreto del presidente della repubblica': 'd.p.r.',
  legge: 'l.',
};

const EU_ACTS: Record<string, string> = {
  'regolamento ue': 'regolamento (UE)',
  'direttiva ue': 'direttiva (UE)',
};

const MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

/** "29 dicembre 2007", "1° ottobre 2026"; anything that is not an ISO day as it came. */
function citationDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[parseInt(match[2], 10) - 1];
  if (!month) return iso;
  const day = parseInt(match[3], 10);
  return `${day === 1 ? '1°' : day} ${month} ${match[1]}`;
}

export function citeArticle(norm: CitableNorm): string {
  const article = `art. ${norm.numero_articolo}`;
  const type = (norm.tipo_atto || '').trim().toLowerCase();

  const code = CODE_ABBREVIATIONS[type];
  if (code) return `${article} ${code}`;

  const eu = EU_ACTS[type];
  if (eu) {
    const year = (norm.data || '').slice(0, 4);
    return norm.numero_atto && /^\d{4}$/.test(year) ? `${article}, ${eu} ${year}/${norm.numero_atto}` : `${article}, ${eu}`;
  }

  // An aliased act ("codice in materia di protezione dei dati personali") is
  // cited by the act it is: "d.lgs. 30 giugno 2003, n. 196".
  const real = (norm.tipo_atto_reale || norm.tipo_atto || '').trim().toLowerCase();
  const act = TYPE_ABBREVIATIONS[real] ?? real;
  const date = norm.data ? ` ${citationDate(norm.data)}` : '';
  const number = norm.numero_atto ? `, n. ${norm.numero_atto}` : '';
  const annex = norm.allegato ? ` (Allegato ${norm.allegato})` : '';
  return `${article}, ${act}${date}${number}${annex}`;
}

/** The citation of a stored dossier item's content, or null when it is not a norm. */
export function citeStoredNorm(itemType: string, content: unknown): string | null {
  if (itemType !== 'norm' || !content || typeof content !== 'object') return null;
  const norm = content as Partial<CitableNorm>;
  if (typeof norm.tipo_atto !== 'string' || typeof norm.numero_articolo !== 'string' || !norm.numero_articolo) return null;
  return citeArticle(norm as CitableNorm);
}
