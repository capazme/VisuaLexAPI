import { describe, expect, it } from 'vitest';
import { stopMessage } from './reviewStop';

// «Interrompere il ripasso?» says what really happens, with the session's count (U1c).
describe('stopMessage', () => {
  it('says how many cards were graded and that they stay, and where the others wait', () => {
    expect(stopMessage(4)).toBe('Hai ripassato 4 schede: restano registrate. Le altre ti aspettano in «Oggi».');
    expect(stopMessage(1)).toBe('Hai ripassato 1 scheda: resta registrata. Le altre ti aspettano in «Oggi».');
    expect(stopMessage(0)).toBe('Non hai ancora valutato schede in questo ripasso. Le schede ti aspettano in «Oggi».');
  });
});
