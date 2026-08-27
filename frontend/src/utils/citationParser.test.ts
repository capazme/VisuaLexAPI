import { describe, it, expect } from 'vitest';
import { formatParsedCitation } from './citationParser';

describe('formatParsedCitation — date shown in a citation', () => {
  it('shows the year when the resolver answered with a full ISO date', () => {
    // The server resolver returns "2012-06-28" for acts it knows by name; a
    // citation names the year. The full date stays in the search params.
    expect(formatParsedCitation({ article: '18', act_type: 'legge', act_number: '92', date: '2012-06-28', confidence: 1 }))
      .toBe('Art. 18 L. 92/2012');
  });

  it('leaves a year-only date alone', () => {
    expect(formatParsedCitation({ article: '5', act_type: 'regolamento ue', act_number: '679', date: '2016', confidence: 1 }))
      .toBe('Art. 5 Reg. UE 679/2016');
  });

  it('keeps a codice without number or date unchanged', () => {
    expect(formatParsedCitation({ article: '2043', act_type: 'codice civile', confidence: 1 }))
      .toBe('Art. 2043 C.C.');
  });
});
