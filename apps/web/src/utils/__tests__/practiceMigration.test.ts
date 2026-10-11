import { describe, it, expect } from 'vitest';
import type { ArticleData } from '../../types';
import type { DecisionIdentity } from '../../types/decisions';
import { buildItemKey, uniqueArticleIdFromNorma } from '../normaKeys';
import { versionKey } from '../versionDisplay';
import { decisionKey, formatDecisionShort } from '../decisionLinks';
import { practiceArticleKey, sanitizePractices, type Practice } from '../practice';
import { practiceNoticeText, practicesFromTabs } from '../practiceMigration';
import {
  ALL_SAVED_STATES, CC_BARE, CC_RD, FOUND, L24, UNRESOLVED, article, blankActType, block, decisionTab,
  codeSearchAndIndex, codeTwoBlocks, decisionTabs, emptyTab, forgedCollection, garbage, looseArticles,
  minimisedAndHidden, noneVisible, onlyDecisions, pastTextTab, searchTab, tab, topicTabs, twoTabs,
} from '../__fixtures__/savedWorkspaces';

let seq = 0;
const id = () => `new-${++seq}`;
const migrate = (tabs: unknown) => practicesFromTabs(tabs, id);
const keysOf = (p: Practice) => p.acts.flatMap((a) => a.articles.map((x) => buildItemKey(x.norma_data)));

// Every article a saved state holds, wherever it sits: blocks, loose articles, collections.
function savedArticles(tabs: unknown[]): ArticleData[] {
  return tabs.flatMap((t) => {
    const content = (t as { content?: unknown[] } | null)?.content ?? [];
    return content.flatMap((item) => {
      const i = item as { type?: string; articles?: unknown[]; article?: ArticleData };
      if (i.type === 'norma') return i.articles as ArticleData[];
      if (i.type === 'loose-article') return [i.article as ArticleData];
      if (i.type === 'collection') return (i.articles as { article: ArticleData }[]).map((e) => e.article);
      return [];
    });
  });
}
function savedDecisions(tabs: unknown[]): DecisionIdentity[] {
  return tabs.flatMap((t) => {
    const view = (t as { view?: { kind: string; reference?: DecisionIdentity } }).view;
    return view?.kind === 'decision' && view.reference ? [view.reference] : [];
  });
}

