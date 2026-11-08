import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServerNormReading } from '../../../../utils/normQuery';
import { buildVocabulary, findCandidates, readOnClient, settleCitations, settledByServer } from '../documentCandidates';
import {
  buildLinkedPaste, documentLinks, normKey, normsToAsk, prepareLinks, type LinkAnswer, type LinkChoice, type LinkNorm,
} from '../documentLinks';
import { actKey, loadCorpus, overlaps, sameArticle } from './corpus/corpus';

// The links of «Analizza documento» (spec 2026-10-31-document-hyperlinks, L3) on the invented corpus of spec #376,
// with the server's answers recorded: the readings (corpus/server.json) and the addresses of /fetch_norm_links
// (corpus/links.json, record_links.py). No request is made. A link is wrong when its row's act or article differs
// from the corpus's mark: there must be none (§4.3 point 5).

const DIR = join(__dirname, 'corpus');
const readings = JSON.parse(readFileSync(join(DIR, 'server.json'), 'utf8')) as { act_names: string[]; answers: Record<string, ServerNormReading> };
const linksFile = join(DIR, 'links.json');
const recorded = existsSync(linksFile) ? JSON.parse(readFileSync(linksFile, 'utf8')) as { answers: Record<string, LinkAnswer> } : { answers: {} };
const vocabulary = buildVocabulary(readings.act_names);
const corpus = loadCorpus(__dirname);

function analyse(text: string) {
  const candidates = findCandidates(text, vocabulary);
  const settled = new Map([...settledByServer(candidates, new Map(Object.entries(readings.answers))), ...readOnClient(candidates)]);
  return settleCitations(text, candidates, { settled, unanswered: new Set() }).citations;
}

/** Every inherited row confirmed: the most links the page can write on this corpus. */
const confirmAll = (rows: ReturnType<typeof analyse>) =>
  new Map<number, LinkChoice>(rows.flatMap((row, i) => (row.state === 'inherited' ? [[i, { confirmed: true }] as const] : [])));

describe('the links of «Analizza documento» on the corpus of spec #376', () => {
  const runs = corpus.map((doc) => ({ doc, rows: analyse(doc.text) }));

  if (process.env.RECORD_NORMS) {
    it('writes the norms the corpus links (record_links.py asks the API for their addresses)', () => {
      const norms = new Map<string, LinkNorm>();
      for (const { rows } of runs) for (const norm of normsToAsk(rows, confirmAll(rows))) norms.set(JSON.stringify(norm), norm);
      writeFileSync(process.env.RECORD_NORMS!, JSON.stringify([...norms.values()], null, 1));
      expect(norms.size).toBeGreaterThan(0);
    });
    return;
  }

  const ask = async (norms: LinkNorm[]) => {
    const answers = new Map<string, LinkAnswer>();
    const unanswered: string[] = [];
    for (const norm of norms) {
      const key = normKey(norm);
      if (recorded.answers[key]) answers.set(key, recorded.answers[key]);
      else unanswered.push(key);
    }
    return { answers, unanswered };
  };

  it('has every address it needs recorded', async () => {
    const missing: string[] = [];
    for (const { rows } of runs) {
      const ready = await prepareLinks(rows, { choices: confirmAll(rows), ask });
      missing.push(...ready.links.flatMap((l) => (!l.linked && l.reason === 'unanswered' ? [l.key!] : [])));
    }
    expect(missing, 'record again: corpus/record_links.py').toEqual([]);
  });

  it('writes no wrong link, links no row to complete, and waits for a confirmation on an inherited row', async () => {
    let linked = 0;
    let waiting = 0;
    const byReason: Record<string, number> = {};
    const wrong: string[] = [];
    for (const { doc, rows } of runs) {
      const asIs = await prepareLinks(rows, { ask });
      waiting += asIs.summary.byReason.needs_confirmation ?? 0;
      expect(asIs.links.filter((l, i) => l.linked && rows[i].state === 'inherited')).toEqual([]);

      const ready = await prepareLinks(rows, { choices: confirmAll(rows), ask });
      linked += ready.summary.linked;
      for (const [reason, count] of Object.entries(ready.summary.byReason)) byReason[reason] = (byReason[reason] ?? 0) + (count ?? 0);
      ready.links.forEach((link, i) => {
        if (!link.linked) return;
        const row = rows[i];
        expect(row.state).not.toBe('incomplete');
        const mark = doc.expected.find((e) => overlaps(e, row) && e.flag !== 'out' && e.articles.some((a) => sameArticle(a, row.article)));
        const right = mark && actKey(mark.act_type, mark.act_number, mark.date) === actKey(row.act?.act_type, row.act?.act_number, row.act?.date);
        // The address names the act and the article the corpus marks: Normattiva by its URN (number, year, «~art»
        // and nothing after the number but the version), EUR-Lex by the act's year and number.
        const href = link.href.toLowerCase();
        const article = link.norm.article.replace(/-/g, '').toLowerCase();
        const number = mark?.act_number ?? '';
        const year = (mark?.date ?? '').slice(0, 4);
        const opens = /eur-lex\.europa\.eu/.test(href)
          ? Boolean(number && year) && (href.includes(`/${year}/${number}/`) || href.includes(`${year}r${number.padStart(4, '0')}`) || href.includes(`${year}l${number.padStart(4, '0')}`))
          : new RegExp(`~art${article}(?=[!@]|$)`).test(href) && (!number || (href.includes(`;${number}`) && href.includes(`:${year}-`)));
        if (!right || !opens) wrong.push(`${doc.name}: «${doc.text.slice(row.start, row.end)}» → ${link.href}`);
      });
    }
    console.log(`links: ${linked} written, ${waiting} waiting for a confirmation as they are; no link: ${JSON.stringify(byReason)}`);
    expect(wrong).toEqual([]);
    expect(linked).toBeGreaterThan(60);
  });

  it('builds the paste of every document: the text whole, one <p> a line, an <a> for each link', async () => {
    for (const { doc, rows } of runs) {
      const ready = await prepareLinks(rows, { choices: confirmAll(rows), ask });
      const links = documentLinks(doc.text, rows, ready.links);
      const paste = buildLinkedPaste(doc.text, links);
      expect(paste.links).toBe(links.length);
      expect((paste.html.match(/<a href=/g) ?? []).length).toBe(links.length);
      expect((paste.html.match(/<p>/g) ?? []).length).toBe(doc.text.split('\n').length);
      // The words are the document's: taking the tags and the addresses out gives the text back.
      const words = new DOMParser().parseFromString(paste.html.replace(/<\/p><p>/g, '\n'), 'text/html').body.textContent;
      expect(words).toBe(doc.text);
      let plain = paste.plain;
      for (const link of links) plain = plain.replace(` (${link.href})`, '');
      expect(plain).toBe(doc.text);
    }
  });
});
