import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CustomAlias } from '../../../../types';
import type { ParsedCitation } from '../../../../utils/citationParser';
import type { ServerNormReading } from '../../../../utils/normQuery';
import {
  MAX_QUERY_LENGTH, analyseDocument, buildVocabulary, candidateQueries, findCandidates, listedMatches, readOnClient,
  settleCitations, settledByServer, type Candidate,
} from '../documentCandidates';

// The rules of design 2026-10-29-document-analysis §4.3–§4.7 one by one; documentCorpus.test.ts measures them whole.
const recorded = JSON.parse(readFileSync(join(__dirname, 'corpus', 'server.json'), 'utf8')) as {
  act_names: string[];
  answers: Record<string, ServerNormReading>;
};
const vocabulary = buildVocabulary(recorded.act_names);
const candidates = (text: string) => findCandidates(text, vocabulary);
const only = (text: string): Candidate => {
  const found = candidates(text);
  expect(found, JSON.stringify(found)).toHaveLength(1);
  return found[0];
};
const slice = (text: string, span: { start: number; end: number }) => text.slice(span.start, span.end);

const alias = (trigger: string, searchParams?: CustomAlias['searchParams']): CustomAlias => ({
  id: trigger, trigger, type: searchParams ? 'reference' : 'shortcut', expandTo: trigger, searchParams,
  createdAt: '2026-10-31', usageCount: 0,
});

/** The readings as the page settles them: the client's, then the recorded server's for the rest. */
function settle(text: string, unanswered: string[] = []) {
  const found = candidates(text);
  const client = readOnClient(found);
  const answers = new Map(Object.entries(recorded.answers).filter(([q]) => !unanswered.includes(q)));
  const settled = new Map([...settledByServer(found, answers), ...client]);
  return settleCitations(text, found, { settled, unanswered: new Set(unanswered) });
}

const civil = { act_type: 'codice civile' };

/**
 * As `settle`, with the readings of some acts given by hand (`acts`: the act as written → its reading, with the types
 * of the server's tables, `visualex_api/tools/map.py`): a query that names one of them settles to it.
 */
function settleWith(text: string, acts: Record<string, Partial<ParsedCitation>>) {
  const found = candidates(text);
  const client = readOnClient(found);
  const settled = new Map([...settledByServer(found, new Map(Object.entries(recorded.answers))), ...client]);
  for (const candidate of found) {
    if (!candidate.query || settled.has(candidate.query)) continue;
    const act = Object.entries(acts).find(([written]) => candidate.actPhrase?.toLowerCase() === written.toLowerCase());
    if (act) settled.set(candidate.query, act[1] as ParsedCitation);
  }
  return settleCitations(text, found, { settled, unanswered: new Set() });
}

describe('the vocabulary (§4.2)', () => {
  it('holds the server’s names, longest first, folded', () => {
    expect(vocabulary.fromServer).toBe(true);
    expect(vocabulary.names).toContain('statuto dei lavoratori');
    expect(vocabulary.names).toContain('gdpr');
    expect(vocabulary.names.indexOf('codice civile')).toBeLessThan(vocabulary.names.indexOf('c.c.'));
  });

  it('falls back on the client’s own names when the server did not answer', () => {
    const local = buildVocabulary(null);
    expect(local.fromServer).toBe(false);
    expect(local.names).toContain('c.c.');
    expect(local.names).toContain('codice del consumo');
    expect(local.names).not.toContain('legge');
  });

  it('adds the triggers of the user’s aliases that name an act, as the search reads them', () => {
    const own = buildVocabulary([], [
      alias('mia-norma', { act_type: 'legge', act_number: '7', date: '2020' }),
      alias('incompleta', { act_type: 'legge' }),
      { ...alias('lg'), expandTo: 'legge' },
    ]);
    expect(own.names).toEqual(['mia-norma']);
    expect(findCandidates('art. 3 mia-norma', own)[0]).toMatchObject({ kind: 'article-act', query: 'art. 3 mia-norma' });
  });

  it('reads a name with a dot followed by a space or not, and the apostrophe either way', () => {
    expect(only('art. 1337 cod. civ.').query).toBe('art. 1337 cod. civ.');
    expect(only('art. 2 c. c.').query).toBe('art. 2 c.c.');
    expect(only('art. 82 GDPR').query).toBe('art. 82 GDPR');
  });

  it('sends a name in the vocabulary’s spelling, which the server’s tables know (§4.8: «St.lav.», «cod.civ.»)', () => {
    expect(only('art. 4 St.lav.').query).toBe('art. 4 st. lav.');
    expect(only('art. 1337 cod.civ.').query).toBe('art. 1337 cod. civ.');
  });

  it('reads a user’s shortcut and sends what it expands to, as the store resolves it', () => {
    const shortcut = { ...alias('cdc'), expandTo: 'codice del consumo' };
    const numbered = { ...alias('lg'), expandTo: 'legge' };
    const own = buildVocabulary(recorded.act_names, [shortcut, numbered]);
    expect(own.names).toContain('cdc');
    expect(own.names).not.toContain('lg');
    expect(findCandidates('art. 33 cdc', own)[0]).toMatchObject({ kind: 'article-act', query: 'art. 33 codice del consumo' });
  });
});

