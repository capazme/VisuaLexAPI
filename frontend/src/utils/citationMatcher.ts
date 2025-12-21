/**
 * Citation Matcher - Rileva tutte le citazioni normative nel testo.
 *
 * Supporta:
 * - Articoli semplici: "art. 5", "articolo 2043"
 * - Con tipo atto: "art. 2043 c.c.", "art. 575 c.p."
 * - Citazioni complete: "legge 241/1990 art. 3", "L. 241/90", "d.lgs. 50/2016"
 * - Articoli multipli: "artt. 1 e 2 c.c.", "artt. 1, 2, 3"
 * - Con comma/lettera: "art. 5, comma 1" (ignora comma, prende articolo)
 */

// Minimal interface for norma context (subset of NormaVisitata)
interface NormaContext {
  tipo_atto: string;
  numero_atto?: string;
  data?: string;
}

export interface CitationMatch {
  text: string;           // Testo originale matchato
  startIndex: number;     // Posizione nel testo
  endIndex: number;
  parsed: ParsedCitationData;
  cacheKey: string;       // Chiave per cache
}

export interface ParsedCitationData {
  act_type: string;
  act_number?: string;
  date?: string;
  article: string;
  confidence: number;
}

// Mappa abbreviazioni → tipo atto normalizzato
const ABBREVIATION_TO_ACT_TYPE: Record<string, string> = {
  // Leggi
  'l': 'legge',
  'l.': 'legge',
  'legge': 'legge',
  // Decreto legge
  'dl': 'decreto legge',
  'd.l.': 'decreto legge',
  'd.l': 'decreto legge',
  'decreto legge': 'decreto legge',
  // Decreto legislativo
  'dlgs': 'decreto legislativo',
  'd.lgs': 'decreto legislativo',
  'd.lgs.': 'decreto legislativo',
  'd. lgs.': 'decreto legislativo',
  'decreto legislativo': 'decreto legislativo',
  // DPR
  'dpr': 'decreto del presidente della repubblica',
  'd.p.r.': 'decreto del presidente della repubblica',
  'd.p.r': 'decreto del presidente della repubblica',
  // Regio decreto
  'rd': 'regio decreto',
  'r.d.': 'regio decreto',
  'r.d': 'regio decreto',
  'regio decreto': 'regio decreto',
  // EU
  'reg. ue': 'Regolamento UE',
  'regolamento ue': 'Regolamento UE',
  'dir. ue': 'Direttiva UE',
  'direttiva ue': 'Direttiva UE',
};

// Suffissi tipo atto dopo articolo (c.c., c.p., etc.)
const SUFFIX_TO_ACT_TYPE: Record<string, string> = {
  'c.c.': 'codice civile',
  'c.c': 'codice civile',
  'cc': 'codice civile',
  'cod. civ.': 'codice civile',
  'c.p.': 'codice penale',
  'c.p': 'codice penale',
  'cp': 'codice penale',
  'cod. pen.': 'codice penale',
  'c.p.c.': 'codice di procedura civile',
  'c.p.c': 'codice di procedura civile',
  'cpc': 'codice di procedura civile',
  'c.p.p.': 'codice di procedura penale',
  'c.p.p': 'codice di procedura penale',
  'cpp': 'codice di procedura penale',
  'cost.': 'costituzione',
  'cost': 'costituzione',
  'costituzione': 'costituzione',
  'c.d.s.': 'codice della strada',
  'cds': 'codice della strada',
  'c.n.': 'codice della navigazione',
  'cn': 'codice della navigazione',
  'prel.': 'preleggi',
  'disp. att.': 'disposizioni attuative',
  'tue': 'TUE',
  'tfue': 'TFUE',
  'cdfue': 'CDFUE',
};

// Suffissi articolo (bis, ter, etc.)
const ARTICLE_SUFFIX_PATTERN = '(?:-?\\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?';

// Preposizioni articolate che precedono "articolo" (dell'articolo, dall'articolo, etc.)
const PREPOSITION_PATTERN = "(?:dell?'|dall?'|all?'|nell?'|sull?')?";

// Pattern base per "articolo" con tutte le varianti
const ARTICLE_WORD_PATTERN = `${PREPOSITION_PATTERN}art(?:icol[oi])?t?\\.?`;

/**
 * Normalizza il tipo atto
 */
