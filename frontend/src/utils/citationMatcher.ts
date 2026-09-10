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

import { EU_ACT_TYPES, EU_PAIR_SOURCE, buildEuHeadSource, euKindOf, hasEuMarker, isOldEuMarker, resolveEuPair } from './euCitation';
import { expandTwoDigitYear } from './dateUtils';

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
  // Gli atti UE non stanno qui: li legge il PATTERN 0 con `euCitation.ts`.
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

// Atti nazionali numerati (legge, L., d.lgs., decreto legislativo, ecc.),
// condiviso dal PATTERN 1 (atto prima) e dal PATTERN 1a (articolo prima)
const NATIONAL_ACT_SOURCE =
  'legge|l\\.|' +
  'decreto\\s+legge|d\\.?\\s*l\\.?|dl|' +
  'decreto\\s+legislativo|d\\.?\\s*lgs\\.?|dlgs|' +
  'd\\.?\\s*p\\.?\\s*r\\.?|dpr|' +
  'regio\\s+decreto|r\\.?\\s*d\\.?|rd';

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
  // PATTERN 0: Atti UE, che leggono la coppia nel loro ordine
  // Es: "regolamento (UE) 2016/679, art. 5", "direttiva 2002/58/CE art. 5",
  //     "reg. ue 679/2016 art. 5", "art. 5 del regolamento (UE) 2016/679",
  //     "articoli 8 e 9 del regolamento (UE) 2016/679"
  // Prima del pattern italiano, così è questo a rivendicare l'intervallo:
  // letto come numero/anno, "2016/679" diventava il regolamento n. 2016.
  // Il marcatore è obbligatorio per i regolamenti: in un testo normativo un
  // "regolamento n. 5/2020" senza (UE) è di regola un regolamento interno.
  // Un elenco produce un link per numero, tutti verso l'atto UE: lasciato al
  // PATTERN 4 finiva sulla norma corrente, cioè sull'atto sbagliato.
  // ============================================
  const euHead = buildEuHeadSource();
  // Un articolo: numero, intervallo ("1-10") o suffisso ("2-bis")
  const articleItem = `\\d+(?:\\s*-\\s*\\d+)?${ARTICLE_SUFFIX_PATTERN}`;
  const articleList = `${articleItem}(?:\\s*(?:,|\\be\\b)\\s*${articleItem})*`;
  // "comma 1", "commi 1 e 2", "co. 3", "comma 1, lett. b)": qualifica
  // l'articolo, mai l'atto; la virgola di chiusura è punteggiatura normale
  const commaClause =
    '(?:\\s*,?\\s*(?:comm[ai]|co\\.)\\s*\\d+(?:\\s*(?:,|\\be\\b)\\s*\\d+)*)?' +
    '(?:\\s*,?\\s*(?:lett\\.?|lettera)\\s*[a-z]\\)?)?\\s*,?';
  // Parole d'atto che la prosa lega a un articolo con "del/della": se seguono
  // un articolo che nessun pattern ha saputo agganciare, quell'articolo NON è
  // della norma in lettura, e un link sbagliato è peggio di nessun link.
  // Residui che il PATTERN 4/5 lascia davanti a "del": la ")" di "lett. b)",
  // virgole, clausole di comma, lettera o numero.
  const tailResidue =
    '(?:\\s*[,)]|\\s*(?:comm[ai]|co\\.)\\s*\\d+(?:\\s*(?:,|\\be\\b)\\s*\\d+)*|\\s*(?:lett\\.?|lettera|numero|n\\.)\\s*[a-z0-9]+\\)?)*';
  const namesAnotherAct = (tail: string) => new RegExp(
    `^${tailResidue}\\s*(?:del|della|dello|dell['’])\\s*` +
    "(?:legge|l\\.|decreto|d\\.?\\s*lgs|dlgs|d\\.?\\s*p\\.?\\s*r|dpr|regolamento|reg\\.|direttiva|dir\\.|r\\.?\\s*d\\.|rd\\b|dl\\b|codice|costituzione|trattato)",
    'i'
  ).test(tail);

  const addArticleList = (
    whole: string, wholeStart: number, listText: string, listStart: number,
    base: { act_type: string; act_number: string; date: string }
  ) => {
    const numbers = Array.from(listText.matchAll(new RegExp(articleItem, 'gi')));
    if (numbers.length <= 1) {
      addMatch(whole, wholeStart, wholeStart + whole.length, {
        ...base, article: listText.replace(/\s+/g, ''), confidence: 0.95,
      });
      return;
    }
    for (const n of numbers) {
      const start = listStart + (n.index ?? 0);
      addMatch(n[0], start, start + n[0].length, {
        ...base, article: n[0].replace(/\s+/g, ''), confidence: 0.95,
      });
    }
  };

  const euBase = (head: string, first: string, second: string, trailingMarker: string | undefined) => {
    const kind = euKindOf(head);
    // Il marcatore è obbligatorio per i regolamenti, nella testa o in coda
    // alla coppia ("regolamento 1049/2001/CE"): in un testo normativo un
    // "regolamento n. 5/2020" senza (UE) è di regola un regolamento interno.
    const markers = `${head} ${trailingMarker ?? ''}`;
    if (kind === 'regolamento' && !hasEuMarker(markers)) return null;
    const pair = resolveEuPair(first, second, {
      kind, trailingMarker: Boolean(trailingMarker), oldMarker: isOldEuMarker(markers),
    });
    return pair ? { act_type: EU_ACT_TYPES[kind], act_number: pair.actNumber, date: pair.year } : null;
  };

  // La preposizione è facoltativa: "art. 5 direttiva (UE) 2016/680" e
  // "art. 7 d.lgs. 196/2003" sono la scorciatoia corrente nella prosa.
  const preposition = "(?:(?:del|della|dello|dell['’])\\s*)?";

  // 0a: "art. 5 del regolamento (UE) 2016/679", "articoli 8 e 9 del …"
  // Gruppi: 1 prefisso articolo, 2 elenco, 3-5 testa/coppia UE, 6 marcatore finale.
  const euArticleFirstRegex = new RegExp(
    `(${ARTICLE_WORD_PATTERN}\\s*)(${articleList})${commaClause}\\s+${preposition}` +
    `${euHead}${EU_PAIR_SOURCE}`,
    'gi'
  );

  let match;
  while ((match = euArticleFirstRegex.exec(cleanText)) !== null) {
    const [, prefix, listText, head, first, second, trailingMarker] = match;
    const base = euBase(head, first, second, trailingMarker);
    if (!base) continue;
    addArticleList(match[0], match.index, listText, match.index + prefix.length, base);
  }

  // 0b: "regolamento (UE) 2016/679, art. 5", "regolamento (UE) 2016/679, articoli 8 e 9"
  const euCitationRegex = new RegExp(
    `\\b${euHead}${EU_PAIR_SOURCE}` +
    `(?:\\s*,?\\s*${ARTICLE_WORD_PATTERN}\\s*(${articleList}))?`,
    'gi'
  );

  while ((match = euCitationRegex.exec(cleanText)) !== null) {
    const [, head, first, second, trailingMarker, listText] = match;

    // Senza articolo niente anteprima, come per il pattern italiano
    if (!listText) continue;
    if (isOverlapping(match.index, match.index + match[0].length)) continue;

    const base = euBase(head, first, second, trailingMarker);
    if (!base) continue;
    addArticleList(match[0], match.index, listText, match.index + match[0].length - listText.length, base);
  }

  // ============================================
  // PATTERN 1a: Articolo PRIMA di un atto nazionale numerato
  // Es: "art. 7 del d.lgs. 196/2003", "artt. 1, 2 e 3 del d.lgs. 196/2003",
  //     "art. 5, comma 1, della legge 241/1990", "art. 7 d.lgs. 196/2003"
  // È la forma corrente nella prosa: lasciata al PATTERN 5, l'articolo
  // finiva sulla norma in lettura, cioè su un atto sbagliato, in silenzio.
  // Gruppi: 1 prefisso, 2 elenco, 3 tipo atto, 4 numero, 5 anno.
  // ============================================
  const nationalArticleFirstRegex = new RegExp(
    `(${ARTICLE_WORD_PATTERN}\\s*)(${articleList})${commaClause}\\s+${preposition}` +
    `(${NATIONAL_ACT_SOURCE})\\s+(?:n\\.?\\s*)?(\\d+)\\s*[/\\\\]\\s*(\\d{4}|\\d{2})\\b`,
    'gi'
  );

  while ((match = nationalArticleFirstRegex.exec(cleanText)) !== null) {
    if (isOverlapping(match.index, match.index + match[0].length)) continue;
    const [, prefix, listText, actTypeMatch, actNumber, year] = match;
    addArticleList(match[0], match.index, listText, match.index + prefix.length, {
      act_type: normalizeActType(actTypeMatch),
      act_number: actNumber,
      date: expandTwoDigitYear(year),
    });
  }

  // ============================================
  // PATTERN 1: Citazioni complete con numero/anno
  // Es: "legge 241/1990", "L. 241/90", "d.lgs. 50/2016 art. 3"
  // ============================================
  const fullCitationRegex = new RegExp(
    // Tipo atto (legge, L., d.lgs., decreto legislativo, etc.)
    `(${NATIONAL_ACT_SOURCE})` +
    // Spazio e numero/anno (l'anno ha due o quattro cifre)
    '\\s+(?:n\\.?\\s*)?(\\d+)\\s*[/\\\\]\\s*(\\d{4}|\\d{2})\\b' +
    // Articolo opzionale
    `(?:\\s*,?\\s*${ARTICLE_WORD_PATTERN}\\s*(\\d+${ARTICLE_SUFFIX_PATTERN}))?`,
    'gi'
  );

  while ((match = fullCitationRegex.exec(cleanText)) !== null) {
    const actTypeMatch = match[1];
    const actNumber = match[2];
    const year = expandTwoDigitYear(match[3]);
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
      if (namesAnotherAct(cleanText.slice(fullMatchEnd, fullMatchEnd + 120))) {
        // Rinunciato: l'intervallo va marcato, o il PATTERN 5 riprende il
        // primo articolo dell'elenco e lo dà alla norma in lettura.
        usedRanges.push([fullMatchStart, fullMatchEnd]);
        continue;
      }

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
      const end = match.index + match[0].length;
      if (namesAnotherAct(cleanText.slice(end, end + 120))) continue;

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
 * Vero se `to` (il relatedTarget di un mouseleave) sta ancora dentro la
 * stessa citazione di `from`: una citazione avvolta per segmenti è fatta di
 * più span con lo stesso data-cache-key, e passare da uno all'altro non è
 * uscire dalla citazione. Senza questa guardia l'anteprima si chiudeva
 * proprio sulle citazioni che l'avvolgimento per segmenti aveva sistemato.
 */
export function isSameCitationTarget(from: Element, to: EventTarget | null): boolean {
  const candidate = to as Element | null;
  if (!candidate || typeof candidate.closest !== 'function') return false;
  const target = candidate.closest('.citation-hover');
  if (!target) return false;
  return target.getAttribute('data-cache-key') === from.getAttribute('data-cache-key');
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
    const open = `<span class="citation-hover" data-citation="${escaped}" data-cache-key="${citation.cacheKey}">`;

    const before = result.substring(0, citation.startIndex);
    const after = result.substring(citation.endIndex);
    const matchHtml = result.substring(citation.startIndex, citation.endIndex);

    // La citazione può attraversare un tag (un link lasciato nel testo, il
    // <mark> di un'evidenziazione): uno span aperto dentro un elemento e
    // chiuso fuori non è HTML. Si avvolge quindi ogni segmento di testo per
    // conto suo e i tag si lasciano dove stanno.
    const wrapped = matchHtml.replace(/<[^>]*>|[^<]+/g, piece =>
      piece.startsWith('<') ? piece : `${open}${piece}</span>`
    );

    result = before + wrapped + after;
  }

  return result;
}