describe('candidates (§4.3)', () => {
  it('«article, then act»: the list and the act phrase, the preposition and the clause left out of the query', () => {
    const text = 'Vedi gli artt. 7 e 8 della legge 7 agosto 1990, n. 241, sul procedimento.';
    const c = only(text);
    expect(c.kind).toBe('article-act');
    expect(c.query).toBe('art. 7 e 8 legge 7 agosto 1990, n. 241');
    expect(slice(text, c)).toBe('artt. 7 e 8 della legge 7 agosto 1990, n. 241');
    expect(c.articles.map((a) => [a.article, slice(text, a)])).toEqual([['7', '7'], ['8', '8']]);
  });

  it('«act, then article»: «d.lgs. 196/2003, art. 7», «la legge 241/1990 art. 3»', () => {
    expect(only('il d.lgs. 196/2003, art. 7, comma 2').query).toBe('art. 7 d.lgs. 196/2003');
    expect(only('la legge 241/1990 art. 3 impone').query).toBe('art. 3 legge 241/1990');
    expect(only('Regolamento (UE) 2016/679, art. 9').query).toBe('art. 9 Regolamento (UE) 2016/679');
    expect(only('codice civile, art. 1337').query).toBe('art. 1337 codice civile');
  });

  it('«act alone», as context only when numbered, of the Union, or a name opening with an act word', () => {
    for (const act of ['d.lgs. 81/2008', 'Regolamento (UE) 2016/679', 'Codice privacy', 'statuto dei lavoratori', 'legge 20 maggio 1970, n. 300']) {
      expect(only(`Si applica ${act} al caso.`)).toMatchObject({ kind: 'act', query: act });
    }
    // An acronym alone, a subject, a heading are words of a brief.
    for (const text of ['(di seguito, GDPR)', 'La CTU ha accertato', 'CAP 00100', 'il TUA non rileva', 'in materia di smart working', 'COSTITUZIONE IN GIUDIZIO']) {
      expect(candidates(text), text).toEqual([]);
    }
  });

  it('every number form of a numbered act', () => {
    for (const act of ['l. 241/1990', 'l. n. 241/90', 'l. n. 300 del 1970', 'legge n. 241 del 7 agosto 1990', 'legge 7 agosto 1990, n. 241',
      'd.P.R. 7/8/1990, n. 5', 'D.Lgs. 1° settembre 1993, n. 385', 'd.l. 18/2020', 'decreto-legge 17 marzo 2020, n. 18', 'r.d. 262/1942', 'DPR 445/2000']) {
      expect(only(`art. 3 ${act}`).query, act).toBe(`art. 3 ${act}`);
    }
    // A date is not a number and a year.
    expect(only('art. 3 l. 12/10/2020, n. 3').query).toBe('art. 3 l. 12/10/2020, n. 3');
  });

  it('«bare article»: never sent', () => {
    const text = "e l'art. 21-octies, comma 2, si applica";
    const c = only(text);
    expect(c).toMatchObject({ kind: 'bare', query: null, articles: [{ article: '21-octies' }] });
    expect(slice(text, c)).toBe('art. 21-octies, comma 2');
  });

  it('reads the clauses a brief writes, and keeps every one out of the query', () => {
    expect(only('art. 1453, comma 1, c.c.').query).toBe('art. 1453 c.c.');
    expect(only('art. 4, n. 7, GDPR').query).toBe('art. 4 GDPR');
    expect(only('art. 4 n 7 gdpr').query).toBe('art. 4 gdpr');
    expect(only('art. 82, par. 1, GDPR').query).toBe('art. 82 GDPR');
    expect(only('art. 82 par 1 GDPR').query).toBe('art. 82 GDPR');
    expect(only('art. 5, par. 1, lett. c) ed e), GDPR').query).toBe('art. 5 GDPR');
    expect(only('art. 6, paragrafo 1, lettera f), del GDPR').query).toBe('art. 6 GDPR');
    expect(only('art. 360, primo comma, n. 3, c.p.c.').query).toBe('art. 360 c.p.c.');
    expect(only('art. 3, commi 1 e 2, c.c.').query).toBe('art. 3 c.c.');
  });

  it('reads a comma written with «°» or with its ordinal after it, never as an article of a list', () => {
    for (const text of ['art. 2697, comma primo, c.c.', 'art. 2697, 1° comma, c.c.', 'art. 2697, comma 1°, c.c.', 'art. 2697 primo comma c.c.', 'art. 2697, 2° co., c.c.']) {
      const c = only(text);
      expect(c.query, text).toBe('art. 2697 c.c.');
      expect(c.articles.map((a) => a.article), text).toEqual(['2697']);
    }
  });

  it('a bare article with an act a few words on is that act’s, not another’s by inheritance', () => {
    const text = 'Vista la l. 241/1990, l’art. 18, ottavo e nono comma, della legge 20 maggio 1970, n. 300 si applica.';
    const { citations } = settle(text);
    const art18 = citations.find((c) => c.article === '18');
    expect(art18).toMatchObject({ state: 'incomplete', followedBy: 'legge 20 maggio 1970, n. 300' });
  });

  it('never joins an article to an act at the head of the next line (a paragraph is a line)', () => {
    const found = candidates('si applica l’art. 5\nCodice civile e prassi');
    expect(found.map((c) => c.kind)).toEqual(['bare', 'act']);
  });

  it('reads the heads and numbers a brief writes', () => {
    expect(only('art 2043 c.c.').query).toBe('art. 2043 c.c.');
    expect(only('art.2043 c.c.').query).toBe('art. 2043 c.c.');
    expect(only('articolo 9 GDPR').query).toBe('art. 9 GDPR');
    expect(only('art. 615 ter c.p.').articles[0].article).toBe('615-ter');
    expect(only('art. 615ter c.p.').articles[0].article).toBe('615-ter');
    expect(only('art. 2-ter d.lgs. 196/2003').articles[0].article).toBe('2-ter');
    // Not an article: a word, a longer number.
    expect(candidates('l’artista e l’art 15x')).toEqual([]);
    expect(candidates('Arte, articolazione, arto.')).toEqual([]);
  });

  it('a range is one article, «e ss.» marks its first article', () => {
    expect(only('artt. 1362-1371 c.c.').articles.map((a) => a.article)).toEqual(['1362-1371']);
    const following = only('artt. 167 e ss. del Codice privacy');
    expect(following.query).toBe('art. 167 Codice privacy');
    expect(following.articles).toMatchObject([{ article: '167', following: true }]);
  });

  it('a name is not read inside a longer one («c.c» in «c.c.i.»)', () => {
    expect(candidates('art. 5 c.c.i.i.').every((c) => c.query !== 'art. 5 c.c')).toBe(true);
  });

  it('a bare article followed by something else is marked so, «del medesimo decreto» is not', () => {
    expect(only('l’art. 7 del contratto prevede').followedBy).toBe('del contratto');
    expect(only('l’articolo 12 delle condizioni generali').followedBy).toBe('delle condizioni');
    expect(only("l'art. 5 dell'accordo individuale").followedBy).toBe("dell'accordo");
    expect(only('art. 13 del Regolamento.').followedBy).toBe('del Regolamento');
    expect(only('art. 4, comma 1, St. lavoratori').followedBy).toBe('St.');
    const same = only('l’art. 13 del medesimo decreto');
    expect(same.backReference).toEqual({ kind: 'decree' });
    expect(same.followedBy).toBeUndefined();
  });

  it('reads the words that tie a bare article to an act named before (G-402)', () => {
    const reference = (text: string) => only(text).backReference;
    expect(reference('l’art. 13 della medesima legge')).toEqual({ kind: 'law' });
    // A sentence's full stop, then the next paragraph's number: still «della medesima legge».
    expect(reference('l’art. 21-octies, comma 2, della medesima legge.\n\n7. Il provvedimento')).toEqual({ kind: 'law' });
    expect(reference('l’art. 21-octies della medesima legge. 7 giorni dopo')).toEqual({ kind: 'law' });
    expect(reference('l’art. 13 dello stesso decreto legislativo')).toEqual({ kind: 'legislative decree' });
    expect(reference('l’art. 81, comma 18, del citato decreto-legge')).toEqual({ kind: 'decree-law' });
    expect(reference('l’art. 82 Reg. cit. e')).toEqual({ kind: 'regulation' });
    expect(reference('l’art. 4 della legge cit., che')).toEqual({ kind: 'law' });
    expect(reference('l’art. 4 d.lgs. ult. cit.')).toEqual({ kind: 'legislative decree' });
    expect(reference('l’art. 13 del medesimo provvedimento')).toEqual({ kind: 'any' });
    expect(reference('l’art. 13 del predetto, che')).toEqual({ kind: 'any' });
    expect(reference('l’art. 13 del cit. d.P.R., che')).toEqual({ kind: 'presidential decree' });
    expect(reference('l’art. 4 cit.')).toEqual({ kind: 'any', sameArticle: true });
    expect(reference('anticipazione (ivi, art. 30), come')).toEqual({ kind: 'any' });
    expect(reference('l’art. 18 cit. prevede')).toEqual({ kind: 'any', sameArticle: true });
    expect(reference('il quinto comma dello stesso art. 18 prevede')).toEqual({ kind: 'any', sameArticle: true });
    expect(reference('il citato art. 81, commi 16 e 17, prevede')).toEqual({ kind: 'any', sameArticle: true });
  });

  it('a noun is read whole: a long name with a number of its own is never cut back to «decreto» (review of G-402)', () => {
    for (const tail of [
      'del citato decreto legislativo 30 giugno 2003, n. 196 prevede',
      'del citato decreto legislativo n. 196/2003 prevede',
      'del citato decreto-legge n. 18/2020 prevede',
      'del medesimo decreto del Presidente della Repubblica n. 115 prevede',
      'del medesimo testo unico n. 115 prevede',
      'della stessa legge costituzionale n. 1 prevede',
    ]) {
      const text = `Visto il d.lgs. 81/2008.\nL’art. 93 ${tail}.`;
      const bare = candidates(text).find((c) => c.kind === 'bare');
      expect(bare?.backReference, tail).toBeUndefined();
      expect(settle(text).citations.find((c) => c.article === '93')?.state, tail).not.toBe('inherited');
    }
  });

  it('the words before an article never win over something else after it (review of G-402)', () => {
    for (const text of [
      'L’art. 2 c.c. si applica. Il citato art. 2 del contratto prevede.',
      'L’art. 30 c.c. (ivi, art. 30 del regolamento condominiale).',
    ]) {
      const { citations } = settle(text);
      expect(citations.at(-1), text).toMatchObject({ state: 'incomplete' });
      expect(citations.at(-1)?.followedBy, text).toBeDefined();
    }
  });

  it('«l’art. 13 citato», «stesso», «predetto» with no preposition are the article cited before (review of G-402)', () => {
    for (const word of ['citato', 'stesso', 'predetto']) {
      expect(only(`l’art. 13 ${word}, al comma 2, impone`).backReference, word).toEqual({ kind: 'any', sameArticle: true });
      const { citations } = settle(`L’art. 13 l. 300/1970.\nL’art. 5 d.lgs. 28/2010.\nL’art. 13 ${word}, al comma 2, impone.`);
      expect(citations.at(-1), word).toMatchObject({ state: 'inherited', act: { act_type: 'legge', act_number: '300' } });
    }
  });

  it('no back-reference without those words, nor when they name something else or an act of their own', () => {
    const reference = (text: string) => only(text).backReference;
    expect(reference('l’art. 18 impone obblighi')).toBeUndefined();
    expect(reference('l’art. 13 del Regolamento.')).toBeUndefined();
    expect(reference('ivi compreso l’art. 5, che')).toBeUndefined();
    expect(only('l’art. 13 del medesimo contratto').followedBy).toBe('del medesimo');
    expect(reference('l’art. 13 della stessa legge regionale')).toBeUndefined();
    // «del citato d.lgs. n. 196/2003»: an act of its own, with its number — never the last decree by inheritance.
    expect(candidates('l’art. 93 del citato d.lgs. n. 196/2003')[0].backReference).toBeUndefined();
  });

  it('an act before an article that goes on with «del <word>» is not its act (§4.3)', () => {
    const found = candidates('Come rilevato dalla CTU, art. 3 della relazione, il danno');
    expect(found).toMatchObject([{ kind: 'bare', followedBy: 'della relazione' }]);
    const constitution = candidates('quanto alla costituzione, art. 5 del contratto di consulenza');
    expect(constitution).toMatchObject([{ kind: 'bare', followedBy: 'del contratto' }]);
  });

  it('caps a query at 200 characters', () => {
    const list = Array.from({ length: 50 }, (_, i) => String(1000 + i)).join(', ');
    const found = candidates(`artt. ${list} c.c.`);
    expect(found.every((c) => !c.query || c.query.length <= MAX_QUERY_LENGTH)).toBe(true);
    expect(found[0].kind).toBe('bare');
  });

  it('lists the distinct query strings once, in the order of the text', () => {
    const found = candidates('art. 2043 c.c. e art. 82 GDPR; poi ancora art. 2043 c.c.');
    expect(candidateQueries(found)).toEqual(['art. 2043 c.c.', 'art. 82 GDPR']);
  });
});