function normalizeActType(input: string): string {
  const normalized = input.toLowerCase().replace(/\s+/g, ' ').trim();

  // Prima cerca match esatto
  if (ABBREVIATION_TO_ACT_TYPE[normalized]) {
    return ABBREVIATION_TO_ACT_TYPE[normalized];
  }
  if (SUFFIX_TO_ACT_TYPE[normalized]) {
    return SUFFIX_TO_ACT_TYPE[normalized];
  }

  // Poi cerca match parziale per abbreviazioni con punti
  const withoutSpaces = normalized.replace(/\s/g, '');
  for (const [abbr, actType] of Object.entries(ABBREVIATION_TO_ACT_TYPE)) {
    if (abbr.replace(/\s/g, '') === withoutSpaces) {
      return actType;
    }
  }
  for (const [suffix, actType] of Object.entries(SUFFIX_TO_ACT_TYPE)) {
    if (suffix.replace(/\s/g, '') === withoutSpaces) {
      return actType;
    }
  }

  return normalized;
}

/**
 * Converte anno a 2 cifre in 4 cifre
 */
function normalizeYear(year: string): string {
  if (year.length === 2) {
    const num = parseInt(year);
    return num > 50 ? `19${year}` : `20${year}`;
  }
  return year;
}

/**
 * Genera una chiave di cache univoca per la citazione
 */
function generateCacheKey(parsed: ParsedCitationData): string {
  const parts = [
    parsed.act_type.toLowerCase().replace(/\s+/g, '-'),
    parsed.article,
  ];
  if (parsed.act_number) parts.push(parsed.act_number);
  if (parsed.date) parts.push(parsed.date);
  return parts.join('::');
}

/**
 * Estrae tutte le citazioni normative dal testo.
 */
