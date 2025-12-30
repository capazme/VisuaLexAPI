/**
 * Parser per citazioni normative non strutturate.
 * Converte input come "art 3 dlgs 233/1990" in SearchParams strutturati.
 * Supporta alias personalizzati utente (es. "gdpr" → Regolamento UE 679/2016).
 */

import type { CustomAlias } from '../types';

export interface ParsedCitation {
  act_type?: string;
  act_number?: string;
  date?: string;
  article?: string;
  confidence: number; // 0-1 quanto siamo sicuri del parsing
  fromAlias?: boolean; // true se risolto da alias utente
  aliasId?: string; // ID dell'alias usato
}

// Tipi di atto che richiedono numero e data
const ACT_TYPES_REQUIRING_DETAILS = [
  'legge',
  'decreto legge',
  'decreto legislativo',
  'decreto del presidente della repubblica',
  'regio decreto',
  'Regolamento UE',
  'Direttiva UE',
];

/**
 * Mappatura completa abbreviazioni → act_type
 * Basata su NORMATTIVA_SEARCH dal backend + abbreviazioni EU
 */
const ABBREVIATION_MAP: Record<string, string> = {
  // === FONTI PRIMARIE ===
  'l': 'legge',
  'l.': 'legge',
  'legge': 'legge',
  'dl': 'decreto legge',
  'd.l.': 'decreto legge',
  'd.l': 'decreto legge',
  'decreto legge': 'decreto legge',
  'dlgs': 'decreto legislativo',
  'd.lgs': 'decreto legislativo',
  'd.lgs.': 'decreto legislativo',
  'decreto legislativo': 'decreto legislativo',
  'dpr': 'decreto del presidente della repubblica',
  'd.p.r.': 'decreto del presidente della repubblica',
  'd.p.r': 'decreto del presidente della repubblica',
  'rd': 'regio decreto',
  'r.d.': 'regio decreto',
  'r.d': 'regio decreto',
  'regio decreto': 'regio decreto',
  'cost': 'costituzione',
  'cost.': 'costituzione',
  'costituzione': 'costituzione',

  // === CODICI FONDAMENTALI ===
  'cc': 'codice civile',
  'c.c.': 'codice civile',
  'c.c': 'codice civile',
  'cod. civ.': 'codice civile',
  'codice civile': 'codice civile',
  'cp': 'codice penale',
  'c.p.': 'codice penale',
  'c.p': 'codice penale',
  'cod. pen.': 'codice penale',
  'codice penale': 'codice penale',
  'cpc': 'codice di procedura civile',
  'c.p.c.': 'codice di procedura civile',
  'c.p.c': 'codice di procedura civile',
  'cod. proc. civ.': 'codice di procedura civile',
  'codice di procedura civile': 'codice di procedura civile',
  'cpp': 'codice di procedura penale',
  'c.p.p.': 'codice di procedura penale',
  'c.p.p': 'codice di procedura penale',
  'cod. proc. pen.': 'codice di procedura penale',
  'codice di procedura penale': 'codice di procedura penale',
  'prel': 'preleggi',
  'prel.': 'preleggi',
  'disp. prel.': 'preleggi',
  'preleggi': 'preleggi',

  // === CODICI SETTORIALI ===
  'cds': 'codice della strada',
  'cod. strada': 'codice della strada',
  'codice della strada': 'codice della strada',
  'cn': 'codice della navigazione',
  'cod. nav.': 'codice della navigazione',
  'codice della navigazione': 'codice della navigazione',
  'cdc': 'codice del consumo',
  'cod. consumo': 'codice del consumo',
  'codice del consumo': 'codice del consumo',
  'cad': "codice dell'amministrazione digitale",
  'cod. amm. dig.': "codice dell'amministrazione digitale",
  "codice dell'amministrazione digitale": "codice dell'amministrazione digitale",
  'ccp': 'codice dei contratti pubblici',
  'c.c.p': 'codice dei contratti pubblici',
  'cod. contr. pubb.': 'codice dei contratti pubblici',
  'codice dei contratti pubblici': 'codice dei contratti pubblici',
  'cpi': 'codice della proprietà industriale',
  'cod. prop. ind.': 'codice della proprietà industriale',
  'codice della proprietà industriale': 'codice della proprietà industriale',
  'cpd': 'codice in materia di protezione dei dati personali',
  'cod. prot. dati': 'codice in materia di protezione dei dati personali',
  'codice privacy': 'codice in materia di protezione dei dati personali',
  'cbc': 'codice dei beni culturali e del paesaggio',
  'cod. beni cult.': 'codice dei beni culturali e del paesaggio',
  'codice dei beni culturali e del paesaggio': 'codice dei beni culturali e del paesaggio',
  'cap': 'codice delle assicurazioni private',
  'cod. ass. priv.': 'codice delle assicurazioni private',
  'codice delle assicurazioni private': 'codice delle assicurazioni private',
  'cce': 'codice delle comunicazioni elettroniche',
  'cod. com. elet.': 'codice delle comunicazioni elettroniche',
  'codice delle comunicazioni elettroniche': 'codice delle comunicazioni elettroniche',
  'cpa': 'codice del processo amministrativo',
  'cod. proc. amm.': 'codice del processo amministrativo',
  'codice del processo amministrativo': 'codice del processo amministrativo',
  'cpt': 'codice del processo tributario',
  'cod. proc. trib.': 'codice del processo tributario',
  'codice del processo tributario': 'codice del processo tributario',
  'cam': 'codice antimafia',
  'cod. antimafia': 'codice antimafia',
  'codice antimafia': 'codice antimafia',
  'camb': 'norme in materia ambientale',
  'norme amb.': 'norme in materia ambientale',
  'codice ambiente': 'norme in materia ambientale',
  'norme in materia ambientale': 'norme in materia ambientale',
  'cpo': 'codice delle pari opportunità',
  'cod. pari opp.': 'codice delle pari opportunità',
  'codice delle pari opportunità': 'codice delle pari opportunità',
  'com': "codice dell'ordinamento militare",
  'cod. ord. mil.': "codice dell'ordinamento militare",
  "codice dell'ordinamento militare": "codice dell'ordinamento militare",
  'ctu': 'codice del turismo',
  'cod. turismo': 'codice del turismo',
  'codice del turismo': 'codice del turismo',
  'cgco': 'codice di giustizia contabile',
  'cod. giust. cont.': 'codice di giustizia contabile',
  'codice di giustizia contabile': 'codice di giustizia contabile',
  'cts': 'codice del Terzo settore',
  'cod. ter. sett.': 'codice del Terzo settore',
  'codice del terzo settore': 'codice del Terzo settore',
  'cdpc': 'codice della protezione civile',
  'cod. prot. civ.': 'codice della protezione civile',
  'codice della protezione civile': 'codice della protezione civile',
  'cci': "codice della crisi d'impresa e dell'insolvenza",
  'cod. crisi imp.': "codice della crisi d'impresa e dell'insolvenza",
  "codice della crisi d'impresa e dell'insolvenza": "codice della crisi d'impresa e dell'insolvenza",
  'cnd': 'codice della nautica da diporto',
  'cod. naut. diport.': 'codice della nautica da diporto',
  'codice della nautica da diporto': 'codice della nautica da diporto',
  'cpet': 'codice postale e delle telecomunicazioni',
  'cod. post. telecom.': 'codice postale e delle telecomunicazioni',
  'codice postale e delle telecomunicazioni': 'codice postale e delle telecomunicazioni',

  // === DISPOSIZIONI ATTUAZIONE ===
  'disp. att. c.c.': 'disposizioni per l\'attuazione del Codice civile e disposizioni transitorie',
  'disp. att. c.p.c.': 'disposizioni per l\'attuazione del Codice di procedura civile e disposizioni transitorie',

  // === UNIONE EUROPEA ===
  'tue': 'TUE',
  'tfue': 'TFUE',
  'cdfue': 'CDFUE',
  'reg ue': 'Regolamento UE',
  'reg. ue': 'Regolamento UE',
  'regue': 'Regolamento UE',
  'regolamento ue': 'Regolamento UE',
  'dir ue': 'Direttiva UE',
  'dir. ue': 'Direttiva UE',
  'dirue': 'Direttiva UE',
  'direttiva ue': 'Direttiva UE',
};