describe('resolution (§4.4)', () => {
  it('the client settles what it can make searchable; the rest is the server’s', () => {
    const found = candidates('art. 2043 c.c. e art. 82 GDPR');
    const client = readOnClient(found);
    expect([...client.keys()]).toEqual(['art. 2043 c.c.']);
    expect(readOnClient(found, [alias('gdpr', { act_type: 'Regolamento UE', act_number: '679', date: '2016' })]).has('art. 82 GDPR')).toBe(true);
  });

  it('an act alone is settled when it identifies the act, with no article', () => {
    const found = candidates('Si applica la legge 7 agosto 1990, n. 241.');
    expect(readOnClient(found).get('legge 7 agosto 1990, n. 241')).toMatchObject({ act_type: 'legge', act_number: '241' });
  });

  it('a server reading that names no act does not settle («art. 2 d.m.»)', () => {
    const found = candidates('art. 2 d.m. 5/2020');
    const reading = { recognized: true, parsed: { act_type: 'decreto ministeriale', article: '2' } };
    expect(settledByServer(found, new Map([[found[0].query!, reading]])).size).toBe(0);
  });
});

describe('the rows (§4.5–§4.7)', () => {
  it('a comma with «°» or an ordinal never leaves a wrong inherited article (review of PR 2)', () => {
    for (const text of [
      "art. 7 l. 241/1990 e dell'art. 2697, comma primo, c.c.",
      'art. 7 l. 241/1990 e art. 2697, 1° comma, c.c.',
      'art. 7 l. 241/1990 e art. 2697, comma 1°, c.c.',
    ]) {
      const { citations } = settle(text);
      expect(citations.map((c) => [c.article, c.state, c.act?.act_type]), text).toEqual([
        ['7', 'resolved', 'legge'], ['2697', 'resolved', 'codice civile'],
      ]);
    }
  });

  it('a list makes one row per article: the first with the head, the last with the act', () => {
    const text = 'Gli artt. 1223 e 1225 c.c. limitano il danno.';
    const { citations } = settle(text);
    expect(citations.map((c) => [slice(text, c), c.article, c.state])).toEqual([
      ['artt. 1223', '1223', 'resolved'],
      ['1225 c.c.', '1225', 'resolved'],
    ]);
    expect(citations[0].act).toMatchObject(civil);
  });

  it('a bare article with no words tying it to an act is to complete, even in the act’s paragraph (G-402)', () => {
    expect(settle('Visto il d.lgs. 81/2008, l’art. 18 impone obblighi.').citations)
      .toMatchObject([{ article: '18', state: 'incomplete' }]);
    expect(settle('Visto il d.lgs. 81/2008.\nL’art. 18 impone obblighi.').citations[0].state).toBe('incomplete');
  });

  it('«del medesimo decreto» inherits, «dal contesto», in its paragraph and across paragraphs', () => {
    for (const text of [
      'Visto il d.lgs. 81/2008, l’art. 18 del medesimo decreto impone obblighi.',
      'Visto il d.lgs. 81/2008.\nL’art. 18 del medesimo decreto impone obblighi.',
    ]) {
      expect(settle(text).citations[0], text)
        .toMatchObject({ state: 'inherited', act: { act_type: 'decreto legislativo', act_number: '81', date: '2008' } });
    }
  });

  it('the words choose the act: the last of the kind they name, the last cited with the same article', () => {
    const kinds = settle('Ai sensi dell’art. 81 d.l. 112/2008 e dell’art. 53 Cost., e dell’art. 82 del citato decreto-legge.');
    expect(kinds.citations.map((c) => [c.article, c.state, c.act?.act_type])).toEqual([
      ['81', 'resolved', 'decreto legge'], ['53', 'resolved', 'costituzione'], ['82', 'inherited', 'decreto legge'],
    ]);
    const article = settle('L’art. 18 l. 300/1970 e l’art. 1 d.lgs. 23/2015.\nIl quinto comma dello stesso art. 18 prevede.');
    expect(article.citations[2]).toMatchObject({ article: '18', state: 'inherited', act: { act_type: 'legge', act_number: '300' } });
    // A kind no act read before fits: to complete, never the last act of another kind.
    expect(settle('L’art. 53 Cost.; l’art. 5 della medesima legge.').citations[1].state).toBe('incomplete');
    expect(settle('L’art. 53 Cost. e l’art. 4 cit.').citations[1].state).toBe('incomplete');
    // «del citato decreto-legge» with only the Costituzione read before: never the Costituzione (blind corpus, 10/2015).
    expect(settle('Viola l’art. 53 Cost.\nIl divieto dell’art. 81, comma 18, del citato decreto-legge.').citations[1])
      .toMatchObject({ article: '81', state: 'incomplete' });
    // «del medesimo codice» takes a code, never the law read after it.
    expect(settle('L’art. 1453 c.c. e l’art. 3 l. 241/1990; l’art. 1455 del medesimo codice.').citations[2])
      .toMatchObject({ article: '1455', state: 'inherited', act: { act_type: 'codice civile' } });
  });

  it('an act fits a kind by its own words too, and the search never passes over a named act (review of G-402)', () => {
    // The «l. fall.» is a regio decreto to the server, a law in the text.
    const lFall = { 'l. fall.': { act_type: 'regio decreto', act_number: '267', date: '1942-03-16' } };
    const fall = settleWith('L’art. 7 l. 241/1990.\nL’art. 67 l. fall.; l’art. 69 della stessa legge.', lFall);
    expect(fall.citations.at(-1)).toMatchObject({ article: '69', state: 'inherited', act: { act_type: 'regio decreto', act_number: '267' } });
    // Two laws in the paragraph: «della stessa legge» could be either.
    expect(settleWith('L’art. 7 l. 241/1990; l’art. 67 l. fall.; l’art. 69 della stessa legge.', lFall).citations.at(-1))
      .toMatchObject({ article: '69', state: 'incomplete' });
    // The new code of public contracts is a legislative decree to the server, a code in the text.
    const appalti = settleWith('L’art. 2043 c.c.\nL’art. 3 nuovo codice appalti; l’art. 5 del medesimo codice.', {
      'nuovo codice appalti': { act_type: 'decreto legislativo', act_number: '36', date: '2023-03-31' },
    });
    expect(appalti.citations.at(-1)).toMatchObject({ article: '5', state: 'inherited', act: { act_number: '36' } });
    // The Codice privacy is a legislative decree under a name: «del medesimo decreto legislativo» could be it.
    const privacy = settle('L’art. 5 d.lgs. 81/2008; l’art. 13 Codice privacy; l’art. 2-ter del medesimo decreto legislativo.');
    expect(privacy.citations.at(-1)).toMatchObject({ article: '2-ter', state: 'incomplete' });
    // A name whose words say no kind, which the server reads with a number («jobs act», «tusl»): never passed over.
    for (const [name, reading] of [
      ['jobs act', { act_type: 'decreto legislativo', act_number: '23', date: '2015-03-04' }],
      ['tusl', { act_type: 'decreto legislativo', act_number: '81', date: '2008-04-09' }],
    ] as const) {
      const text = `L’art. 7 l. 241/1990.\nL’art. 3 ${name}; l’art. 4 della medesima legge.`;
      expect(settleWith(text, { [name]: reading }).citations.at(-1), name).toMatchObject({ article: '4', state: 'incomplete' });
    }
  });

  it('the word of the kind written in passing between the act and the article: it may be that one (review of G-402)', () => {
    for (const text of [
      'L’art. 82 GDPR. Il regolamento condominiale, all’art. 5 del medesimo regolamento, vieta.',
      'L’art. 2043 c.c. Il codice etico, all’art. 5 del medesimo codice, vieta.',
      // Abbreviated too.
      'Vista la l. 241/1990.\nLa l.r. Lombardia 12/2005, all’art. 5 della medesima legge, prevede.',
      'Vista la l. 241/1990.\nLa l. reg. Lombardia n. 12, all’art. 5 della stessa legge, prevede.',
      'L’art. 82 GDPR.\nIl reg. condominiale, all’art. 5 del medesimo regolamento, vieta.',
      'L’art. 82 GDPR.\nIl Reg. di condominio, all’art. 5 del Reg. cit., vieta.',
      'L’art. 2043 c.c.\nIl cod. etico, all’art. 5 del medesimo codice, vieta.',
    ]) {
      expect(settle(text).citations.at(-1), text).toMatchObject({ article: '5', state: 'incomplete' });
    }
    // A word inside a citation is that citation's: «l’art. 13 del Regolamento (UE) 2016/679» does not stop the next.
    expect(settle('L’art. 13 del Regolamento (UE) 2016/679.\nL’art. 15 del medesimo regolamento.').citations.at(-1))
      .toMatchObject({ state: 'inherited', act: { act_number: '679' } });
  });

  it('a chain of back-references: each inherits, its own words never stop the next (review of G-402)', () => {
    const { citations } = settle('Vista la l. 241/1990.\nL’art. 6 della medesima legge; l’art. 7 della stessa legge.');
    expect(citations.map((c) => [c.article, c.state, c.act?.act_number])).toEqual([
      ['6', 'inherited', '241'], ['7', 'inherited', '241'],
    ]);
  });

  it('«ivi» and «medesimo» with no kind take the last act read', () => {
    const { citations } = settle('Il contributo dell’art. 13 del d.P.R. 30 maggio 2002, n. 115 e l’anticipazione (ivi, art. 30).');
    expect(citations[1]).toMatchObject({ article: '30', state: 'inherited', act: { act_number: '115' } });
  });

  it('two acts of the kind in the paragraph of the one found: the words could mean either, to complete', () => {
    const text = 'L’art. 5 del d.lgs. 4 marzo 2010, n. 28, come modificato dal d.lgs. 10 ottobre 2022, n. 149, prevede la '
      + 'mediazione.\nSi chieda che il Tribunale ne tenga conto ai sensi dell’art. 12-bis del medesimo decreto.';
    expect(settle(text).citations.at(-1)).toMatchObject({ article: '12-bis', state: 'incomplete' });
    // The same act twice in the paragraph is no doubt.
    expect(settle('L’art. 5 d.lgs. 28/2010 e l’art. 6 d.lgs. 28/2010.\nL’art. 7 del medesimo decreto.').citations.at(-1))
      .toMatchObject({ state: 'inherited', act: { act_number: '28' } });
  });

  it('never a bare article followed by something else, which also ends the context', () => {
    const text = 'Ai sensi dell’art. 1453 c.c. e dell’art. 7 del contratto, nonché dell’art. 8 del medesimo codice, il recesso è valido.';
    const { citations } = settle(text);
    expect(citations.map((c) => [c.article, c.state, c.followedBy])).toEqual([
      ['1453', 'resolved', undefined],
      ['7', 'incomplete', 'del contratto'],
      ['8', 'incomplete', undefined],
    ]);
  });

  it('a candidate the page cannot read ends the context: the next bare article is to complete', () => {
    const text = 'Visto l’art. 5 l. 241/1990 e l’art. 6 d.m. 5/2020, l’art. 7 della medesima legge si applica.';
    const { citations } = settle(text);
    expect(citations.map((c) => [c.article, c.state])).toEqual([['5', 'resolved'], ['6', 'incomplete'], ['7', 'incomplete']]);
    expect(citations[1].query).toBe('art. 6 d.m. 5/2020');
    // «T.U.E.» names two acts (Q9): not in the vocabulary, so a bare article followed by it, to complete.
    expect(settle('art. 6 T.U.E.').citations).toMatchObject([{ article: '6', state: 'incomplete', followedBy: 'T.U.E.' }]);
  });

  it('falls back on today’s matcher inside a candidate the server did not answer, and says so (§4.7)', () => {
    const text = 'Rileva l’art. 4 della legge 20 maggio 1970, n. 300 e l’art. 82 GDPR; l’art. 5 pure.';
    const unanswered = ['art. 82 GDPR'];
    const analysis = settle(text, unanswered);
    expect(analysis.degraded).toBe(true);
    // «art. 82 GDPR»: the matcher knows no alias, so it is to complete; nothing is listed twice.
    expect(analysis.citations.map((c) => [c.article, c.state, c.fallback ?? false])).toEqual([
      ['4', 'resolved', false], ['82', 'incomplete', false], ['5', 'incomplete', false],
    ]);
    // A candidate left unanswered keeps the matcher's matches inside it; the bare article after it is to complete.
    const kept = 'Si veda l’art. 7 del d.lgs. 196/2003; l’art. 8 pure.';
    const found = candidates(kept);
    const fallen = settleCitations(kept, found, { settled: new Map(), unanswered: new Set(['art. 7 d.lgs. 196/2003']) });
    expect(fallen.citations).toMatchObject([
      { article: '7', state: 'resolved', fallback: true, act: { act_type: 'decreto legislativo', act_number: '196', date: '2003' } },
      { article: '8', state: 'incomplete' },
    ]);
  });

  it('lists the resolved and the inherited rows in the matcher’s shape, «e ss.» and the annex with them', () => {
    const text = 'Gli artt. 167 e ss. del Codice privacy; l’art. 5 del contratto.';
    const analysis = settle(text);
    const listed = listedMatches(text, analysis.citations);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ startIndex: text.indexOf('artt.'), parsed: { article: '167', following: true } });
    const annexed = listedMatches('x', [{ start: 0, end: 1, article: '3', state: 'resolved', act: { act_type: 'codice del processo amministrativo', annex: '3' } }]);
    expect(annexed[0].parsed.annex).toBe('3');
  });
});

