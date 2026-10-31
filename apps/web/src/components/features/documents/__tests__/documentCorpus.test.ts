import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractCitations } from '../../../../utils/citationMatcher';
import type { ServerNormReading } from '../../../../utils/normQuery';
import {
  buildVocabulary, candidateQueries, findCandidates, readOnClient, settleCitations, settledByServer,
  type DocumentCitation,
} from '../documentCandidates';
import { emptyScore, loadCorpus, scoreDocument, type Score } from './corpus/corpus';

// «Analizza documento» on the invented corpus of spec 2026-10-29-document-analysis (§3), with the server's answers
// recorded from the API's own functions (corpus/server.json, corpus/record_server.py): no request is made. It prints
// §3.2's table and fails below the floor. The figure the owners judge is the blind corpus's (§3.3), not this one.

/** The floor: on PR 1's code the spec measured 98 of 103 within the paragraph, with no wrong citation (§3.2). */
const FLOOR = 98;

const recorded = JSON.parse(readFileSync(join(__dirname, 'corpus', 'server.json'), 'utf8')) as {
  act_names: string[];
  answers: Record<string, ServerNormReading>;
};
const corpus = loadCorpus(__dirname);
const vocabulary = buildVocabulary(recorded.act_names);

function proposed(text: string) {
  const candidates = findCandidates(text, vocabulary);
  const client = readOnClient(candidates);
  const toServer = candidateQueries(candidates).filter((q) => !client.has(q));
  const missing = toServer.filter((q) => !(q in recorded.answers));
  const server = settledByServer(candidates, new Map(Object.entries(recorded.answers)));
  const settled = new Map([...client, ...server]);
  const analysis = settleCitations(text, candidates, { settled, unanswered: new Set() });
  const contextActs = candidates.flatMap((c) => {
    const reading = c.kind === 'act' && c.query ? settled.get(c.query) : undefined;
    return reading ? [{ start: c.start, end: c.end, act_type: reading.act_type!, act_number: reading.act_number, date: reading.date }] : [];
  });
  return { candidates, client, toServer, missing, analysis, contextActs };
}

function today(text: string): DocumentCitation[] {
  return extractCitations(text).map((m) => ({
    start: m.startIndex, end: m.endIndex, article: m.parsed.article, state: 'resolved' as const,
    act: { act_type: m.parsed.act_type, act_number: m.parsed.act_number, date: m.parsed.date },
  }));
}

const row = (name: string, s: Score) =>
  `| ${name} | ${s.found}${s.inherited ? ` (${s.inherited} inherited)` : ''} | ${s.wrong + s.spurious} | ${s.incomplete} | ${s.missed} | ${s.toDismiss} |`;

describe('«Analizza documento» on the corpus of spec 2026-10-29-document-analysis', () => {
  const runs = corpus.map((doc) => ({ doc, run: proposed(doc.text) }));

  if (process.env.RECORD_QUERIES) {
    it('writes the query strings the server is asked about (record_server.py answers them)', () => {
      const queries = [...new Set(runs.flatMap(({ run }) => run.toServer))].sort();
      writeFileSync(process.env.RECORD_QUERIES!, JSON.stringify(queries, null, 1));
      expect(queries.length).toBeGreaterThan(0);
    });
    return;
  }

  it('has every answer it needs recorded', () => {
    const missing = runs.flatMap(({ run }) => run.missing);
    expect(missing, 'record again: corpus/record_server.py').toEqual([]);
  });

  it(`finds at least ${FLOOR} of the corpus's article citations, none wrong, none invented`, () => {
    const total = emptyScore();
    const before = emptyScore();
    const perDocument: string[] = [];
    for (const { doc, run } of runs) {
      const mine = scoreDocument(doc, run.analysis.citations, run.contextActs, emptyScore());
      scoreDocument(doc, run.analysis.citations, run.contextActs, total);
      const old = scoreDocument(doc, today(doc.text), [], emptyScore());
      scoreDocument(doc, today(doc.text), [], before);
      perDocument.push(`${doc.name}: ${old.found} → ${mine.found} of ${mine.total}`);
    }
    const queries = new Set(runs.flatMap(({ run }) => candidateQueries(run.candidates)));
    const onClient = new Set(runs.flatMap(({ run }) => [...run.client.keys()]));
    const table = [
      '| Path | Found | Wrong or invented | To complete by hand | Missed | Non-norms to dismiss |',
      '| --- | ---: | ---: | ---: | ---: | ---: |',
      row('Today: the page’s `extractCitations`', before),
      row('**This PR**: candidates, the client then the server, inheritance within the paragraph', total),
      '',
      `Of ${total.total} article citations; acts named alone read as context: ${total.actsFound} of ${total.acts}.`,
      `By document, today → this PR: ${perDocument.join('; ')}.`,
      `Distinct query strings: ${queries.size}; read by the client parser: ${onClient.size}; sent to the server: ${queries.size - onClient.size}.`,
      '',
      ...total.details,
    ].join('\n');
    console.log(table);

    expect(total.wrong, table).toBe(0);
    expect(total.spurious, table).toBe(0);
    expect(total.missed, table).toBe(0);
    expect(total.found, table).toBeGreaterThanOrEqual(FLOOR);
  });
});
