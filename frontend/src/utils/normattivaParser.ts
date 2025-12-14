import type { SearchParams } from '../types';

/**
 * Parses a Normattiva URL and extracts search parameters
 *
 * Normattiva URL formats:
 * - https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art1
 * - https://www.normattiva.it/atto/caricaDettaglioAtto?atto.dataPubblicazioneGazzetta=1990-08-07&atto.codiceRedazionale=090G0294
 * - https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262~art2043
 *
 * URN format: urn:nir:{authority}:{tipo_atto}:{data};{numero}~art{articolo}
 */

// Map URN act types to our internal format
const URN_ACT_TYPE_MAP: Record<string, string> = {
  'legge': 'legge',
  'decreto.legge': 'decreto legge',
  'decreto.legislativo': 'decreto legislativo',
  'decreto.del.presidente.della.repubblica': 'd.p.r.',
  'regio.decreto': 'regio decreto',
  'codice.civile': 'codice civile',
  'codice.penale': 'codice penale',
  'codice.di.procedura.civile': 'codice di procedura civile',
  'codice.di.procedura.penale': 'codice di procedura penale',
  'costituzione': 'costituzione',
};

interface ParseResult {
  success: boolean;
  params?: Partial<SearchParams>;
  error?: string;
}

/**
 * Parse a Normattiva URN string
 * Example: urn:nir:stato:legge:1990-08-07;241~art1
 */
function parseURN(urn: string): ParseResult {
  try {
    // Remove "urn:nir:" prefix
    const withoutPrefix = urn.replace(/^urn:nir:/i, '');

    // Split by : to get parts
    // Format: {authority}:{tipo_atto}:{data};{numero}~art{articolo}
    const parts = withoutPrefix.split(':');

    if (parts.length < 3) {
      return { success: false, error: 'URN non valido: formato non riconosciuto' };
    }

    // Authority is first part (e.g., "stato")
    // Act type is second part (e.g., "legge" or "codice.civile")
    const actTypePart = parts[1];

    // Last part contains date, number, and article
    // Format: {data};{numero}~art{articolo} or {data};{numero}~art{articolo}-com{comma}
    const lastPart = parts.slice(2).join(':'); // Rejoin in case there were extra colons

    // Extract date (before semicolon or tilde)
    let date = '';
    let actNumber = '';
    let article = '';

    // Try to match different patterns
    const fullMatch = lastPart.match(/^(\d{4}-\d{2}-\d{2});?(\d+)?(?:~art(\d+[a-z]?))?/i);

    if (fullMatch) {
      date = fullMatch[1] || '';
      actNumber = fullMatch[2] || '';
      article = fullMatch[3] || '1';
    } else {
      // Try simpler pattern for codici
      const simpleMatch = lastPart.match(/^(\d{4}-\d{2}-\d{2});?(\d+)?/);
      if (simpleMatch) {
        date = simpleMatch[1] || '';
        actNumber = simpleMatch[2] || '';
      }

      // Extract article from ~art{number}
      const articleMatch = lastPart.match(/~art(\d+[a-z]?)/i);
      if (articleMatch) {
        article = articleMatch[1];
      }
    }

    // Map act type
    const actType = URN_ACT_TYPE_MAP[actTypePart.toLowerCase()] || actTypePart.replace(/\./g, ' ');

    return {
      success: true,
      params: {
        act_type: actType,
        date: date,
        act_number: actNumber,
        article: article || '1',
        version: 'vigente',
        show_brocardi_info: true
      }
    };
  } catch (e) {
    return { success: false, error: 'Errore nel parsing dell\'URN' };
  }
}

/**
 * Parse a full Normattiva URL
 */