describe('analyseDocument', () => {
  const ask = (answers: Record<string, ServerNormReading> = recorded.answers) => vi.fn(async (queries: string[]) => ({
    answers: new Map(queries.flatMap((q) => (answers[q] ? [[q, answers[q]] as const] : []))),
    unanswered: queries.filter((q) => !answers[q]),
  }));

  it('asks the server only for the query strings the client cannot settle — never the text around them', async () => {
    const text = 'Il datore, ai sensi dell’art. 2087 c.c. e dell’art. 82 GDPR, risponde; il dipendente Mario Rossi lo sa.';
    const asked = ask();
    const run = await analyseDocument(text, { serverNames: recorded.act_names, ask: asked });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0][0]).toEqual(['art. 82 GDPR']);
    expect(run.analysis.citations.map((c) => [c.article, c.act?.act_type.toLowerCase()])).toEqual([['2087', 'codice civile'], ['82', 'regolamento ue']]);
    expect(run.analysis.degraded).toBe(false);
  });

  it('asks nothing when the client settles everything, and nothing again for what the server answered', async () => {
    const asked = ask();
    await analyseDocument('art. 2043 c.c.', { serverNames: recorded.act_names, ask: asked });
    expect(asked).not.toHaveBeenCalled();
    const known = new Map([['art. 82 GDPR', recorded.answers['art. 82 GDPR']]]);
    await analyseDocument('art. 82 GDPR', { serverNames: recorded.act_names, known, ask: asked });
    expect(asked).not.toHaveBeenCalled();
  });

  it('is degraded with the client’s names, and when the server leaves strings unanswered', async () => {
    const local = await analyseDocument('art. 2043 c.c.', { serverNames: null, ask: ask() });
    expect(local.analysis.degraded).toBe(true);
    expect(local.analysis.citations).toMatchObject([{ article: '2043', state: 'resolved' }]);
    const silent = await analyseDocument('art. 82 GDPR', { serverNames: recorded.act_names, ask: ask({}) });
    expect(silent.analysis.degraded).toBe(true);
    expect(silent.analysis.citations).toMatchObject([{ article: '82', state: 'incomplete' }]);
  });

  it('reads with the user’s aliases', async () => {
    const asked = ask({});
    const gdpr = alias('gdpr', { act_type: 'Regolamento UE', act_number: '679', date: '2016' });
    const run = await analyseDocument('art. 82 GDPR', { serverNames: recorded.act_names, customAliases: [gdpr], ask: asked });
    expect(asked).not.toHaveBeenCalled();
    expect(run.analysis.citations[0].act).toMatchObject({ act_type: 'Regolamento UE', act_number: '679' } satisfies Partial<ParsedCitation>);
  });
});

