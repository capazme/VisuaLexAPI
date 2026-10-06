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

  it('links the Sezioni Unite with their section, for the page to find the archive', () => {
    show([{ autorita: 'Cass. sez. un.', numero: '8', anno: '2018', massima: 'Il contrasto.' }]);
    expect(screen.getByText('Cass., sez. un., n. 8/2018').closest('a')).toHaveAttribute('href', '/sentenze/cassazione/8/2018?sezione=U');
  });

  it('names a decision with no year and links nothing: a page needs the year', () => {
    show([{ autorita: 'Cass. civ.', numero: '2633', anno: null, massima: 'Il nesso.' }]);
    expect(screen.getByText('Cass. civ., n. 2633').closest('a')).toBeNull();
  });

  it('leaves another court as the source writes it', () => {
    show([{ autorita: 'Cons. Stato', numero: '10', anno: '2020', massima: 'Il provvedimento.' }]);
    expect(screen.getByText('Cons. Stato')).toBeInTheDocument();
    expect(screen.getByText('n. 10/2020')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
