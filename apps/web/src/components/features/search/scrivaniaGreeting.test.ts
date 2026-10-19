import { describe, expect, it } from 'vitest';
import { greeting } from './scrivaniaGreeting';

describe('the Scrivania greeting', () => {
  it('follows the hour in Rome, and past midnight is still the evening', () => {
    expect(greeting(0)).toBe('Buonasera.');
    expect(greeting(4)).toBe('Buonasera.');
    expect(greeting(5)).toBe('Buongiorno.');
    expect(greeting(12)).toBe('Buongiorno.');
    expect(greeting(13)).toBe('Buon pomeriggio.');
    expect(greeting(18)).toBe('Buonasera.');
    expect(greeting(23)).toBe('Buonasera.');
  });
});