describe('practicesFromTabs', () => {
  it('makes one practice per tab, with its id, label and order; the tab in front is active', () => {
    const r = migrate(twoTabs);
    expect(r.practices.map((p) => [p.id, p.label, p.labelIsCustom])).toEqual([
      ['tab-cc', 'Codice civile', false],
      ['tab-l24', 'Responsabilità medica', true],
    ]);
    expect(r.activePracticeId).toBe('tab-l24');
    expect(r.practices[1].acts[0]).toMatchObject({ id: 'blk-l24', key: 'legge|24|2017-03-08', isCollapsed: false });
    expect(r.practices[1].acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['5', '7']);
    expect(r.practices.every((p) => p.decisions.length === 0 && p.beside.length === 0)).toBe(true);
    expect(r.dropped).toEqual([]);
    expect(r.droppedSearches).toEqual([]);
    expect(Object.keys(r.practices[0]).sort()).toEqual(['acts', 'beside', 'decisions', 'id', 'label', 'labelIsCustom']);
  });

  it('merges two blocks of the codice civile into one act keeping the first id, never two annotation keys into one row', () => {
    const [p] = migrate(codeTwoBlocks).practices;
    expect(p.acts).toHaveLength(1);
    expect(p.acts[0].id).toBe('blk-rd');
    expect(p.acts[0].isCollapsed).toBe(true);
    expect(p.acts[0].norma.urn).toBe(CC_RD.urn);
    expect(keysOf(p)).toEqual([
      buildItemKey(article(CC_BARE, '1218').norma_data),
      buildItemKey(article(CC_RD, '2043', { allegato: '2' }).norma_data),
      buildItemKey(article(CC_BARE, '2043').norma_data),
    ]);
  });

  it('keeps a code article from a search and from the index as two rows, each with its norma_data', () => {
    const saved = savedArticles(codeSearchAndIndex);
    const [p] = migrate(codeSearchAndIndex).practices;
    expect(p.acts).toHaveLength(1);
    expect(p.acts[0].articles).toHaveLength(2);
    expect(p.acts[0].articles.map((a) => a.norma_data)).toEqual(saved.map((a) => a.norma_data));
  });

  it('puts a loose article into its act, or into a new act', () => {
    const [p] = migrate(looseArticles).practices;
    expect(p.acts.map((a) => a.key)).toEqual(['legge|24|2017-03-08', 'codice civile']);
    expect(p.acts[0].id).toBe('blk-l24');
    expect(p.acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['1', '5']);
    expect(p.acts[1].articles.map((a) => uniqueArticleIdFromNorma(a.norma_data))).toEqual(['all2:2043']);
    expect(p.acts[1].norma).toMatchObject({ tipo_atto: 'codice civile', numero_atto: '262' });
  });

  it('puts the articles of a forged collection into their acts', () => {
    const r = migrate(forgedCollection);
    const [p] = r.practices;
    expect(p.acts.map((a) => a.key)).toEqual(['legge|241|1990-08-07', 'codice civile']);
    expect(p.acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['2', '3']);
    expect(p.acts[1].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['1218']);
    expect(r.dropped).toEqual([]);
  });

  it('keeps a past text as a row of its act, keyed with its version', () => {
    const [p] = migrate(pastTextTab).practices;
    const [row] = p.acts[0].articles;
    expect(row.norma_data.data_versione).toBe('2007-12-29');
    expect(row.versionInfo).toEqual({ isHistorical: true, requestedDate: '2007-12-29' });
    expect(practiceArticleKey(row)).toBe(`${buildItemKey(row.norma_data)}|vigente|2007-12-29`);
  });

  it('puts a found and an unresolved decision under «Giurisprudenza» of the front practice, not identified, references unchanged', () => {
    const r = migrate(decisionTabs);
    expect(r.practices.map((p) => p.id)).toEqual(['tab-back', 'tab-front']);
    expect(r.activePracticeId).toBe('tab-front');
    const front = r.practices[1];
    expect(front.decisions).toEqual([
      { id: 'dec-found', reference: FOUND, label: 'Cass. civ., sez. III, n. 28994/2019', identified: false, historyRecordedKey: 'cassazione:civile:28994:2019' },
      { id: 'dec-open', reference: UNRESOLVED, label: 'Cass., sez. un., n. 577/2008', identified: false },
    ]);
    expect(r.practices[0].decisions).toEqual([]);
    expect(front.beside).toEqual([]);
  });

  it('makes one practice «Sentenze» when there is no norm tab', () => {
    const r = migrate(onlyDecisions);
    expect(r.practices).toHaveLength(1);
    expect(r.practices[0]).toMatchObject({ label: 'Sentenze', labelIsCustom: false, acts: [], beside: [] });
    expect(r.practices[0].decisions.map((d) => d.id)).toEqual(['dec-a', 'dec-b']);
    expect(r.activePracticeId).toBe(r.practices[0].id);
  });

  it('keeps one entry when two tabs show one decision, merging what the second held and listing the merge', () => {
    const r = migrate([...onlyDecisions, { ...onlyDecisions[0], id: 'dec-a2', historyRecordedKey: 'cassazione:civile:28994:2019' }]);
    expect(r.practices[0].decisions.map((d) => d.id)).toEqual(['dec-a', 'dec-b']);
    expect(r.practices[0].decisions[0].historyRecordedKey).toBe('cassazione:civile:28994:2019');
    expect(r.dropped).toEqual([expect.stringContaining('dec-a2')]);
  });

  it('reopens the topic search in front as the window of the front practice, and names the other', () => {
    const r = migrate(topicTabs);
    expect(r.practices).toHaveLength(1);
    expect(r.practices[0].beside).toEqual([{
      id: 'search-front', kind: 'decision-search', label: 'Tema: danno da ritardo',
      query: { tema: 'danno da ritardo', norma: { tipo_atto: 'codice civile', numero_articolo: '1223' }, normaLabel: 'art. 1223 c.c.' },
    }]);
    expect(r.droppedSearches).toEqual(['Tema: perdita di chance']);
    expect(r.activePracticeId).toBe('tab-norm');
  });

  it('tells the user which topic searches were not reopened', () => {
    expect(practiceNoticeText([])).toBeNull();
    expect(practiceNoticeText(['Tema: perdita di chance'])).toBe(
      'Una ricerca per tema non è stata riaperta: «Tema: perdita di chance». Puoi rifarla dalla barra di ricerca.');
    expect(practiceNoticeText(['Tema: perdita di chance', 'Tema: danno da ritardo'])).toBe(
      '2 ricerche per tema non sono state riaperte: «Tema: perdita di chance», «Tema: danno da ritardo». Puoi rifarle dalla barra di ricerca.');
  });

  it('keeps an empty tab as an empty practice with its name', () => {
    const r = migrate(emptyTab);
    expect(r.practices).toEqual([{ id: 'tab-empty', label: 'Ricorso Rossi', labelIsCustom: true, acts: [], decisions: [], beside: [] }]);
    expect(r.activePracticeId).toBe('tab-empty');
  });

  it('drops garbage and lists it, never throwing', () => {
    const r = migrate(garbage);
    expect(r.practices.map((p) => p.id)).toEqual(['tab-ok']);
    expect(r.practices[0].acts).toHaveLength(1);
    expect(r.practices[0].acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['1']);
    // null, the string, two tabs without an id, the article and the loose article without
    // norma_data, the unknown item, the block without an act type, the decision numbered -1
    expect(r.dropped).toHaveLength(9);
    expect(r.dropped.every((d) => typeof d === 'string' && d.length > 0)).toBe(true);
    for (const bad of [undefined, null, 'workspaceTabs', 42, {}, [[]], [{ id: 'x', label: 'y', content: 'no' }]]) {
      expect(() => migrate(bad)).not.toThrow();
    }
    expect(migrate(undefined)).toEqual({ practices: [], activePracticeId: null, dropped: [], droppedSearches: [] });
    expect(migrate('workspaceTabs').dropped).toHaveLength(1);
  });

  it('drops, naming the tab, an article whose act type is blank and has no saved source, never throwing', () => {
    let r: ReturnType<typeof migrate> | undefined;
    expect(() => { r = migrate(blankActType); }).not.toThrow();
    expect(r?.practices.map((p) => p.acts.map((a) => a.key))).toEqual([['legge|24|2017-03-08']]);
    // what goes is listed with its tab for the store to log (spec §9, gotcha 18)
    expect(r?.dropped).toEqual([
      'tab "Atto senza tipo", item #1: an extracted article whose act has no type',
      'tab "Atto senza tipo", item #2: entry #0 of a collection names an act without a type',
    ]);
  });

  it('drops an item whose shape no check foresaw, keeps the rest, and names it', () => {
    // JSON never holds a getter; this one stands for any shape no check foresaw
    const odd = { type: 'norma', id: 'blk-odd', get norma(): unknown { throw new Error('boom'); } };
    let r: ReturnType<typeof migrate> | undefined;
    expect(() => { r = migrate([tab('tab-odd', 'Strano', 1, [block('blk-ok', L24, [article(L24, '1')]), odd])]); }).not.toThrow();
    expect(r?.practices[0].acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['1']);
    expect(r?.dropped).toEqual(['tab "Strano", item #1: could not be read (boom)']);
  });

  it('drops an article whose norma_data fields are not text, which the keys and the sort would throw on', () => {
    const odd = (extra: Record<string, unknown>) => ({ ...article(L24, '9'), norma_data: { ...article(L24, '9').norma_data, ...extra } }) as unknown as ArticleData;
    const r = migrate([tab('tab-odd', 'Strano', 1, [
      block('blk-ok', L24, [article(L24, '1'), odd({ allegato: {} }), odd({ data_versione: 5 }), odd({ numero_atto: 24 }), odd({ allegato: null })]),
    ])]);
    expect(r.practices[0].acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['1', '9']);
    expect(r.dropped).toHaveLength(3);
  });

  it('takes the visible tab as the one in front, as PR 4d does: minimised and hidden tabs keep their z-index but not the front', () => {
    const r = migrate(minimisedAndHidden);
    expect(r.practices.map((p) => p.id)).toEqual(['tab-visible', 'tab-minimised', 'tab-hidden']);
    expect(r.activePracticeId).toBe('tab-visible');
    expect(r.practices[0].decisions.map((d) => d.id)).toEqual(['dec-min']);
    expect(r.practices[0].beside.map((b) => b.id)).toEqual(['search-vis']);
    expect(r.droppedSearches).toEqual(['Tema: nesso causale']);
    expect(r.practices.slice(1).every((p) => p.decisions.length === 0 && p.beside.length === 0)).toBe(true);
  });

  it('with no norm tab visible, takes the highest z-index among them', () => {
    const r = migrate(noneVisible);
    expect(r.activePracticeId).toBe('tab-high');
    expect(r.practices.find((p) => p.id === 'tab-high')?.decisions.map((d) => d.id)).toEqual(['dec-x']);
  });

  it('keeps a decision reference as sanitizePractices keeps it, so a second pass changes nothing', () => {
    const r = migrate([decisionTab('dec-extra', 'Cass. civ., n. 28994/2019', 1, { ...FOUND, extra: 'x', sezione: 3 } as unknown as typeof FOUND)]);
    const [entry] = r.practices[0].decisions;
    expect(entry.reference).toEqual(FOUND);
    expect(sanitizePractices(JSON.parse(JSON.stringify(r.practices)))).toEqual({ practices: r.practices, dropped: [] });
  });

  it('refuses a decision of a court VisuaLex does not read, never labelling it as the Cassazione', () => {
    const r = migrate([decisionTab('dec-tar', '', 1, { corte: 'tar', numero: 1, anno: 2020 } as unknown as typeof FOUND)]);
    expect(r.practices).toEqual([]);
    expect(r.dropped).toEqual(['tab "dec-tar": a view that cannot be read (decision, the court tar)']);
    expect(JSON.stringify(r)).not.toContain('Cass.');
  });

  it('names a practice «Pratica» when its tab had no name; trims and caps every label at 120', () => {
    const long = `  ${'d'.repeat(200)}  `;
    const r = migrate([
      tab('tab-blank', '   ', 2, []),
      decisionTab('dec-long', long, 1, FOUND),
      decisionTab('dec-blank', '  ', 1, UNRESOLVED),
      searchTab('search-long', `  ${'s'.repeat(200)} `, 3, { tema: 'danno' }),
      searchTab('search-blank', ' ', 1, { tema: 'chance' }),
    ]);
    const [p] = r.practices;
    expect(p.label).toBe('Pratica');
    expect(p.decisions.map((d) => d.label)).toEqual(['d'.repeat(120), formatDecisionShort(UNRESOLVED)]);
    expect(p.beside[0].kind === 'decision-search' && p.beside[0].label).toBe('s'.repeat(120));
    expect(r.droppedSearches).toEqual(['Ricerca per tema']);
  });

  it('drops a topic search whose norm label is not text', () => {
    const r = migrate([searchTab('search-bad', 'Tema: danno', 1, { tema: 'danno', normaLabel: { html: '<b>' } } as unknown as { tema: string })]);
    expect(r.practices).toEqual([]);
    expect(r.dropped).toHaveLength(1);
  });

  it('gives a fresh id to a tab whose id another tab already holds', () => {
    const r = migrate([twoTabs[0], { ...twoTabs[1], id: 'tab-cc' }]);
    expect(r.practices).toHaveLength(2);
    expect(new Set(r.practices.map((p) => p.id)).size).toBe(2);
  });

  it('loses nothing: every annotation key, every article id, every version, every decision', () => {
    for (const [name, saved] of Object.entries(ALL_SAVED_STATES)) {
      const r = migrate(saved);
      const after = r.practices.flatMap((p) => p.acts.flatMap((a) => a.articles));
      const before = savedArticles(saved);
      for (const a of before) {
        const kept = after.find((b) => buildItemKey(b.norma_data) === buildItemKey(a.norma_data) &&
          uniqueArticleIdFromNorma(b.norma_data) === uniqueArticleIdFromNorma(a.norma_data) &&
          versionKey(b.norma_data) === versionKey(a.norma_data));
        expect(kept, `${name}: ${buildItemKey(a.norma_data)}`).toBeDefined();
        expect(kept?.norma_data, name).toEqual(a.norma_data);
      }
      const pairs = (list: ArticleData[]) => new Set(list.map((a) => `${buildItemKey(a.norma_data)}|${versionKey(a.norma_data)}`)).size;
      expect(pairs(after), name).toBe(pairs(before));
      const decisionsAfter = r.practices.flatMap((p) => p.decisions.map((d) => decisionKey(d.reference)));
      expect(new Set(decisionsAfter), name).toEqual(new Set(savedDecisions(saved).map(decisionKey)));
      expect(r.dropped, name).toEqual([]);
    }
  });

  it('never changes the saved state it reads', () => {
    const snapshot = JSON.stringify(decisionTabs);
    migrate(decisionTabs);
    migrate(codeTwoBlocks);
    expect(JSON.stringify(decisionTabs)).toBe(snapshot);
  });
});

