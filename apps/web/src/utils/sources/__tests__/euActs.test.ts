import { describe, expect, it } from 'vitest';
import { citeNorm, shortNorm } from '../normLabels';

const dir = (data: string, numero_atto: string) => ({ tipo_atto: 'direttiva ue', data, numero_atto, numero_articolo: '1' });
const reg = (data: string, numero_atto: string) => ({ tipo_atto: 'regolamento ue', data, numero_atto, numero_articolo: '1' });

// EU acts before 2015 as the Official Journal numbered them (G-540); the server's euAct.
describe('EU acts before 2015', () => {
  it('Maastricht: the year alone counts 1993 as CEE, a full date decides', () => {
    expect(citeNorm(dir('1993', '104'))).toBe('art. 1, dir. 93/104/CEE');
    expect(citeNorm(dir('1993-11-23', '104'))).toBe('art. 1, dir. 93/104/CE');
    expect(citeNorm(dir('1993-10-31', '104'))).toBe('art. 1, dir. 93/104/CEE');
  });

  it('Lisbon: the year alone counts 2009 as CE, a full date decides', () => {
    expect(citeNorm(reg('2009', '1'))).toBe('art. 1, reg. (CE) n. 1/2009');
    expect(citeNorm(reg('2009-11-30', '1'))).toBe('art. 1, reg. (CE) n. 1/2009');
    expect(citeNorm(reg('2009-12-01', '1'))).toBe('art. 1, reg. (UE) n. 1/2009');
    expect(citeNorm(dir('2009-12-01', '1'))).toBe('art. 1, dir. 2009/1/UE');
  });

  it('the year has two digits before 1999', () => {
    expect(citeNorm(dir('1998', '34'))).toBe('art. 1, dir. 98/34/CE');
    expect(citeNorm(dir('1999', '44'))).toBe('art. 1, dir. 1999/44/CE');
    expect(shortNorm(reg('1971', '1408'))).toBe('art. 1 reg. (CEE) n. 1408/71');
  });

  it('from 2015 the year comes first, unchanged', () => {
    expect(citeNorm(reg('2016', '679'))).toBe('art. 1, reg. (UE) 2016/679');
    expect(citeNorm(reg('2016-04-27', '679'))).toBe('art. 1, reg. (UE) 2016/679');
  });
});