export function extractCitations(text: string, defaultNorma?: NormaContext): CitationMatch[] {
  if (!text || typeof text !== 'string') return [];

  // Rimuovi tag HTML per il matching (ma mantieni posizioni)
  const cleanText = text.replace(/<[^>]+>/g, (match) => ' '.repeat(match.length));

  const matches: CitationMatch[] = [];
  const usedRanges: Array<[number, number]> = [];

  // Helper per verificare se una posizione è già usata
  const isOverlapping = (start: number, end: number): boolean => {
    return usedRanges.some(([s, e]) =>
      (start >= s && start < e) || (end > s && end <= e) || (start <= s && end >= e)
    );
  };

  // Helper per aggiungere un match
  const addMatch = (
    matchText: string,
    startIndex: number,
    endIndex: number,
    parsed: ParsedCitationData
  ) => {
    if (isOverlapping(startIndex, endIndex)) return;

    matches.push({
      text: matchText,
      startIndex,
      endIndex,
      parsed,
      cacheKey: generateCacheKey(parsed),
    });
    usedRanges.push([startIndex, endIndex]);
  };

  // ============================================
  // PATTERN 1: Citazioni complete con numero/anno
  // Es: "legge 241/1990", "L. 241/90", "d.lgs. 50/2016 art. 3"
  // ============================================
  const fullCitationRegex = new RegExp(
    // Tipo atto (legge, L., d.lgs., decreto legislativo, etc.)
    '(' +
      'legge|l\\.|' +
      'decreto\\s+legge|d\\.?\\s*l\\.?|dl|' +
      'decreto\\s+legislativo|d\\.?\\s*lgs\\.?|dlgs|' +
      'd\\.?\\s*p\\.?\\s*r\\.?|dpr|' +
      'regio\\s+decreto|r\\.?\\s*d\\.?|rd|' +
      'reg(?:olamento)?\\.?\\s+ue|' +
      'dir(?:ettiva)?\\.?\\s+ue' +
    ')' +
    // Spazio e numero/anno
    '\\s+(?:n\\.?\\s*)?(\\d+)\\s*[/\\\\]\\s*(\\d{2,4})' +
    // Articolo opzionale
    `(?:\\s*,?\\s*${ARTICLE_WORD_PATTERN}\\s*(\\d+${ARTICLE_SUFFIX_PATTERN}))?`,
    'gi'
  );

  let match;
  while ((match = fullCitationRegex.exec(cleanText)) !== null) {
    const actTypeMatch = match[1];
    const actNumber = match[2];
    const year = normalizeYear(match[3]);
    const article = match[4];

    // Se non c'è articolo, skip (non possiamo fare preview di tutta la legge)
    if (!article) continue;

    addMatch(match[0], match.index, match.index + match[0].length, {
      act_type: normalizeActType(actTypeMatch),
      act_number: actNumber,
      date: year,
      article: article.replace(/\s+/g, ''),
      confidence: 0.95,
    });
  }

  // ============================================
  // PATTERN 2: Articoli multipli con suffisso
  // Es: "artt. 1 e 2 c.c.", "artt. 1, 2, 3 c.p."
  // ============================================
  const multiArticleRegex = new RegExp(
    `${PREPOSITION_PATTERN}artt?\\.?\\s+` +
    '(\\d+' + ARTICLE_SUFFIX_PATTERN + ')' +  // Primo articolo
    '(?:\\s*[,e]\\s*\\d+' + ARTICLE_SUFFIX_PATTERN + ')*' +  // Altri articoli
    '\\s+' +
    // Suffisso tipo atto
    '(c\\.?\\s*c\\.?|c\\.?\\s*p\\.?|c\\.?\\s*p\\.?\\s*c\\.?|c\\.?\\s*p\\.?\\s*p\\.?|' +
    'cost\\.?|c\\.?\\s*d\\.?\\s*s\\.?|c\\.?\\s*n\\.?|prel\\.?|' +
    'cod\\.?\\s*civ\\.?|cod\\.?\\s*pen\\.?)',
    'gi'
  );

  while ((match = multiArticleRegex.exec(cleanText)) !== null) {
    if (isOverlapping(match.index, match.index + match[0].length)) continue;

    const firstArticle = match[1];
    const actTypeSuffix = match[2];
    const actType = normalizeActType(actTypeSuffix);

    // Aggiungi solo il primo articolo (gli altri sono correlati)
    addMatch(match[0], match.index, match.index + match[0].length, {
      act_type: actType,
      article: firstArticle.replace(/\s+/g, ''),
      confidence: 0.85,
    });
  }

  // ============================================
  // PATTERN 3: Articolo singolo con suffisso tipo atto
  // Es: "art. 2043 c.c.", "articolo 575 c.p.", "art. 5, comma 1, c.c."
  // ============================================
  const articleWithSuffixRegex = new RegExp(
    `${ARTICLE_WORD_PATTERN}\\s+` +
    '(\\d+' + ARTICLE_SUFFIX_PATTERN + ')' +
    // Ignora comma/lettera opzionali
    '(?:\\s*,?\\s*(?:comma|co\\.|lett\\.?)\\s*[\\d\\w]+)*' +
    // Separatore e suffisso tipo atto
    '\\s*,?\\s*' +
    '(c\\.?\\s*c\\.?|c\\.?\\s*p\\.?|c\\.?\\s*p\\.?\\s*c\\.?|c\\.?\\s*p\\.?\\s*p\\.?|' +
    'cost\\.?|c\\.?\\s*d\\.?\\s*s\\.?|c\\.?\\s*n\\.?|prel\\.?|' +
    'cod\\.?\\s*civ\\.?|cod\\.?\\s*pen\\.?)',
    'gi'
  );

  while ((match = articleWithSuffixRegex.exec(cleanText)) !== null) {
    if (isOverlapping(match.index, match.index + match[0].length)) continue;

    const article = match[1];
    const actTypeSuffix = match[2];

    addMatch(match[0], match.index, match.index + match[0].length, {
      act_type: normalizeActType(actTypeSuffix),
      article: article.replace(/\s+/g, ''),
      confidence: 0.9,
    });
  }

  // ============================================
  // PATTERN 4: Articoli multipli senza suffisso (usa norma corrente)
  // Es: "articoli 8 e 9", "artt. 1, 2 e 3", "degli articoli 8 e 9"
  // Crea match separati per ogni numero di articolo
  // ============================================
  if (defaultNorma?.tipo_atto) {
    const multiArticleNoSuffixRegex = new RegExp(
      `(${PREPOSITION_PATTERN}(?:artt?\\.?|articol[oi])\\s+)` +  // Gruppo 1: prefisso
      // Cattura tutto il gruppo di numeri: "8 e 9" o "1, 2 e 3"
      '(\\d+' + ARTICLE_SUFFIX_PATTERN + '(?:\\s*[,e]\\s*\\d+' + ARTICLE_SUFFIX_PATTERN + ')+)' +  // Gruppo 2: numeri
      // Negative lookahead per non matchare se c'è un suffisso tipo atto dopo
      '(?!\\s*,?\\s*(?:c\\.?\\s*c|c\\.?\\s*p|cost|prel|cod))',
      'gi'
    );

    while ((match = multiArticleNoSuffixRegex.exec(cleanText)) !== null) {
      const fullMatchStart = match.index;
      const fullMatchEnd = match.index + match[0].length;

      // Verifica che l'intero range non sia già usato
      if (isOverlapping(fullMatchStart, fullMatchEnd)) continue;

      const prefix = match[1];  // "articoli " o "degli articoli "
      const articlesGroup = match[2];  // "8 e 9"

      // Trova la posizione di ogni numero all'interno del testo originale
      const numberRegex = /(\d+(?:-?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)/gi;
      let numMatch;

      // La posizione base è dopo il prefisso
      const numbersStartIndex = fullMatchStart + prefix.length;

      while ((numMatch = numberRegex.exec(articlesGroup)) !== null) {
        const articleNum = numMatch[1];
        const numStartInGroup = numMatch.index;
        const numEndInGroup = numMatch.index + numMatch[0].length;

        // Calcola posizione assoluta nel testo
        const absStart = numbersStartIndex + numStartInGroup;
        const absEnd = numbersStartIndex + numEndInGroup;

        // Verifica che questo specifico numero non sia già coperto
        if (!isOverlapping(absStart, absEnd)) {
          addMatch(articleNum, absStart, absEnd, {
            act_type: defaultNorma.tipo_atto,
            act_number: defaultNorma.numero_atto,
            date: defaultNorma.data,
            article: articleNum.replace(/\s+/g, ''),
            confidence: 0.75,
          });
        }
      }
    }
  }

  // ============================================
  // PATTERN 5: Articolo semplice (usa norma corrente come default)
  // Es: "art. 5", "articolo 123", "art. 5, comma 1"
  // ============================================
  if (defaultNorma?.tipo_atto) {
    const simpleArticleRegex = new RegExp(
      `${ARTICLE_WORD_PATTERN}\\s+` +
      '(\\d+' + ARTICLE_SUFFIX_PATTERN + ')' +
      // Ignora comma/lettera opzionali (ma non catturare suffisso tipo atto)
      '(?:\\s*,?\\s*(?:comma|co\\.|lett\\.?)\\s*[\\d\\w]+)*' +
      // Negative lookahead per non matchare se c'è un suffisso tipo atto dopo
      '(?!\\s*,?\\s*(?:c\\.?\\s*c|c\\.?\\s*p|cost|prel|cod))',
      'gi'
    );

    while ((match = simpleArticleRegex.exec(cleanText)) !== null) {
      if (isOverlapping(match.index, match.index + match[0].length)) continue;

      const article = match[1];

      addMatch(match[0], match.index, match.index + match[0].length, {
        act_type: defaultNorma.tipo_atto,
        act_number: defaultNorma.numero_atto,
        date: defaultNorma.data,
        article: article.replace(/\s+/g, ''),
        confidence: 0.7,
      });
    }
  }

  // Ordina per posizione
  return matches.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Serializza i dati della citazione per l'attributo data-citation
 */
export function serializeCitation(parsed: ParsedCitationData): string {
  return JSON.stringify(parsed);
}

/**
 * Deserializza i dati della citazione dall'attributo data-citation
 */
export function deserializeCitation(data: string): ParsedCitationData | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Formatta una citazione per la visualizzazione
 */
export function formatCitationLabel(parsed: ParsedCitationData): string {
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
    'codice della strada': 'C.d.S.',
    'codice della navigazione': 'C.N.',
    'preleggi': 'Prel.',
    'TUE': 'TUE',
    'TFUE': 'TFUE',
    'CDFUE': 'CDFUE',
  };

  const parts: string[] = [`Art. ${parsed.article}`];
  parts.push(shortNames[parsed.act_type] || parsed.act_type);

  if (parsed.act_number && parsed.date) {
    parts.push(`${parsed.act_number}/${parsed.date}`);
  }

  return parts.join(' ');
}

/**
 * Applica il wrapping delle citazioni al testo HTML.
 * Restituisce il testo con le citazioni wrappate in span.
 */
export function wrapCitationsInHtml(
  html: string,
  defaultNorma?: NormaContext
): string {
  const citations = extractCitations(html, defaultNorma);

  if (citations.length === 0) return html;

  // Processa dal fondo per non invalidare gli indici
  let result = html;
  for (let i = citations.length - 1; i >= 0; i--) {
    const citation = citations[i];
    const serialized = serializeCitation(citation.parsed);
    const escaped = serialized.replace(/"/g, '&quot;');

    const before = result.substring(0, citation.startIndex);
    const after = result.substring(citation.endIndex);
    const matchText = result.substring(citation.startIndex, citation.endIndex);

    result = before +
      `<span class="citation-hover" data-citation="${escaped}" data-cache-key="${citation.cacheKey}">${matchText}</span>` +
      after;
  }

  return result;
}
