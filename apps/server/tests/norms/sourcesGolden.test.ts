import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CODES_TABLE } from '../../src/norms/actTypes';
import { citeAct, citeArticle, shortNorm, type CitableNorm } from '../../src/norms/citation';
import { citeDecision, shortDecision, type CitableDecision } from '../../src/norms/decisionCitation';

// The server's labels of norms and decisions against the convention's golden file
// (conventions/sources/golden.json; spec docs/superpowers/specs/2026-10-04-source-convention-design.md).
// The web app, the API and MERL-T read the same file: a copy that drifts fails here.

function root(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'conventions', 'sources', 'golden.json'))) return dir;
    if (dirname(dir) === dir) throw new Error('conventions/sources/golden.json not found above ' + from);
  }
}

interface Expected { value: string | null; status: string }
interface NormCase { id: string; input: CitableNorm; labels: Record<string, Expected> }
interface DecisionCase {
  id: string;
  input: { reference: CitableDecision; attributes: Record<string, unknown>; rv?: string[] };
  labels: Record<string, Expected>;
}

const ROOT = root(__dirname);
const golden = JSON.parse(readFileSync(join(ROOT, 'conventions', 'sources', 'golden.json'), 'utf8')) as {
  norms: NormCase[];
  decisions: DecisionCase[];
};
const ASSERTED = new Set(['decided', 'current', 'proposed']);
const withLabel = <T extends { labels: Record<string, Expected> }>(cases: T[], label: string): T[] =>
  cases.filter((c) => c.labels[label] && ASSERTED.has(c.labels[label].status));

describe('the labels of norms are the golden file\'s', () => {
  const LABELS: Array<[string, (norm: CitableNorm) => string]> = [
    ['citation', citeArticle],
    ['short', shortNorm],
    ['act_citation', citeAct],
  ];
  for (const [label, write] of LABELS) {
    describe(label, () => {
      it('has cases', () => expect(withLabel(golden.norms, label).length).toBeGreaterThan(0));
      for (const c of withLabel(golden.norms, label)) {
        it(c.id, () => expect(write(c.input)).toBe(c.labels[label].value));
      }
    });
  }
});

describe('the labels of decisions are the golden file\'s', () => {
  // The decision as the dossier item holds it: the identity, the section and the attributes.
  const decisionOf = (c: DecisionCase): CitableDecision => {
    const attrs = c.input.attributes;
    const str = (k: string) => (typeof attrs[k] === 'string' ? (attrs[k] as string) : null);
    return {
      ...c.input.reference,
      sezione: c.input.reference.sezione ?? str('sezione'),
      tipo: str('tipo'),
      data_deposito: str('data_deposito'),
    };
  };
  // Decided and not written yet anywhere: the hearing date, which Italgiure does not give.
  const PENDING = new Set(['cass-pen-hearing-date-known']);
  const citations = withLabel(golden.decisions, 'citation').filter((c) => !PENDING.has(c.id));
  it('has citations', () => expect(citations.length).toBeGreaterThan(4));
  for (const c of citations) {
    it(`${c.id}: the citation`, () => expect(citeDecision(decisionOf(c))).toBe(c.labels.citation.value));
  }
  for (const c of withLabel(golden.decisions, 'short')) {
    it(`${c.id}: the short label`, () => expect(shortDecision(decisionOf(c))).toBe(c.labels.short.value));
  }
  for (const c of withLabel(golden.decisions, 'short_with_rv')) {
    it(`${c.id}: the short label with the massime`, () =>
      expect(shortDecision(decisionOf(c), c.input.rv)).toBe(c.labels.short_with_rv.value));
  }
});

describe('the codes table is the API\'s', () => {
  it('has the same rows', () => {
    const python = readFileSync(join(ROOT, 'services', 'visualex', 'visualex_api', 'tools', 'map.py'), 'utf8');
    const start = python.indexOf('NORMATTIVA_URN_CODICI = {');
    const block = python.slice(start, python.indexOf('\n}', start));
    const rows = Object.fromEntries([...block.matchAll(/^\s*"(.+)":\s*"(.+)",?\s*$/gm)].map((m) => [m[1], m[2]]));
    expect(Object.keys(rows).length).toBeGreaterThan(30);
    expect(CODES_TABLE).toEqual(rows);
  });
});