// Ordinati per lunghezza decrescente per matching greedy
const SORTED_ABBREVIATIONS = Object.keys(ABBREVIATION_MAP).sort((a, b) => b.length - a.length);

/**
 * Pattern per estrarre articoli con suffissi (bis, ter, etc.)
 */
const ARTICLE_PATTERN = /\b(?:art\.?|articolo)\s*(\d+)\s*[-]?\s*(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies)?\b/i;

/**
 * Pattern per numeri di articolo standalone (senza "art")
 */
const STANDALONE_NUMBER_PATTERN = /^(\d+)\s*[-]?\s*(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies)?$/i;

/**
 * Pattern per numero/anno (es. "241/1990", "679/2016")
 */
const NUMBER_YEAR_PATTERN = /\b(\d+)\s*[\/\\]\s*(\d{2,4})\b/;

/**
 * Pattern per anno isolato (es. "1990", "2016")
 */
const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;

/**
 * Pattern per numero atto isolato (es. "n. 241", "n 679")
 */
const ACT_NUMBER_PATTERN = /\bn\.?\s*(\d+)\b/i;

/**
 * Normalizza l'input rimuovendo punteggiatura extra e spazi multipli
 */
function normalizeInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[,;:]+/g, ' ')
    .trim();
}

/**
 * Risultato estrazione tipo atto (può includere info da alias)
 */
