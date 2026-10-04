import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { formatNormCitation } from '../citation';
import { decisionKey, formatDecisionCitation, linkableDecisionPath, type LooseDecisionRef } from '../decisionLinks';
import type { DecisionAttributes, DecisionIdentity } from '../../types/decisions';

// The convention for legal sources (docs/superpowers/specs/2026-10-04-source-convention-design.md)
// lives in one neutral file every suite reads. Until each area adopts it, this test keeps the
// file honest: its shape, the citations the owner decided, the decision paths, keys and citations
// the app builds.

function findGolden(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'conventions', 'sources', 'golden.json');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('conventions/sources/golden.json not found above ' + from);
  }
}

interface Expected { value: unknown; status: string }
interface NormCase {
  id: string; note: string;
  input: { tipo_atto: string; numero_articolo: string; tipo_atto_reale?: string; numero_atto?: string; data?: string; allegato?: string };
  identity: Record<string, Expected>;
  labels: Record<string, Expected>;
}
interface DecisionCase {
  id: string; note: string;
  input: { reference: LooseDecisionRef; attributes: Record<string, unknown>; rv?: string[]; legacy_keys?: string[] };
  identity: Record<string, Expected>;
  labels: Record<string, Expected>;
}

const golden = JSON.parse(readFileSync(findGolden(__dirname), 'utf8')) as {
  version: number; norms: NormCase[]; decisions: DecisionCase[];
};
const QUESTIONS = new Set(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8']); // the spec's §9
const cases = [...golden.norms, ...golden.decisions];
const expectations = cases.flatMap((c) => [...Object.entries(c.identity), ...Object.entries(c.labels)]
  .map(([field, expected]) => ({ id: c.id, field, expected })));

// The head of the web's lawyer citation: the version clause is the old golden file's, not this one's.
function citationHead(norma: NormCase['input']): string | null {
  const cited = formatNormCitation({
    norma,
    requestedDate: '2010-01-01',
    validity: { state: 'historical', valid_from: '2009-01-01', valid_to: '2011-01-01', version_number: 1, act_updated: null, request_in_window: true },
  });
  return cited ? cited.short.split(', nel testo')[0] : null;
}

describe('the golden file of legal sources', () => {
  it('has the shape the spec describes', () => {
    expect(golden.version).toBe(1);
    expect(golden.norms.length).toBeGreaterThan(15);
    expect(golden.decisions.length).toBeGreaterThan(5);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of golden.norms) {
      expect(typeof c.input.tipo_atto, c.id).toBe('string');
      expect(typeof c.input.numero_articolo, c.id).toBe('string');
      expect(c.note.length, c.id).toBeGreaterThan(0);
    }
    for (const c of golden.decisions) {
      expect(['cassazione', 'corte_costituzionale'], c.id).toContain(c.input.reference.corte);
      expect(Number.isInteger(c.input.reference.numero), c.id).toBe(true);
    }
  });

  it('gives every expected value a known status', () => {
    for (const { id, field, expected } of expectations) {
      expect(Object.keys(expected).sort(), `${id}.${field}`).toEqual(['status', 'value']);
      const open = /^open:(Q\d+)$/.exec(expected.status);
      if (open) expect(QUESTIONS.has(open[1]), `${id}.${field}: ${expected.status}`).toBe(true);
      else expect(['decided', 'current', 'proposed'], `${id}.${field}`).toContain(expected.status);
    }
  });

  describe('decided citations of norms are what citation.ts writes', () => {
    // Decided by the owner on 4 October 2026 and not written by citation.ts yet: the web
    // adoption PR (plan, PR 1) empties this list. A case listed here that starts passing
    // fails too, so the list cannot go stale.
    const PENDING_ADOPTION = new Set([
      'l-184-1983-6-year-only', 'dpcm-2020-03-08-1', 'dm-55-2014-4', 'cpi-regolamento-1',
      'lcost-1-2012-1', 'gdpr-5', 'nis2-21', 'tfue-101',
    ]);
    const decided = golden.norms.filter((c) => c.labels.citation?.status === 'decided');
    it('covers the cases the owner decided', () => expect(decided.length).toBeGreaterThan(10));
    it('lists only decided cases as pending', () => {
      for (const id of PENDING_ADOPTION) expect(decided.map((c) => c.id), id).toContain(id);
    });
    for (const c of decided) {
      if (PENDING_ADOPTION.has(c.id)) {
        it(`${c.id} (pending adoption)`, () => expect(citationHead(c.input)).not.toBe(c.labels.citation.value));
      } else {
        it(c.id, () => expect(citationHead(c.input)).toBe(c.labels.citation.value));
      }
    }
  });

  describe('current decision paths are what decisionLinks.ts builds', () => {
    const now = new Date('2026-10-04T12:00:00Z');
    // An identity's path, or a reference's (no archive: the page resolves it).
    for (const c of golden.decisions) {
      const path = c.identity.path ?? c.identity.reference_path;
      if (path?.status !== 'current') continue;
      it(c.id, () => expect(linkableDecisionPath(c.input.reference, now)).toBe(path.value));
    }
  });

  describe('decided citations and current keys of decisions are what decisionLinks.ts writes', () => {
    // A case is an identity when the file gives it a key: its reference is then complete (the archive
    // and the year are known), as the Python suite reads it. `identity.fields`, where the file has it
    // (two cases of nine), must say the same.
    const identityOfReference = (r: LooseDecisionRef): DecisionIdentity | null => {
      if (r.anno == null) return null;
      if (r.corte === 'corte_costituzionale') return { corte: r.corte, numero: r.numero, anno: r.anno };
      if (r.corte === 'cassazione' && (r.archivio === 'civile' || r.archivio === 'penale')) {
        return { corte: r.corte, archivio: r.archivio, numero: r.numero, anno: r.anno };
      }
      return null;
    };
    const keyed = golden.decisions.filter((c) => c.identity.key?.status === 'current' && typeof c.identity.key.value === 'string');
    const unkeyed = golden.decisions.filter((c) => c.identity.key?.status === 'current' && c.identity.key.value === null);
    const identities = keyed.flatMap((c) => {
      const identity = identityOfReference(c.input.reference);
      // the file's attributes are a decision's, plus fields the model has not got yet (data_udienza)
      return identity ? [{ c, identity, attributes: c.input.attributes as DecisionAttributes }] : [];
    });

    it('has an identity for every case with a key, the same as identity.fields, and none for the rest', () => {
      expect(keyed.length).toBeGreaterThan(4);
      expect(identities.map((i) => i.c.id)).toEqual(keyed.map((c) => c.id));
      for (const { c, identity } of identities) {
        if (c.identity.fields?.status === 'current') expect(c.identity.fields.value, c.id).toEqual(identity);
      }
      expect(unkeyed.length).toBeGreaterThan(0);
      for (const c of unkeyed) expect(identityOfReference(c.input.reference), c.id).toBeNull();
    });

    for (const { c, identity } of identities) {
      it(`${c.id}: the key`, () => expect(decisionKey(identity)).toBe(c.identity.key.value));
    }

    // Decided and not written yet: the hearing date. Italgiure gives none and the model has no `data_udienza`.
    // A case listed here that starts passing fails too, so the list cannot go stale.
    const PENDING_DECISIONS = new Set(['cass-pen-hearing-date-known']);
    const decided = identities.filter(({ c }) => c.labels.citation?.status === 'decided');
    it('covers the decisions the owner decided a citation for', () => expect(decided.length).toBeGreaterThan(4));
    it('lists only decided cases as pending', () => {
      for (const id of PENDING_DECISIONS) expect(decided.map(({ c }) => c.id), id).toContain(id);
    });
    for (const { c, identity, attributes } of decided) {
      if (PENDING_DECISIONS.has(c.id)) {
        it(`${c.id} (pending adoption)`, () => expect(formatDecisionCitation(identity, attributes)).not.toBe(c.labels.citation.value));
      } else {
        it(`${c.id}: the citation`, () => expect(formatDecisionCitation(identity, attributes)).toBe(c.labels.citation.value));
      }
    }
  });
});
