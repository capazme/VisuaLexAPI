import { describe, expect, it } from 'vitest';
import { euCaseLawQuery, eurLexDecisionUrl } from './euCaseLaw';

const gdpr = { tipo_atto: 'regolamento ue', data: '2016', numero_atto: '679', numero_articolo: '6' };

describe('euCaseLawQuery', () => {
  it('derives the CELEX the API derives: 3, the year, R, the number on four digits', () => {
    expect(euCaseLawQuery(gdpr)).toEqual({ celex: '32016R0679', articolo: '6' });
    expect(euCaseLawQuery({ ...gdpr, numero_atto: '2554', data: '2022', numero_articolo: '21' })).toEqual({ celex: '32022R2554', articolo: '21' });
  });

  it('writes a directive with L, whatever the spelling of its type', () => {
    expect(euCaseLawQuery({ tipo_atto: 'Direttiva UE', data: '2011', numero_atto: '83', numero_articolo: '6' })).toEqual({ celex: '32011L0083', articolo: '6' });
  });

  it('takes the year from a number written with it, and a full date', () => {
    expect(euCaseLawQuery({ ...gdpr, numero_atto: '2016/679', data: '' })).toEqual({ celex: '32016R0679', articolo: '6' });
    expect(euCaseLawQuery({ ...gdpr, data: '2016-04-27' })).toEqual({ celex: '32016R0679', articolo: '6' });
  });

  it('has no query for a Treaty, which the route does not list', () => {
    for (const tipo_atto of ['tfue', 'tue', 'cdfue']) {
      expect(euCaseLawQuery({ ...gdpr, tipo_atto })).toBeNull();
    }
  });

  it('has none for a national act', () => {
    expect(euCaseLawQuery({ tipo_atto: 'legge', data: '1990', numero_atto: '241', numero_articolo: '2' })).toBeNull();
  });

  it('has none when the year, the number or the article is not known as plain digits', () => {
    expect(euCaseLawQuery({ ...gdpr, data: '' })).toBeNull();
    expect(euCaseLawQuery({ ...gdpr, numero_atto: undefined })).toBeNull();
    expect(euCaseLawQuery({ ...gdpr, numero_atto: 'n. 679' })).toBeNull();
    expect(euCaseLawQuery({ ...gdpr, numero_atto: '0' })).toBeNull();
    expect(euCaseLawQuery({ ...gdpr, numero_articolo: '6-bis' })).toBeNull();
    expect(euCaseLawQuery({ ...gdpr, numero_articolo: '0' })).toBeNull();
    expect(euCaseLawQuery({ ...gdpr, numero_articolo: '10000' })).toBeNull();
  });
});

describe('eurLexDecisionUrl', () => {
  it('opens a decision on EUR-Lex in Italian by its CELEX', () => {
    expect(eurLexDecisionUrl('62023CC0097')).toBe('https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:62023CC0097');
  });

  it('makes no link from a CELEX that is not a decision\'s', () => {
    expect(eurLexDecisionUrl('32016R0679')).toBeNull();
    expect(eurLexDecisionUrl('62023CC0097&x=1')).toBeNull();
    expect(eurLexDecisionUrl('javascript:alert(1)')).toBeNull();
    expect(eurLexDecisionUrl('')).toBeNull();
  });
});
