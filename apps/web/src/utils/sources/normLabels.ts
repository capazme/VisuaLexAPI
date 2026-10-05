/**
 * How the web app writes a norm, for each use (source convention, spec
 * docs/superpowers/specs/2026-10-04-source-convention-design.md §3; golden file
 * conventions/sources/golden.json). The API, the server and MERL-T write the same words with
 * their own copies; the golden file fails the one that drifts.
 *
 * - `citeNorm`: the citation — «art. 2, l. 7 agosto 1990, n. 241», «art. 2043 c.c.».
 * - `shortNorm`: the article in little room — «art. 2 l. 241/1990».
 * - `citeAct`, `shortAct`, `actHeading`: the act alone.
 * - `inForceCitation`: the citation a copy of the text in force starts with (D8).
 */
import type { NormaVisitata } from '../../types';
import { formatDateForCitation, withPreposition } from '../dateUtils';
import { ACT_TYPES, CODES_TABLE, EU_ACTS, NAMED_ACTS, NAMED_HEADINGS } from './actTypes';

/** The fields a label reads: a stored `norma_data`, or what a parser or a search gives. */
export type LabelledNorm = Partial<Pick<NormaVisitata, 'tipo_atto' | 'tipo_atto_reale' | 'numero_atto' | 'data' | 'allegato' | 'numero_articolo'>>;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NIR_ACT = /^([a-z.]+):(\d{4}-\d{2}-\d{2});(\d+[a-z]*)(?::([^:~]+))?$/;