// Documents are long, and a user drops in what they are given: a long run of one character must cost time
// proportional to its length, never its square (as citationMatcher.test.ts holds the matcher).
describe('candidates in linear time', () => {
  const RUN = 100_000;
  const spaces = ' '.repeat(RUN);
  const hostile: Record<string, string> = {
    'spaces after an article': `art. 1${spaces}x legge 99/2015`,
    'spaces after «art.»': `art.${spaces}x`,
    'spaces after a comma': `art. 1,${spaces}x`,
    'spaces after «comma»': `art. 1, comma${spaces}x`,
    'spaces after a letter clause': `art. 1, lett.${spaces}x`,
    'spaces after «e»': `art. 1 e${spaces}x`,
    'spaces after «del»': `art. 1 del${spaces}x`,
    'spaces after a type word': `art. 1 legge${spaces}x`,
    'spaces after a number': `art. 1 legge 7${spaces}agosto`,
    'spaces after a day': `legge 1°${spaces}x`,
    'spaces in a name': `art. 1 codice${spaces}civile`,
    'spaces after a name’s dot': `art. 1 c.${spaces}c`,
    'spaces after a regulation': `art. 1 del regolamento${spaces}x`,
    'spaces in a regulation marker': `regolamento ( ue${spaces}) 2016/679`,
    'new lines after an article': `art. 1${'\n'.repeat(RUN)}x`,
    'commas after an article': `art. 1${','.repeat(RUN)}x`,
    'hyphens after an article': `art. 1${'-'.repeat(RUN)}x`,
    'a list of articles': `artt. 1${' e 2'.repeat(RUN / 4)}x`,
    'a comma list of articles': `art. 1${', 2'.repeat(RUN / 3)}x`,
    'comma clauses': `art. 1${', comma 1'.repeat(RUN / 9)} c.c.`,
    'digits': `art. ${'1'.repeat(RUN)}x`,
    'a number and a year': `legge ${'1'.repeat(RUN)}/${'2'.repeat(RUN)}x`,
    'heads': 'art. '.repeat(RUN / 5),
    'names': 'c.c. '.repeat(RUN / 5),
  };
  for (const [name, text] of Object.entries(hostile)) {
    it(name, () => {
      const start = performance.now();
      const found = findCandidates(text, vocabulary);
      settleCitations(text, found, { settled: readOnClient(found), unanswered: new Set() });
      expect(performance.now() - start).toBeLessThan(1500);
    });
  }

  it('thousands of citations in one text', () => {
    const text = 'art. 2043 c.c. e l’art. 5 del contratto. '.repeat(10_000);
    const start = performance.now();
    const found = findCandidates(text, vocabulary);
    const { citations } = settleCitations(text, found, { settled: readOnClient(found), unanswered: new Set() });
    expect(citations.filter((c) => c.state === 'resolved')).toHaveLength(10_000);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
