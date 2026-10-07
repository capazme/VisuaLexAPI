import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MassimeSection } from './MassimeSection';
import { appStore } from '../../../store/useAppStore';

function show(massime: Parameters<typeof MassimeSection>[0]['massime']) {
  return render(<MemoryRouter><MassimeSection massime={massime} /></MemoryRouter>);
}

describe('MassimeSection — the decision a Brocardi massima is headed with', () => {
  it('names a decision of the Cassazione by its short label and links its address', () => {
    show([{ autorita: 'Cass. civ.', numero: '31191', anno: '2025', massima: 'Il danno ingiusto.' }]);
    const chip = screen.getByText('Cass. civ., n. 31191/2025');
    expect(chip.closest('a')).toHaveAttribute('href', '/sentenze/cassazione-civile/31191/2025');
    expect(screen.queryByText('n. 31191/2025')).toBeNull();
  });

  it('links a bare «Cass.» as a reference the route resolves, never a guessed archive', () => {
    show([{ autorita: 'Cass', numero: '2633', anno: '1982', massima: 'Il nesso causale.' }]);
    expect(screen.getByText('Cass., n. 2633/1982').closest('a')).toHaveAttribute('href', '/sentenze/cassazione/2633/1982');
  });

  it('links the Sezioni Unite with their section, for the route to find the archive', () => {
    show([{ autorita: 'Cass. sez. un.', numero: '8', anno: '2018', massima: 'Il contrasto.' }]);
    expect(screen.getByText('Cass., sez. un., n. 8/2018').closest('a')).toHaveAttribute('href', '/sentenze/cassazione/8/2018?sezione=U');
  });

  it('names a decision with no year and links nothing: an address needs the year', () => {
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

describe('MassimeSection — a decision opened from the article', () => {
  it('opens beside the article and records the way back to it', () => {
    const open = vi.fn(() => 'tab');
    appStore.setState({ openDecisionTab: open, readingBackStack: [] } as never);
    const back = { tabId: 't1', blockId: 'b1', articleId: 'a1', label: 'art. 2043 c.c.' };
    render(
      <MemoryRouter initialEntries={['/']}>
        <MassimeSection
          massime={[{ autorita: 'Cass. civ.', numero: '31191', anno: '2025', massima: 'Il danno ingiusto.' }]}
          besideTabId="t1"
          backEntry={back}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Cass. civ., n. 31191/2025'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ numero: 31191 }), { besideTabId: 't1' });
    expect(appStore.getState().readingBackStack).toEqual([back]);
  });
});

describe('MassimeSection — its own toggle', () => {
  it('is named by what it counts, in the singular too, and reports its state', () => {
    const view = show([
      { autorita: 'Cass. civ.', numero: '1', anno: '2020', massima: 'Uno.' },
      { autorita: 'Cass. civ.', numero: '2', anno: '2021', massima: 'Due.' },
      { autorita: 'Cass. civ.', numero: '3', anno: '2022', massima: 'Tre.' },
    ]);
    const toggle = screen.getByRole('button', { name: '3 di 3 massime' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    view.unmount();
    show([{ autorita: 'Cass. civ.', numero: '1', anno: '2020', massima: 'Uno.' }]);
    expect(screen.getByRole('button', { name: '1 di 1 massima' })).toBeInTheDocument();
  });
});
