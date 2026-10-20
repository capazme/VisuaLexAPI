import { describe, expect, it } from 'vitest';
import { gradeNote } from './useGradeNote';

describe('gradeNote', () => {
  it('says when the card comes back, from the interval the button showed', () => {
    expect(gradeNote(3, 8, false)).toBe('Torna tra 8 giorni');
    expect(gradeNote(2, 1, false)).toBe('Torna domani');
    expect(gradeNote(4, 60, false)).toBe('Torna tra 2 mesi');
    expect(gradeNote(4, 400, false)).toBe('Torna tra 1,1 anni');
  });

  it('sends «Di nuovo» to the back of the queue, recorded or not', () => {
    expect(gradeNote(1, 1, false)).toBe('Torna in coda');
    expect(gradeNote(1, 1, true)).toBe('Torna in coda');
  });

  it('promises no interval for a practice pass, which records nothing', () => {
    expect(gradeNote(3, 8, true)).toBe('Fatta per oggi');
  });
});
