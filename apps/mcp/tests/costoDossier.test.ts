import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script, with no declaration file
import { CASE, measure } from '../scripts/costo-dossier.mjs';

interface Cost {
  calls: number;
  total: number;
  reread: number;
  results: { name: string; isError: boolean; text: string }[];
}

describe('the cost of a dossier on the fixed case (scripts/costo-dossier.mjs)', () => {
  it('takes one call after D8 S1, with the list and the notes, and answers only the rows that did not enter', async () => {
    const after: Cost = await measure('dopo');
    expect(after.calls).toBe(1);
    expect(after.results.map((r) => [r.name, r.isError])).toEqual([['omnilex_crea_dossier', false]]);
    const answer = JSON.parse(after.results[0].text);
    expect(answer.entrate).toEqual({ norme: 7, sentenze: 0, note: 8 });
    // The nineteen whole acts, each as it was written in the call.
    expect(answer.non_entrate).toHaveLength(19);
    for (const row of answer.non_entrate) expect(CASE.riferimenti).toContain(row.riga);
    expect(answer.non_entrate.map((r: { riga: string }) => r.riga)).toContain('reg. (UE) 2012/1025');
    expect(answer).not.toHaveProperty('note_non_entrate');
  });

  it('costs less than the path of one call per step, which takes ten', async () => {
    const before: Cost = await measure('prima');
    const after: Cost = await measure('dopo');
    // Create, the norms in one batch of 26, eight notes one by one.
    expect(before.calls).toBe(10);
    expect(before.results.every((r) => !r.isError)).toBe(true);
    expect(after.total).toBeLessThan(before.total);
    expect(after.reread * 5).toBeLessThan(before.reread);
  });
});