describe('sanitizePractices', () => {
  const migrated = () => migrate([...decisionTabs, ...topicTabs.slice(1)]).practices;

  it('keeps what the migration writes, unchanged', () => {
    const practices = migrated();
    expect(sanitizePractices(JSON.parse(JSON.stringify(practices)))).toEqual({ practices, dropped: [] });
  });

  it('takes nothing for nothing, and reports a value that is not a list', () => {
    expect(sanitizePractices(undefined)).toEqual({ practices: [], dropped: [] });
    expect(sanitizePractices('pratiche').practices).toEqual([]);
    expect(sanitizePractices('pratiche').dropped).toHaveLength(1);
  });

  it('drops a practice without an id or a label, or with something else where a list belongs, or an id seen before', () => {
    const [good] = migrated();
    const r = sanitizePractices([
      null, { ...good, id: 3 }, { ...good, id: 'b', label: undefined }, { ...good, id: 'c', acts: {} },
      { ...good, id: 'd', decisions: 'none' }, { ...good, id: 'e', beside: null }, good, { ...good, label: 'Doppione' },
    ]);
    expect(r.practices.map((p) => p.id)).toEqual([good.id]);
    expect(r.dropped).toHaveLength(7);
  });

  it('drops an act without an act type, an article without norma_data, a copy of a row, and caps a label', () => {
    const law = article(L24, '1');
    const r = sanitizePractices([{
      id: 'p', label: `  ${'x'.repeat(200)}  `, labelIsCustom: 'yes', decisions: [], beside: [],
      acts: [
        { id: 'a1', key: 'stale', norma: { numero_atto: '24' }, articles: [], isCollapsed: false },
        { id: 'a2', key: 'stale', norma: L24, articles: [law, { article_text: 'x' }, { norma_data: 'x' }, law], isCollapsed: 'no' },
      ],
    }]);
    const [p] = r.practices;
    expect(p.label).toBe('x'.repeat(120));
    expect(p.labelIsCustom).toBe(false);
    expect(p.acts).toEqual([{ id: 'a2', key: 'legge|24|2017-03-08', norma: L24, articles: [law], isCollapsed: false }]);
    expect(r.dropped).toHaveLength(4);
  });

  it('drops a decision whose reference fails the checks, and keeps only known fields', () => {
    const ok = { id: 'd1', reference: { ...FOUND, extra: 'x' }, label: 'Cass. civ., n. 28994/2019', identified: true, depositDate: '2019-11-11', tipo: 'Ordinanza', html: '<b>' };
    const r = sanitizePractices([{
      id: 'p', label: 'P', labelIsCustom: false, acts: [], beside: [],
      decisions: [
        ok,
        { ...ok, id: 'd2', reference: { corte: 'cassazione', numero: -1, anno: 2020 } },
        { ...ok, id: 'd3', reference: { corte: '', numero: 1, anno: 2020 } },
        { ...ok, id: 'd4', reference: { corte: 'cassazione', numero: 1.5, anno: 2020 } },
        { ...ok, id: 'd5', label: 7 },
        { ...ok, id: 'd1' },
      ],
    }]);
    expect(r.practices[0].decisions).toEqual([
      { id: 'd1', reference: FOUND, label: 'Cass. civ., n. 28994/2019', identified: true, depositDate: '2019-11-11', tipo: 'Ordinanza' },
    ]);
    expect(r.dropped).toHaveLength(5);
  });

  it('keeps historyRecordedKey only as text, refuses an unknown court, and trims and caps the labels', () => {
    const ok = { id: 'd1', reference: FOUND, label: `  ${'c'.repeat(150)}`, identified: true, historyRecordedKey: 'cassazione:civile:28994:2019' };
    const r = sanitizePractices([{
      id: 'p', label: '   ', labelIsCustom: false, acts: [], beside: [],
      decisions: [
        ok,
        { ...ok, id: 'd2', reference: UNRESOLVED, label: ' ', historyRecordedKey: 7 },
        { ...ok, id: 'd3', reference: { corte: 'tar', numero: 1, anno: 2020 } },
      ],
    }]);
    const [p] = r.practices;
    expect(p.label).toBe('Pratica');
    expect(p.decisions).toEqual([
      { ...ok, label: 'c'.repeat(120) },
      { id: 'd2', reference: UNRESOLVED, label: formatDecisionShort(UNRESOLVED), identified: true },
    ]);
    expect(r.dropped).toHaveLength(1);
  });

  it('drops an article whose text is not text, and a topic window whose norm label is not text', () => {
    const law = article(L24, '1');
    const r = sanitizePractices([{
      id: 'p', label: 'P', labelIsCustom: false, decisions: [],
      acts: [{ id: 'a', key: 'x', norma: L24, articles: [law, { ...article(L24, '2'), article_text: { html: '<b>' } }], isCollapsed: false }],
      beside: [
        { id: 'w-bad', kind: 'decision-search', query: { tema: 'danno', normaLabel: ['art. 1'] }, label: 'Tema: danno' },
        { id: 'w-ok', kind: 'decision-search', query: { tema: 'danno', normaLabel: 'art. 1 l. 24/2017' }, label: '  Tema: danno ' },
      ],
    }]);
    const [p] = r.practices;
    expect(p.acts[0].articles).toEqual([law]);
    expect(p.beside).toEqual([{ id: 'w-ok', kind: 'decision-search', query: { tema: 'danno', normaLabel: 'art. 1 l. 24/2017' }, label: 'Tema: danno' }]);
    expect(r.dropped).toHaveLength(2);
  });

  it('makes act and decision ids unique across practices, re-id\'ing a taken one, and its windows follow it', () => {
    const law = article(L24, '1');
    const act = { id: 'a', key: 'x', norma: L24, articles: [law], isCollapsed: false };
    const decision = { id: 'd', reference: FOUND, label: 'Cass.', identified: false };
    const practice = (id: string) => ({
      id, label: id, labelIsCustom: false, acts: [act], decisions: [decision],
      beside: [
        { id: 'w-art', kind: 'article', actId: 'a', articleKey: practiceArticleKey(law) },
        { id: 'w-dec', kind: 'decision', decisionId: 'd' },
      ],
    });
    const r = sanitizePractices([practice('p1'), practice('p2'), practice('p3')]);
    expect(r.practices.map((p) => [p.acts[0].id, p.decisions[0].id])).toEqual([['a', 'd'], ['a-2', 'd-2'], ['a-3', 'd-3']]);
    expect(r.practices[1].beside).toEqual([
      { id: 'w-art', kind: 'article', actId: 'a-2', articleKey: practiceArticleKey(law) },
      { id: 'w-dec', kind: 'decision', decisionId: 'd-2' },
    ]);
    expect(r.dropped).toHaveLength(4);
    // a second pass changes nothing
    expect(sanitizePractices(JSON.parse(JSON.stringify(r.practices)))).toEqual({ practices: r.practices, dropped: [] });
  });

  it('merges a second entry of one decision into the first, keeping the richer fields, and its window follows', () => {
    const plain = { id: 'd1', reference: FOUND, label: 'Cass. civ., n. 28994/2019', identified: false };
    const found = {
      id: 'd2', reference: { ...FOUND, sezione: '3' }, label: 'Cass. civ., sez. III, n. 28994/2019', identified: true,
      depositDate: '2019-11-11', tipo: 'Ordinanza', historyRecordedKey: 'cassazione:civile:28994:2019',
    };
    const r = sanitizePractices([{
      id: 'p', label: 'P', labelIsCustom: false, acts: [],
      decisions: [plain, found],
      beside: [{ id: 'w', kind: 'decision', decisionId: 'd2' }],
    }]);
    const [p] = r.practices;
    expect(p.decisions).toEqual([{ ...found, id: 'd1' }]);
    expect(p.beside).toEqual([{ id: 'w', kind: 'decision', decisionId: 'd1' }]);
    expect(r.dropped).toEqual([expect.stringContaining('merged')]);
    // the first entry's own fields win when both are identified
    const both = sanitizePractices([{
      id: 'p', label: 'P', labelIsCustom: false, acts: [], beside: [],
      decisions: [{ ...found, id: 'd1', tipo: 'Sentenza' }, { ...found, id: 'd2' }, { ...plain, id: 'd3' }],
    }]);
    expect(both.practices[0].decisions).toEqual([{ ...found, id: 'd1', tipo: 'Sentenza' }]);
    expect(both.dropped).toHaveLength(2);
  });

  it('keeps an act and a decision that share a saved id apart: each window finds its own', () => {
    const law = article(L24, '1');
    const r = sanitizePractices([{
      id: 'p', label: 'P', labelIsCustom: false,
      acts: [{ id: 'x', key: 'k', norma: L24, articles: [law], isCollapsed: false }],
      decisions: [{ id: 'x', reference: FOUND, label: 'Cass.', identified: false }],
      beside: [
        { id: 'w-dec', kind: 'decision', decisionId: 'x' },
        { id: 'w-art', kind: 'article', actId: 'x', articleKey: practiceArticleKey(law) },
      ],
    }]);
    const [p] = r.practices;
    expect(p.acts[0].id).toBe('x');
    expect(p.decisions[0].id).toBe('x-2');
    expect(p.beside).toEqual([
      { id: 'w-dec', kind: 'decision', decisionId: 'x-2' },
      { id: 'w-art', kind: 'article', actId: 'x', articleKey: practiceArticleKey(law) },
    ]);
    expect(r.dropped).toEqual([expect.stringContaining("re-id'd x-2")]);
  });

  it('re-ids a second act with a taken id inside one practice instead of losing its articles', () => {
    const r = sanitizePractices([{
      id: 'p', label: 'P', labelIsCustom: false, decisions: [], beside: [],
      acts: [
        { id: 'a', key: 'x', norma: L24, articles: [article(L24, '1')], isCollapsed: false },
        { id: 'a', key: 'x', norma: CC_RD, articles: [article(CC_RD, '2043', { allegato: '2' })], isCollapsed: false },
      ],
    }]);
    expect(r.practices[0].acts.map((a) => [a.id, a.articles.length])).toEqual([['a', 1], ['a-2', 1]]);
  });

  it('keeps a window only when it points at something the practice holds, at most two', () => {
    const law = article(L24, '1');
    const key = practiceArticleKey(law);
    const base = {
      id: 'p', label: 'P', labelIsCustom: false,
      acts: [{ id: 'a', key: 'legge|24|2017-03-08', norma: L24, articles: [law], isCollapsed: false }],
      decisions: [{ id: 'd', reference: FOUND, label: 'Cass.', identified: false }],
    };
    const art = { id: 'w-art', kind: 'article', actId: 'a', articleKey: key };
    const dec = { id: 'w-dec', kind: 'decision', decisionId: 'd' };
    const search = { id: 'w-search', kind: 'decision-search', query: { tema: 'danno' }, label: 'Tema: danno' };
    const r = sanitizePractices([{
      ...base,
      beside: [
        { ...art, id: 'w-gone', actId: 'nope' },
        { ...art, id: 'w-gone-2', articleKey: 'nope' },
        { ...dec, id: 'w-gone-3', decisionId: 'nope' },
        { ...search, id: 'w-bad', query: { tema: 3 } },
        { id: 'w-what', kind: 'video' },
        art, dec, search,
      ],
    }]);
    expect(r.practices[0].beside).toEqual([dec, search]);
    expect(r.dropped).toHaveLength(6);
  });
});