export function parseNormattivaUrl(url: string): ParseResult {
  try {
    // Clean the URL
    const cleanUrl = url.trim();

    // Check if it's a Normattiva URL
    if (!cleanUrl.includes('normattiva.it')) {
      return { success: false, error: 'URL non riconosciuto come Normattiva' };
    }

    // Try to extract URN from the URL
    // Pattern 1: uri-res/N2Ls?{urn}
    const urnMatch = cleanUrl.match(/uri-res\/N2Ls\?(.+?)(?:&|$)/i);
    if (urnMatch) {
      const urn = decodeURIComponent(urnMatch[1]);
      return parseURN(urn);
    }

    // Pattern 2: Check for urn parameter
    const urlObj = new URL(cleanUrl);
    const urnParam = urlObj.searchParams.get('urn');
    if (urnParam) {
      return parseURN(urnParam);
    }

    // Pattern 3: Try to find URN anywhere in the URL
    const urnInUrl = cleanUrl.match(/urn:nir:[^\s&]+/i);
    if (urnInUrl) {
      return parseURN(urnInUrl[0]);
    }

    // Pattern 4: caricaDettaglioAtto format
    // https://www.normattiva.it/atto/caricaDettaglioAtto?atto.dataPubblicazioneGazzetta=1990-08-07&...
    if (cleanUrl.includes('caricaDettaglioAtto')) {
      const dateMatch = cleanUrl.match(/dataPubblicazioneGazzetta=(\d{4}-\d{2}-\d{2})/);
      // This format is harder to parse fully, return partial
      if (dateMatch) {
        return {
          success: true,
          params: {
            date: dateMatch[1],
            article: '1',
            version: 'vigente',
            show_brocardi_info: true
          }
        };
      }
    }

    return { success: false, error: 'Impossibile estrarre i parametri dall\'URL' };
  } catch (e) {
    return { success: false, error: 'URL non valido' };
  }
}

/**
 * Generate a label from search params
 */
export function generateLabelFromParams(params: Partial<SearchParams>): string {
  const parts: string[] = [];

  if (params.article) {
    parts.push(`Art. ${params.article}`);
  }

  if (params.act_type) {
    // Abbreviate common act types
    const abbrev: Record<string, string> = {
      // Fonti Primarie
      'costituzione': 'Cost.',
      'legge': 'L.',
      'decreto legge': 'D.L.',
      'decreto legislativo': 'D.Lgs.',
      'decreto del presidente della repubblica': 'D.P.R.',
      'regio decreto': 'R.D.',
      // Codici Fondamentali
      'codice civile': 'C.C.',
      'codice penale': 'C.P.',
      'codice di procedura civile': 'C.P.C.',
      'codice di procedura penale': 'C.P.P.',
      'preleggi': 'Prel.',
      "disposizioni per l'attuazione del codice civile e disposizioni transitorie": 'Disp. Att. C.C.',
      "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie": 'Disp. Att. C.P.C.',
      // Codici Settoriali
      'codice della strada': 'C.d.S.',
      'codice della navigazione': 'Cod. Nav.',
      'codice del consumo': 'Cod. Cons.',
      'codice in materia di protezione dei dati personali': 'Cod. Privacy',
      'norme in materia ambientale': 'Cod. Amb.',
      'codice dei contratti pubblici': 'Cod. Appalti',
      'codice dei beni culturali e del paesaggio': 'Cod. Beni Cult.',
      'codice delle assicurazioni private': 'Cod. Ass.',
      'codice del processo tributario': 'C.P.Tr.',
      'codice del processo amministrativo': 'C.P.A.',
      "codice dell'amministrazione digitale": 'CAD',
      'codice della proprietà industriale': 'C.P.I.',
      'codice delle comunicazioni elettroniche': 'CCE',
      'codice delle pari opportunità': 'CPO',
      "codice dell'ordinamento militare": 'COM',
      'codice del turismo': 'Cod. Tur.',
      'codice antimafia': 'Cod. Antim.',
      'codice di giustizia contabile': 'CGC',
      'codice del terzo settore': 'CTS',
      'codice della protezione civile': 'Cod. Prot. Civ.',
      "codice della crisi d'impresa e dell'insolvenza": 'CCI',
      'codice della nautica da diporto': 'CND',
    };

    const actAbbrev = abbrev[params.act_type.toLowerCase()] || params.act_type;
    parts.push(actAbbrev);
  }

  if (params.act_number) {
    parts.push(`n. ${params.act_number}`);
  }

  if (params.date) {
    // Format date as year only if it's a full date
    const year = params.date.split('-')[0];
    if (year) {
      parts.push(`/${year}`);
    }
  }

  return parts.join(' ') || 'Norma senza titolo';
}

/**
 * Validate search params have minimum required fields
 */
export function validateSearchParams(params: Partial<SearchParams>): boolean {
  return !!(params.act_type && params.article);
}
