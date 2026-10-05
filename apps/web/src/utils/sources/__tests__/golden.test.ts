import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CODES_TABLE } from '../actTypes';
import { actHeading, citeAct, citeNorm, normFromUrn, shortAct, shortNorm, type LabelledNorm } from '../normLabels';

// The web app's labels of norms against the convention's golden file
// (conventions/sources/golden.json; spec docs/superpowers/specs/2026-10-04-source-convention-design.md).

function root(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'conventions', 'sources', 'golden.json'))) return dir;
    if (dirname(dir) === dir) throw new Error('conventions/sources/golden.json not found above ' + from);
  }
}

interface Expected { value: string | null; status: string }
interface NormCase { id: string; input: LabelledNorm; identity: Record<string, Expected>; labels: Record<string, Expected> }

const ROOT = root(__dirname);
const golden = JSON.parse(readFileSync(join(ROOT, 'conventions', 'sources', 'golden.json'), 'utf8')) as { norms: NormCase[] };
const ASSERTED = new Set(['decided', 'current', 'proposed']);

function casesWith(label: string): NormCase[] {
  return golden.norms.filter((c) => c.labels[label] && ASSERTED.has(c.labels[label].status));
}

const LABELS: Array<[string, (norm: LabelledNorm) => string]> = [
  ['citation', citeNorm],
  ['short', shortNorm],
  ['act_citation', citeAct],
  ['act_short', shortAct],
  ['act_heading', actHeading],
];

describe('the labels of norms are the golden file\'s', () => {
  for (const [label, write] of LABELS) {
    describe(label, () => {
      it('has cases', () => expect(casesWith(label).length).toBeGreaterThan(0));
      for (const c of casesWith(label)) {
        it(c.id, () => expect(write(c.input)).toBe(c.labels[label].value));
      }
    });
  }
});

describe('a norm read back from its identity gets the same short label', () => {
  const readable = casesWith('short').filter((c) => /^https:\/\/www\.normattiva\.it\//.test(c.identity.article?.value ?? ''));
  it('has cases', () => expect(readable.length).toBeGreaterThan(10));
  for (const c of readable) {
    it(c.id, () => expect(shortNorm(normFromUrn(c.identity.article.value) ?? {})).toBe(c.labels.short.value));
  }
  it('the preleggi are never the codice civile', () => {
    const preleggi = normFromUrn('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:1~art12');
    expect(shortNorm(preleggi ?? {})).toBe('art. 12 preleggi');
  });
  it('a malformed type token, an alias and a version marker are read too', () => {
    expect(shortNorm(normFromUrn('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto legislativo:2005-09-06;206~art33') ?? {}))
      .toBe('art. 33 d.lgs. 206/2005');
    expect(shortNorm(normFromUrn('urn:nir:stato:codice.civile:1942-03-16;262~art2043!vig=2024-01-15') ?? {})).toBe('art. 2043 c.c.');
  });
  it('what names no norm is null', () => {
    for (const value of ['cassazione:civile:31310:2024', 'concetto:buona_fede', '', 'urn:nir:regione.veneto:legge:2017-11-03;39~art25']) {
      expect(normFromUrn(value)).toBeNull();
    }
  });
});

describe('the codes table is the API\'s', () => {
  it('has the same rows', () => {
    const python = readFileSync(join(ROOT, 'services', 'visualex', 'visualex_api', 'tools', 'map.py'), 'utf8');
    const block = python.slice(python.indexOf('NORMATTIVA_URN_CODICI = {'), python.indexOf('\n}', python.indexOf('NORMATTIVA_URN_CODICI = {')));
    const rows = Object.fromEntries([...block.matchAll(/^\s*"(.+)":\s*"(.+)",?\s*$/gm)].map((m) => [m[1], m[2]]));
    expect(Object.keys(rows).length).toBeGreaterThan(30);
    expect(CODES_TABLE).toEqual(rows);
  });
});