const key = (text?: string | null): string => (text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
const text = (value?: string | null): string => (typeof value === 'string' ? value.trim() : '');

const CODES_BY_NAME: ReadonlyMap<string, string> = new Map(Object.entries(CODES_TABLE).map(([name, urn]) => [key(name), urn]));

/** "29 dicembre 2007", "1° settembre 1993"; null for anything that is not a full ISO day. */
function day(iso: string): string | null {
  const match = ISO_DAY.exec(iso);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  return formatDateForCitation(iso);
}

/** The act's type, date and number: an aliased code by the decree it is, from the codes table
 * when the norm does not say. */
function realType(norm: LabelledNorm): { type: string; date: string; number: string } {
  let type = key(norm.tipo_atto_reale);
  let date = text(norm.data);
  let number = text(norm.numero_atto);
  if (!type) {
    const match = NIR_ACT.exec(CODES_BY_NAME.get(key(norm.tipo_atto)) ?? '');
    if (match) {
      type = match[1].replace(/\./g, ' ');
      date = date || match[2];
      number = number || match[3];
    }
  }
  return { type: type || key(norm.tipo_atto), date, number };
}

function act(norm: LabelledNorm, short: boolean): { act: string; joiner: string } {
  const kind = key(norm.tipo_atto);
  const named = NAMED_ACTS[kind];
  if (named) return { act: named, joiner: ' ' };
  const joiner = short ? ' ' : ', ';
  const eu = EU_ACTS[kind];
  if (eu) {
    const number = text(norm.numero_atto);
    const year = text(norm.data).slice(0, 4);
    return { act: number && /^\d{4}$/.test(year) ? `${eu} ${year}/${number}` : eu, joiner };
  }
  const { type, date, number } = realType(norm);
  const abbreviation = ACT_TYPES[type] ?? type;
  const spelled = day(date);
  const year = /^\d{4}(-\d{2}-\d{2})?$/.test(date) ? date.slice(0, 4) : '';
  if (short) {
    if (number && year) return { act: `${abbreviation} ${number}/${year}`, joiner };
    if (spelled) return { act: `${abbreviation} ${spelled}`, joiner };
    return { act: number ? `${abbreviation} n. ${number}` : abbreviation, joiner };
  }
  if (spelled) return { act: `${abbreviation} ${spelled}${number ? `, n. ${number}` : ''}`, joiner };
  // Known by its year only (D7): never a day the source did not give.
  if (year) return { act: number ? `${abbreviation} n. ${number} del ${year}` : `${abbreviation} del ${year}`, joiner };
  return { act: number ? `${abbreviation}, n. ${number}` : abbreviation, joiner };
}

function annex(norm: LabelledNorm, short: boolean): string {
  const value = text(norm.allegato);
  const kind = key(norm.tipo_atto);
  // A code's annex is the code itself (c.c. is Allegato 2 of r.d. 262/1942): never named.
  if (!value || NAMED_ACTS[kind] || EU_ACTS[kind]) return '';
  return short ? ` (All. ${value})` : ` (Allegato ${value})`;
}

/** «art. 2, l. 7 agosto 1990, n. 241», «art. 2043 c.c.», «art. 5, reg. (UE) 2016/679». */
export function citeNorm(norm: LabelledNorm): string {
  const { act: cited, joiner } = act(norm, false);
  return `art. ${text(norm.numero_articolo)}${joiner}${cited}${annex(norm, false)}`;
}

/** «art. 2 l. 241/1990», «art. 2043 c.c.»: tabs, rows, chips, the graph's estremi. */
export function shortNorm(norm: LabelledNorm): string {
  const { act: cited, joiner } = act(norm, true);
  return `art. ${text(norm.numero_articolo)}${joiner}${cited}${annex(norm, true)}`;
}

/** What a search or a parser gives (`act_type`, `act_number`, `date`, `article`). */
export interface LabelParams { act_type?: string; act_number?: string; date?: string; article?: string }

/**
 * The short label of what a search or a parser names: the article's («art. 2 l. 241/1990»)
 * or, with no article, the act's («l. 241/1990»). Previews, in-text links, quick norms.
 */
export function labelFromParams(params: LabelParams): string {
  const norm: LabelledNorm = { tipo_atto: params.act_type, numero_atto: params.act_number, data: params.date };
  return params.article?.trim() ? shortNorm({ ...norm, numero_articolo: params.article.trim() }) : shortAct(norm);
}

/** The act alone, as cited: «l. 7 agosto 1990, n. 241», «c.c.». */
export function citeAct(norm: LabelledNorm): string {
  return act(norm, false).act;
}

/** The act alone, in little room: «l. 241/1990», «c.c.». */
export function shortAct(norm: LabelledNorm): string {
  return act(norm, true).act;
}

/** The act as a title: a code's name («Codice civile»), else its citation. */
export function actHeading(norm: LabelledNorm): string {
  return NAMED_HEADINGS[key(norm.tipo_atto)] ?? citeAct(norm);
}

/** An act named by its own name or listed in the codes table: its heading needs no estremi. */
export function isNamedAct(norm: LabelledNorm): boolean {
  const kind = key(norm.tipo_atto);
  return Boolean(NAMED_HEADINGS[kind]) || CODES_BY_NAME.has(kind);
}

/**
 * What a heading does not already say, for the line under it: the decree a code is
 * («r.d. 16 marzo 1942, n. 262» under «Codice civile»), the name of an aliased code
 * («Codice in materia di protezione dei dati personali» under «d.lgs. 30 giugno 2003, n. 196»),
 * nothing for any other act. Empty when there is nothing to add.
 */
export function actSubtitle(norm: LabelledNorm): string {
  const kind = key(norm.tipo_atto);
  if (NAMED_HEADINGS[kind]) {
    return text(norm.tipo_atto_reale) && text(norm.data)
      ? citeAct({ tipo_atto: norm.tipo_atto_reale, data: norm.data, numero_atto: norm.numero_atto })
      : '';
  }
  if (CODES_BY_NAME.has(kind)) {
    const name = text(norm.tipo_atto);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return '';
}

/**
 * The citation a copy of the text in force starts with (D8, owner, 4 October 2026):
 * «art. 2, l. 7 agosto 1990, n. 241 (Normattiva, testo vigente, consultato il 5 ottobre 2026)».
 * An act of the Union names EUR-Lex, its source.
 */
export function inForceCitation(norm: LabelledNorm, consultedAt?: string): string {
  const source = EU_ACTS[key(norm.tipo_atto)] || ['tue', 'tfue', 'cdfue'].includes(key(norm.tipo_atto)) ? 'EUR-Lex' : 'Normattiva';
  const consulted = consultedAt ? `, consultato ${withPreposition('il', formatDateForCitation(consultedAt))}` : '';
  return `${citeNorm(norm)} (${source}, testo vigente${consulted})`;
}

const ACT_BY_URN: ReadonlyMap<string, string> = new Map(Object.entries(CODES_TABLE).map(([name, urn]) => [urn.toLowerCase(), name]));
const CODE_ALIASES: Readonly<Record<string, string>> = {
  'codice.civile:1942-03-16;262': 'regio.decreto:1942-03-16;262:2',
  'codice.procedura.civile:1940-10-28;1443': 'regio.decreto:1940-10-28;1443:1',
  'codice.penale:1930-10-19;1398': 'regio.decreto:1930-10-19;1398:1',
  'codice.procedura.penale:1988-09-22;447': 'decreto.del.presidente.della.repubblica:1988-09-22;447',
  'costituzione:1947-12-27': 'costituzione',
};
const ELI = /\/eli\/(reg|dir)\/(\d{4})\/(\d+)/i;
const ARTICLE = /^art(\d+)([a-z]*)((?:\.\d+)?)/;

/**
 * The norm a URN names (a Normattiva URN, bare or in its URL, or an EUR-Lex ELI page), or
 * null when it names none. Reads the act from the codes table, so the preleggi
 * (`…262:1`) are never the codice civile (`…262:2`).
 */
export function normFromUrn(urn: string | null | undefined): LabelledNorm | null {
  if (!urn) return null;
  const eli = ELI.exec(urn);
  if (eli) return { tipo_atto: eli[1].toLowerCase() === 'reg' ? 'regolamento ue' : 'direttiva ue', data: eli[2], numero_atto: eli[3] };
  const at = urn.toLowerCase().lastIndexOf('urn:nir:');
  if (at === -1) return null;
  let body = urn.slice(at + 'urn:nir:'.length).split(/[!@]/)[0];
  const [head, ...rest] = body.split('~');
  let actPart = head.toLowerCase().startsWith('stato:') ? head.slice('stato:'.length) : head;
  // The type token Normattiva writes with dots ("decreto legislativo:", "decreto-legge:" are malformed).
  const [type, ...tail] = actPart.split(':');
  // Only the type is lower case: an annex keeps its own ("81:A").
  actPart = [type.trim().replace(/[\s-]+/g, '.').toLowerCase(), ...tail].join(':');
  actPart = CODE_ALIASES[actPart] ?? actPart;
  body = rest.join('~');
  const article = ARTICLE.exec(body);
  const numero = article ? `${article[1]}${article[2] ? `-${article[2]}` : ''}${article[3]}` : undefined;
  const name = ACT_BY_URN.get(actPart.toLowerCase());
  if (actPart.split(':')[0] === 'costituzione') return { tipo_atto: 'costituzione', numero_articolo: numero };
  const match = NIR_ACT.exec(actPart);
  if (!match) {
    // An act with no number ("decreto.del.presidente.del.consiglio.dei.ministri:2020-03-08").
    const bare = /^([a-z.]+):(\d{4}-\d{2}-\d{2})$/.exec(actPart);
    if (!bare) return null;
    const type = bare[1].replace(/\./g, ' ');
    return { tipo_atto: type, tipo_atto_reale: type, data: bare[2], numero_articolo: numero };
  }
  const norm: LabelledNorm = {
    tipo_atto: name ?? match[1].replace(/\./g, ' '),
    tipo_atto_reale: match[1].replace(/\./g, ' '),
    data: match[2],
    numero_atto: match[3],
    numero_articolo: numero,
  };
  if (match[4] && !name) norm.allegato = match[4];
  return norm;
}
