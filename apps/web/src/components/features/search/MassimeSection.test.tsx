import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MassimeSection } from './MassimeSection';

function show(massime: Parameters<typeof MassimeSection>[0]['massime']) {
  return render(<MemoryRouter><MassimeSection massime={massime} /></MemoryRouter>);
}

describe('MassimeSection — the decision a Brocardi massima is headed with', () => {
  it('names a decision of the Cassazione by its short label and links its page', () => {
    show([{ autorita: 'Cass. civ.', numero: '31191', anno: '2025', massima: 'Il danno ingiusto.' }]);
    const chip = screen.getByText('Cass. civ., n. 31191/2025');
    expect(chip.closest('a')).toHaveAttribute('href', '/sentenze/cassazione-civile/31191/2025');
    expect(screen.queryByText('n. 31191/2025')).toBeNull();
  });

  it('links a bare «Cass.» as a reference the page resolves, never a guessed archive', () => {
    show([{ autorita: 'Cass', numero: '2633', anno: '1982', massima: 'Il nesso causale.' }]);
    expect(screen.getByText('Cass., n. 2633/1982').closest('a')).toHaveAttribute('href', '/sentenze/cassazione/2633/1982');
  });

  it('leaves another court as the source writes it', () => {
    show([{ autorita: 'Cons. Stato', numero: '10', anno: '2020', massima: 'Il provvedimento.' }]);
    expect(screen.getByText('Cons. Stato')).toBeInTheDocument();
    expect(screen.getByText('n. 10/2020')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