interface ActTypeExtraction {
  actType: string | undefined;
  actNumber?: string;
  date?: string;
  remaining: string;
  fromAlias?: boolean;
  aliasId?: string;
}

/**
 * Estrae il tipo di atto dall'input, controllando prima gli alias utente
 */
function extractActType(normalized: string, customAliases: CustomAlias[] = []): ActTypeExtraction {
  // Prima controlla gli alias utente (hanno priorità)
  // Ordina per lunghezza trigger decrescente per match più specifico
  const sortedAliases = [...customAliases].sort((a, b) => b.trigger.length - a.trigger.length);

  for (const alias of sortedAliases) {
    const triggerLower = alias.trigger.toLowerCase();
    const regex = new RegExp(`\\b${triggerLower.replace(/\./g, '\\.?')}\\b`, 'i');

    if (regex.test(normalized) && alias.searchParams) {
      const remaining = normalized.replace(regex, ' ').replace(/\s+/g, ' ').trim();

      // Reference alias: espande a act_type + numero + data
      return {
        actType: alias.searchParams.act_type,
        actNumber: alias.searchParams.act_number,
        date: alias.searchParams.date,
        remaining,
        fromAlias: true,
        aliasId: alias.id
      };
    }
  }

  // Poi controlla le abbreviazioni di sistema
  for (const abbr of SORTED_ABBREVIATIONS) {
    const regex = new RegExp(`\\b${abbr.replace(/\./g, '\\.?')}\\b`, 'i');
    if (regex.test(normalized)) {
      const actType = ABBREVIATION_MAP[abbr];
      const remaining = normalized.replace(regex, ' ').replace(/\s+/g, ' ').trim();
      return { actType, remaining };
    }
  }

  return { actType: undefined, remaining: normalized };
}

/**
 * Estrae il numero dell'articolo dall'input
 */
function extractArticle(input: string): { article: string | undefined; remaining: string } {
  // Prima prova con "art" o "articolo"
  const match = input.match(ARTICLE_PATTERN);
  if (match) {
    const article = match[2] ? `${match[1]}-${match[2]}` : match[1];
    const remaining = input.replace(ARTICLE_PATTERN, ' ').replace(/\s+/g, ' ').trim();
    return { article, remaining };
  }
  return { article: undefined, remaining: input };
}

/**
 * Estrae numero atto e anno dall'input
 */
