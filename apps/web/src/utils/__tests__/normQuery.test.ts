import { describe, expect, it } from 'vitest';
import type { CustomAlias } from '../../types';
import { citationFromServer, preferredReading, readNormQuery } from '../normQuery';

const gdpr: CustomAlias = {
  id: 'a1', trigger: 'gdpr', type: 'reference', expandTo: 'GDPR',
  searchParams: { act_type: 'Regolamento UE', act_number: '679', date: '2016' }, createdAt: '2026-10-31', usageCount: 0,
};

describe('readNormQuery — the client half of the search’s reading', () => {
  it('a reading the client makes searchable asks nothing of the server', () => {
    const reading = readNormQuery('art 2043 cc');
    expect(reading.citation).toMatchObject({ act_type: 'codice civile', article: '2043' });
    expect(reading).toMatchObject({ ready: true, askServer: null });
  });

  it('what the client cannot make searchable goes to the server, trimmed', () => {
    expect(readNormQuery('  art 82 gdpr ')).toMatchObject({ ready: false, askServer: 'art 82 gdpr' });
    expect(readNormQuery('statuto dei lavoratori')).toMatchObject({ ready: false, askServer: 'statuto dei lavoratori' });
  });

  it('reads with the user’s aliases', () => {
    expect(readNormQuery('art 82 gdpr', [gdpr])).toMatchObject({ ready: true, askServer: null, citation: { act_number: '679' } });
  });

  it('words too short are neither read nor sent', () => {
    expect(readNormQuery('a')).toEqual({ citation: null, ready: false, askServer: null });
    expect(readNormQuery('ab').askServer).toBeNull();
  });
});

describe('citationFromServer', () => {
  it('turns the server’s parsed into the client’s shape', () => {
    expect(citationFromServer({ recognized: true, parsed: { act_type: 'legge', act_number: '300', date: '1970', article: '18', annex: null } }))
      .toEqual({ act_type: 'legge', act_number: '300', date: '1970', article: '18', annex: undefined, confidence: 0.9 });
  });

  it('is null when nothing is recognised or no act is named', () => {
    expect(citationFromServer({ recognized: false, parsed: { act_type: 'legge' } })).toBeNull();
    expect(citationFromServer({ recognized: true, parsed: { article: '5' } })).toBeNull();
    expect(citationFromServer(null)).toBeNull();
  });
});

describe('preferredReading', () => {
  it('the client wins when searchable; otherwise the server fills in', () => {
    const local = readNormQuery('art 2043 cc').citation;
    const server = citationFromServer({ recognized: true, parsed: { act_type: 'codice civile', article: '2044' } });
    expect(preferredReading(local, server)).toBe(local);
    const half = readNormQuery('art 5 legge').citation;
    expect(preferredReading(half, server)).toBe(server);
    expect(preferredReading(half, null)).toBe(half);
  });
});
