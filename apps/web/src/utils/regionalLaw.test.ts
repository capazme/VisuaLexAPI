/**
 * G-577: a regional law is never a ready reading. The three lists are `REGIONAL`, `STATE` and `LOOK_ALIKE` of
 * `services/visualex/tests/test_regional_law.py`, copied as they are: keep them in step.
 */
import { describe, expect, it } from 'vitest';
import { parseLegalCitation } from './citationParser';
import { readNormQuery } from './normQuery';
import { citesRegionalLaw, REGIONAL_LAW_REFUSAL } from './regionalLaw';

const REGIONAL = [
  'l.r. Toscana 65/2014',
  'l.r. 65/2014',
  'L.R. n. 3/2015',
  'l. r. 65/2014',
  'LR 65/2014',
  'L.R.T. 65/2014',
  'legge regionale 12 marzo 2015, n. 3',
  'legge regionale n. 3/2015',
  'legge reg. Lazio 3/2015',
  'legge regionale Lombardia 12 marzo 2015, n. 3',
  'legge della Regione Toscana 10 novembre 2014, n. 65',
  'legge Regione Toscana 65/2014',
  'legge regione lombardia 12/2005',
  'legge 10 novembre 2014, n. 65 della Regione Toscana',
  'legge 65/2014 della Regione Toscana',
  'legge 65/2014 (Regione Toscana)',
  'legge 10 novembre 2014, n. 65 (Toscana)',
  'legge 65/2014 della Toscana',
  'legge 3/2015 della Regione autonoma della Sardegna',
  'L.R. Toscana n. 65 del 10 novembre 2014',
  'della l.r. Toscana 65/2014',
  'L. 65/2014 della Regione Toscana',
  'L. 65/2014 (Regione Toscana)',
  'l. n. 65/2014 Regione Toscana',
  'L. 65/2014 Toscana',
  'l. 10 novembre 2014, n. 65 Regione Toscana',
  'legge 65/2014 Reg. Toscana',
  'legge 65/2014 R. Toscana',
  'L 65/2014 Regione Toscana',
  'L.65/2014 Regione Toscana',
  'legge n. 65 del 2014 della Regione Toscana',
  'l. Regione Toscana 65/2014',
  'l. reg. 3/2015',
  'legge reg. 3/2015',
  'l. regionale 3/2015',
  'L. Regionale n. 3/2015',
  'legge reg.le 3/2015',
  'legge Toscana 65/2014',
  'legge Emilia-Romagna 24/2017',
];
const STATE = [
  'legge 65/2014',
  'L. 65/2014',
  'legge 10 novembre 2014, n. 65',
  'legge 241/1990',
  'l. 3/2015',
  'L 241/1990',
  'L.241/1990',
  'legge 241/1990, che si applica alle regioni',
];
const LOOK_ALIKE = [
  'legge costituzionale 3/2001',
  'legge fallimentare',
  'LRT',
  'lrt',
  'regolamento (UE) 2016/679',
  'art. 1 reg. ue 2016/679',
  's.r.l. 3/2020',
  'statuto della regione siciliana',
  'art. 117 cost.',
  'art. 5 l. 241/1990 reg. UE 2016/679',
  'art. 1 l. 449/1997 reg. imprese',
  'legge regolamento',
];

describe('regional laws (G-577)', () => {
  it.each(REGIONAL)('«%s» is a regional law, refused with the API\'s sentence and no request', (name) => {
    for (const query of [name, `art. 3 ${name}`]) {
      expect(citesRegionalLaw(query)).toBe(true);
      expect(parseLegalCitation(query)).toBeNull();
      expect(readNormQuery(query)).toEqual({ citation: null, ready: false, askServer: null, refusal: REGIONAL_LAW_REFUSAL });
    }
  });

  it.each(STATE)('«%s» stays a State law', (name) => {
    expect(citesRegionalLaw(name)).toBe(false);
    const reading = readNormQuery(`art. 3 ${name}`);
    expect(reading.refusal).toBeUndefined();
    expect(reading.citation).toMatchObject({ act_type: 'legge', article: '3' });
  });

  it.each(LOOK_ALIKE)('«%s» only looks like one', (name) => {
    expect(citesRegionalLaw(name)).toBe(false);
  });
});