function extractNumberAndYear(input: string): { actNumber: string | undefined; date: string | undefined; remaining: string } {
  let actNumber: string | undefined;
  let date: string | undefined;
  let remaining = input;

  // Pattern numero/anno (es. "241/1990")
  const numYearMatch = input.match(NUMBER_YEAR_PATTERN);
  if (numYearMatch) {
    actNumber = numYearMatch[1];
    let year = numYearMatch[2];
    // Converti anno a 2 cifre in 4 cifre
    if (year.length === 2) {
      year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    }
    date = year;
    remaining = remaining.replace(NUMBER_YEAR_PATTERN, ' ').replace(/\s+/g, ' ').trim();
    return { actNumber, date, remaining };
  }

  // Cerca anno isolato
  const yearMatch = remaining.match(YEAR_PATTERN);
  if (yearMatch) {
    date = yearMatch[1];
    remaining = remaining.replace(YEAR_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  }

  // Cerca numero atto isolato
  const numMatch = remaining.match(ACT_NUMBER_PATTERN);
  if (numMatch) {
    actNumber = numMatch[1];
    remaining = remaining.replace(ACT_NUMBER_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  }

  // Se non abbiamo trovato numero con "n.", cerca numero isolato
  if (!actNumber) {
    const isolatedNumMatch = remaining.match(/\b(\d{1,4})\b/);
    if (isolatedNumMatch && isolatedNumMatch[1].length <= 4) {
      // Evita di prendere l'anno come numero atto
      if (!date || isolatedNumMatch[1] !== date) {
        actNumber = isolatedNumMatch[1];
        remaining = remaining.replace(new RegExp(`\\b${isolatedNumMatch[1]}\\b`), ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  return { actNumber, date, remaining };
}

/**
 * Tenta di estrarre articolo standalone (solo numero) quando il tipo atto è noto
 */
function extractStandaloneArticle(input: string, hasActType: boolean): string | undefined {
  if (!hasActType) return undefined;

  // Se l'input contiene solo numeri (eventualmente con bis/ter), è probabilmente un articolo
  const match = input.match(STANDALONE_NUMBER_PATTERN);
  if (match) {
    return match[2] ? `${match[1]}-${match[2]}` : match[1];
  }
  return undefined;
}

/**
 * Calcola il confidence score del parsing
 */
function calculateConfidence(parsed: ParsedCitation): number {
  let score = 0;

  if (parsed.act_type) score += 0.4;
  if (parsed.article) score += 0.3;
  if (parsed.act_number) score += 0.15;
  if (parsed.date) score += 0.15;

  return score;
}

/**
 * Parser principale: converte una citazione testuale in dati strutturati
 * @param input - La stringa da parsare (es. "art 5 gdpr", "art 2043 cc")
 * @param customAliases - Array opzionale di alias personalizzati utente
 */
export function parseLegalCitation(input: string, customAliases: CustomAlias[] = []): ParsedCitation | null {
  if (!input || input.trim().length < 2) {
    return null;
  }

  const normalized = normalizeInput(input);

  // Step 1: Estrai tipo atto (controlla prima alias utente, poi sistema)
  const actTypeResult = extractActType(normalized, customAliases);
  const { actType, remaining: afterActType, fromAlias, aliasId } = actTypeResult;

  // Step 2: Estrai articolo
  let { article, remaining: afterArticle } = extractArticle(afterActType);

  // Step 3: Estrai numero e anno (ma se da alias reference, usa quelli dell'alias)
  let actNumber = actTypeResult.actNumber;
  let date = actTypeResult.date;

  // Se non abbiamo numero/data dall'alias, estrai dall'input
  if (!actNumber && !date) {
    const numYearResult = extractNumberAndYear(afterArticle);
    actNumber = numYearResult.actNumber;
    date = numYearResult.date;
    afterArticle = numYearResult.remaining;
  }

  // Step 4: Se non abbiamo trovato articolo ma abbiamo tipo atto, cerca articolo standalone
  if (!article && actType) {
    article = extractStandaloneArticle(afterArticle, true);
  }

  // Se non abbiamo estratto nulla di significativo, ritorna null
  if (!actType && !article) {
    return null;
  }

  const parsed: ParsedCitation = {
    act_type: actType,
    act_number: actNumber,
    date: date,
    article: article,
    confidence: 0,
    fromAlias,
    aliasId,
  };

  parsed.confidence = calculateConfidence(parsed);

  return parsed;
}

/**
 * Verifica se il parsing è completo per eseguire una ricerca
 */
export function isSearchReady(parsed: ParsedCitation | null): boolean {
  if (!parsed) return false;

  // Deve avere act_type e article
  if (!parsed.act_type || !parsed.article) return false;

  // Se è un codice (non richiede numero/data) → pronto
  if (!ACT_TYPES_REQUIRING_DETAILS.includes(parsed.act_type)) return true;

  // Se richiede dettagli, deve avere numero e data
  return !!(parsed.act_number && parsed.date);
}

/**
 * Genera un label leggibile dal parsing
 */
export function formatParsedCitation(parsed: ParsedCitation): string {
  const parts: string[] = [];

  if (parsed.article) {
    parts.push(`Art. ${parsed.article}`);
  }

  if (parsed.act_type) {
    // Abbrevia il tipo atto per la visualizzazione
    const shortNames: Record<string, string> = {
      'legge': 'L.',
      'decreto legge': 'D.L.',
      'decreto legislativo': 'D.Lgs.',
      'decreto del presidente della repubblica': 'D.P.R.',
      'regio decreto': 'R.D.',
      'codice civile': 'C.C.',
      'codice penale': 'C.P.',
      'codice di procedura civile': 'C.P.C.',
      'codice di procedura penale': 'C.P.P.',
      'costituzione': 'Cost.',
      'Regolamento UE': 'Reg. UE',
      'regolamento ue': 'Reg. UE',
      'Direttiva UE': 'Dir. UE',
      'direttiva ue': 'Dir. UE',
    };
    parts.push(shortNames[parsed.act_type] || parsed.act_type);
  }

  if (parsed.act_number && parsed.date) {
    parts.push(`${parsed.act_number}/${parsed.date}`);
  } else if (parsed.act_number) {
    parts.push(`n. ${parsed.act_number}`);
  } else if (parsed.date) {
    parts.push(parsed.date);
  }

  return parts.join(' ');
}

/**
 * Converte il parsing in SearchParams
 */
export function toSearchParams(parsed: ParsedCitation): {
  act_type: string;
  act_number: string;
  date: string;
  article: string;
} {
  return {
    act_type: parsed.act_type || '',
    act_number: parsed.act_number || '',
    date: parsed.date || '',
    article: parsed.article || '',
  };
}

/**
 * Riferimento ad articolo estratto da un testo (es. nota a piè di pagina)
 */
export interface ArticleRef {
  numero: string;
  tipoAtto: string;
  confidence: number;
}

/**
 * Pattern per estrarre riferimenti ad articoli dal testo.
 * Supporta formati come:
 * - "art. 2043"
 * - "articolo 123"
 * - "artt. 1-5"
 * - "art. 2043 c.c."
 * - "art. 123-bis"
 */
const ARTICLE_REF_PATTERN = /\b(?:art(?:icol[oi])?t?\.?\s*)(\d+(?:\s*-\s*\d+)?(?:\s*[-]?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)\s*(?:e\s+(?:ss\.?|seg(?:uenti)?\.?)|(?:c\.?\s*c\.?|c\.?\s*p\.?|c\.?\s*p\.?\s*c\.?|c\.?\s*p\.?\s*p\.?|cost\.?|costituzione))?/gi;

/**
 * Pattern per rilevare il tipo di atto dopo il numero articolo
 */
const ACT_TYPE_SUFFIX_MAP: Record<string, string> = {
  'c.c.': 'codice civile',
  'c.c': 'codice civile',
  'cc': 'codice civile',
  'c.p.': 'codice penale',
  'c.p': 'codice penale',
  'cp': 'codice penale',
  'c.p.c.': 'codice di procedura civile',
  'c.p.c': 'codice di procedura civile',
  'cpc': 'codice di procedura civile',
  'c.p.p.': 'codice di procedura penale',
  'c.p.p': 'codice di procedura penale',
  'cpp': 'codice di procedura penale',
  'cost.': 'costituzione',
  'cost': 'costituzione',
  'costituzione': 'costituzione',
};

/**
 * Estrae riferimenti ad articoli da un testo (es. nota a piè di pagina).
 * Utilizzato per creare link cliccabili verso altri articoli citati.
 *
 * @param text - Il testo da analizzare
 * @param defaultActType - Tipo di atto di default se non specificato (es. "codice civile")
 * @returns Array di riferimenti trovati con numero articolo e tipo atto
 */
export function extractArticleRefs(text: string, defaultActType = 'codice civile'): ArticleRef[] {
  if (!text || typeof text !== 'string') return [];

  const refs: ArticleRef[] = [];
  const seenArticles = new Set<string>();

  let match;
  while ((match = ARTICLE_REF_PATTERN.exec(text)) !== null) {
    const fullMatch = match[0].toLowerCase();
    const articleNum = match[1].replace(/\s+/g, '').trim();

    // Evita duplicati
    if (seenArticles.has(articleNum)) continue;
    seenArticles.add(articleNum);

    // Determina il tipo di atto
    let tipoAtto = defaultActType;
    let confidence = 0.5;

    // Cerca suffisso tipo atto nel match
    for (const [suffix, actType] of Object.entries(ACT_TYPE_SUFFIX_MAP)) {
      if (fullMatch.includes(suffix)) {
        tipoAtto = actType;
        confidence = 0.9;
        break;
      }
    }

    refs.push({
      numero: articleNum,
      tipoAtto,
      confidence,
    });
  }

  return refs;
}
