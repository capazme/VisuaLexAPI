import type { ArticleData, Norma, NormaVisitata } from '../../types';
import type { DecisionReference, DecisionSearchQuery } from '../../types/decisions';

/**
 * Saved workspaces in the shapes `useAppStore.ts` persisted as `workspaceTabs` before the
 * practices (spec `2026-10-08-norm-tab-container-design.md` §9): tabs with their geometry,
 * z-index and flags, norm blocks, loose articles, decision and topic views. One collection is
 * forged (no button made one any more) and one state is garbage. Plain data, typed loosely on
 * purpose: the tab types are retired by the migration this feeds.
 */

export const CC_RD: Norma = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262' };
export const CC_BARE: Norma = { tipo_atto: 'codice civile', data: '' };
export const L24: Norma = { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' };
export const L241: Norma = { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07' };

export function article(norma: Norma, numero: string, extra: Partial<NormaVisitata> = {}, more: Partial<ArticleData> = {}): ArticleData {
  const { urn: _urn, ...act } = norma;
  void _urn;
  return {
    article_text: `Art. ${numero}\nTesto dell'articolo ${numero}.`,
    norma_data: { ...act, numero_articolo: numero, versione: 'vigente', ...extra },
    ...more,
  };
}

type SavedItem = Record<string, unknown>;
type SavedTab = Record<string, unknown>;

export function block(id: string, norma: Norma, articles: ArticleData[], isCollapsed = false): SavedItem {
  return { type: 'norma', id, norma, articles, isCollapsed };
}

export function loose(id: string, art: ArticleData, sourceNorma: Norma): SavedItem {
  return { type: 'loose-article', id, article: art, sourceNorma };
}

export function tab(id: string, label: string, zIndex: number, content: SavedItem[], more: SavedTab = {}): SavedTab {
  return {
    id, label, zIndex, content,
    position: { x: 40 * zIndex, y: 40 }, size: { width: 640, height: 520 },
    isMinimized: false, isHidden: false, labelIsCustom: false,
    ...more,
  };
}

export function decisionTab(id: string, label: string, zIndex: number, reference: DecisionReference, more: SavedTab = {}): SavedTab {
  return tab(id, label, zIndex, [], { view: { kind: 'decision', reference }, ...more });
}

export function searchTab(id: string, label: string, zIndex: number, query: DecisionSearchQuery, more: SavedTab = {}): SavedTab {
  return tab(id, label, zIndex, [], { view: { kind: 'decision-search', query }, ...more });
}

/** Two tabs; the second was the one in front. */
export const twoTabs = [
  tab('tab-cc', 'Codice civile', 3, [block('blk-cc', CC_RD, [article(CC_RD, '2043', { allegato: '2' })])]),
  tab('tab-l24', 'Responsabilità medica', 7, [block('blk-l24', L24, [article(L24, '5'), article(L24, '7')])], { labelIsCustom: true }),
];

/** One tab, two blocks of the codice civile: one from a search (with the R.D.), one from the index (without). */
export const codeTwoBlocks = [
  tab('tab-code', 'Codice civile', 1, [
    block('blk-rd', CC_RD, [article(CC_RD, '2043', { allegato: '2' })], true),
    block('blk-bare', CC_BARE, [article(CC_BARE, '2043'), article(CC_BARE, '1218')]),
  ]),
];

/** One block holding a code's article from a search (`allegato: '2'`) and from the index. */
export const codeSearchAndIndex = [
  tab('tab-mixed', 'Codice civile', 1, [
    block('blk-mixed', CC_RD, [article(CC_RD, '2043', { allegato: '2' }), article(CC_RD, '2043', { numero_atto: undefined, data: '' })]),
  ]),
];

/** Loose articles: one of the act already in the tab, one of another act. */
export const looseArticles = [
  tab('tab-loose', 'Legge 24', 2, [
    block('blk-l24', L24, [article(L24, '1')]),
    loose('loose-l24', article(L24, '5'), L24),
    loose('loose-cc', article(CC_RD, '2043', { allegato: '2' }), CC_RD),
  ]),
];

/** A collection, forged: no button makes one, but an old browser may hold it. */
export const forgedCollection = [
  tab('tab-coll', 'Raccolta', 1, [
    block('blk-l241', L241, [article(L241, '2')]),
    {
      type: 'collection', id: 'coll-1', label: 'Da rileggere', isCollapsed: false, color: 'purple',
      articles: [
        { article: article(L241, '3'), sourceNorma: L241 },
        { article: article(CC_BARE, '1218'), sourceNorma: CC_BARE },
      ],
    },
  ]),
];

/** A «Testo alla data» search: a tab of its own, labelled with the day asked for. */
export const pastTextTab = [
  tab('tab-past', 'Codice civile (testo al 29/12/2007)', 4, [
    block('blk-past', CC_RD, [article(CC_RD, '1284', { allegato: '2', data_versione: '2007-12-29' }, { versionInfo: { isHistorical: true, requestedDate: '2007-12-29' } })]),
  ]),
];

export const FOUND: DecisionReference = { corte: 'cassazione', numero: 28994, anno: 2019, archivio: 'civile' };
export const UNRESOLVED: DecisionReference = { corte: 'cassazione', numero: 577, anno: 2008, sezione: 'U' };

/** Two norm tabs and two decision tabs; the decisions belong to the front norm tab. */
export const decisionTabs = [
  tab('tab-back', 'Legge 241', 2, [block('blk-241', L241, [article(L241, '1')])]),
  decisionTab('dec-found', 'Cass. civ., sez. III, n. 28994/2019', 9, FOUND, { historyRecordedKey: 'cassazione:civile:28994:2019' }),
  tab('tab-front', 'Codice civile', 5, [block('blk-front', CC_RD, [article(CC_RD, '2043', { allegato: '2' })])]),
  decisionTab('dec-open', 'Cass., sez. un., n. 577/2008', 6, UNRESOLVED),
];

/** Decision tabs and no norm tab. */
export const onlyDecisions = [
  decisionTab('dec-a', 'Cass. civ., sez. III, n. 28994/2019', 2, FOUND),
  decisionTab('dec-b', 'Corte cost., n. 71/2020', 3, { corte: 'corte_costituzionale', numero: 71, anno: 2020 }),
];

/** Two topic searches beside a norm tab: the one in front is reopened, the other named. */
export const topicTabs = [
  tab('tab-norm', 'Codice civile', 1, [block('blk-norm', CC_RD, [article(CC_RD, '1223', { allegato: '2' })])]),
  searchTab('search-old', 'Tema: perdita di chance', 4, { tema: 'perdita di chance' }),
  searchTab('search-front', 'Tema: danno da ritardo', 9, { tema: 'danno da ritardo', norma: { tipo_atto: 'codice civile', numero_articolo: '1223' }, normaLabel: 'art. 1223 c.c.' }),
];

/** Minimised and hidden tabs keep their z-index: the one in front is the visible one (PR 4d's
 *  `frontTabId`), which hosts the decision and the topic search shown. */
export const minimisedAndHidden = [
  tab('tab-visible', 'Legge 24', 3, [block('blk-vis', L24, [article(L24, '5')])]),
  tab('tab-minimised', 'Codice civile', 9, [block('blk-min', CC_RD, [article(CC_RD, '2043', { allegato: '2' })])], { isMinimized: true }),
  tab('tab-hidden', 'Legge 241', 8, [block('blk-hid', L241, [article(L241, '2')])], { isHidden: true }),
  decisionTab('dec-min', 'Cass. civ., sez. III, n. 28994/2019', 10, FOUND, { isMinimized: true }),
  searchTab('search-min', 'Tema: nesso causale', 11, { tema: 'nesso causale' }, { isMinimized: true }),
  searchTab('search-vis', 'Tema: danno da ritardo', 4, { tema: 'danno da ritardo' }),
];

/** Every norm tab minimised or hidden: the highest z-index among them is in front. */
export const noneVisible = [
  tab('tab-low', 'Legge 24', 2, [block('blk-low', L24, [article(L24, '5')])], { isHidden: true }),
  tab('tab-high', 'Codice civile', 6, [block('blk-high', CC_RD, [article(CC_RD, '2043', { allegato: '2' })])], { isMinimized: true }),
  decisionTab('dec-x', 'Cass. civ., sez. III, n. 28994/2019', 9, FOUND),
];

/** An extracted article and a collection entry whose act type is blank, with no saved source. */
export const blankActType = [
  tab('tab-blank', 'Atto senza tipo', 1, [
    block('blk-ok', L24, [article(L24, '1')]),
    loose('loose-blank', article({ tipo_atto: '', data: '' }, '3'), { tipo_atto: '  ', data: '' }),
    { type: 'collection', id: 'coll-blank', label: 'R', isCollapsed: false,
      articles: [{ article: article({ tipo_atto: '  ', data: '' }, '4') }] },
  ]),
];

/** A tab the user named and left empty. */
export const emptyTab = [tab('tab-empty', 'Ricorso Rossi', 1, [], { labelIsCustom: true })];

/** Garbage among real entries. */
export const garbage: unknown[] = [
  null,
  'una scheda',
  tab('', 'Senza id', 1, []),
  { label: 'Ancora senza id', content: [] },
  tab('tab-ok', 'Legge 24', 2, [
    block('blk-ok', L24, [article(L24, '1'), { article_text: 'Art. 2' } as unknown as ArticleData]),
    { type: 'sconosciuto', id: 'x' },
    { type: 'norma', id: 'blk-bad', norma: { numero_atto: '1' }, articles: [] },
    loose('loose-bad', { article_text: 'senza norma' } as unknown as ArticleData, L24),
  ]),
  decisionTab('dec-bad', 'Cass., n. -1/2020', 3, { corte: 'cassazione', numero: -1, anno: 2020 }),
];

/** Every well-formed state above, for the checks that nothing is lost. */
export const ALL_SAVED_STATES: Record<string, unknown[]> = {
  twoTabs, codeTwoBlocks, codeSearchAndIndex, looseArticles, forgedCollection, pastTextTab,
  decisionTabs, onlyDecisions, topicTabs, emptyTab, minimisedAndHidden, noneVisible,
};
