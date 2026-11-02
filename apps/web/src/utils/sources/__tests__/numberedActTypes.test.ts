import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NUMBERED_ACT_TYPES, identifiesAct, isNumberedActType } from '../numberedActTypes';

// The web's copy of the numbered act types against the convention's file, as the API's copy is
// (services/visualex/tests/test_act_identity.py): one list for every suite.
function convention(): { types: string[] } {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'numbered-act-types.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) throw new Error('conventions/sources/numbered-act-types.json not found');
  }
}

describe('the numbered act types', () => {
  it('are the convention’s list, in its order', () => {
    expect([...NUMBERED_ACT_TYPES]).toEqual(convention().types);
  });

  it('compare with their case folded: the palette’s «Regolamento UE» is the server’s «regolamento ue»', () => {
    expect(isNumberedActType('Regolamento UE')).toBe(true);
    expect(isNumberedActType('regolamento ue')).toBe(true);
    expect(isNumberedActType('Direttiva UE')).toBe(true);
    expect(isNumberedActType('codice civile')).toBe(false);
    expect(isNumberedActType(undefined)).toBe(false);
  });
});

describe('identifiesAct', () => {
  it('a code, the Costituzione, a Treaty need no number', () => {
    expect(identifiesAct({ act_type: 'codice civile' })).toBe(true);
    expect(identifiesAct({ act_type: 'costituzione' })).toBe(true);
    expect(identifiesAct({ act_type: 'TFUE' })).toBe(true);
  });

  it('a numbered type needs its number and its date', () => {
    expect(identifiesAct({ act_type: 'legge', act_number: '241', date: '1990' })).toBe(true);
    expect(identifiesAct({ act_type: 'legge', act_number: '241' })).toBe(false);
    expect(identifiesAct({ act_type: 'legge', date: '1990' })).toBe(false);
    expect(identifiesAct({ act_type: 'regolamento ue', act_number: '679', date: '2016' })).toBe(true);
  });

  it('a decreto ministeriale or a DPCM with no number names no act (the server’s «art. 2 d.m.»)', () => {
    expect(identifiesAct({ act_type: 'decreto ministeriale' })).toBe(false);
    expect(identifiesAct({ act_type: 'decreto del presidente del consiglio dei ministri', date: '2020' })).toBe(false);
  });

  it('no type names no act', () => {
    expect(identifiesAct(null)).toBe(false);
    expect(identifiesAct({ act_type: '  ' })).toBe(false);
  });
});
