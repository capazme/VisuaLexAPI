import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PAGE_TITLE, PageFrame } from './PageFrame';

describe('PageFrame (W2)', () => {
  it('takes the layout\'s width, with nothing narrower, and heads it with the title, the sentence and the action', () => {
    const { container } = render(
      <PageFrame title="Dossier pubblici" line="I dossier di studio pubblicati dalla comunità" action={<button type="button">Pubblica un dossier</button>}>
        <p>corpo</p>
      </PageFrame>,
    );
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).not.toMatch(/\bmax-w-|\bmx-auto\b/);
    const title = screen.getByRole('heading', { level: 1, name: 'Dossier pubblici' });
    // One size on every page: Newsreader, 28 px on a phone, 30 px from `md`.
    expect(title).toHaveClass(...PAGE_TITLE.split(' '));
    expect(title.querySelector('svg')).toBeNull();
    expect(screen.getByText('I dossier di studio pubblicati dalla comunità')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pubblica un dossier' })).toBeInTheDocument();
    expect(screen.getByText('corpo')).toBeInTheDocument();
  });

  it('marks a section\'s home title for the section switcher\'s focus, and no other', () => {
    const { unmount } = render(
      <PageFrame title="Gymnasium: la tua palestra giuridica" section="gymnasium">
        <p>corpo</p>
      </PageFrame>,
    );
    const home = screen.getByRole('heading', { level: 1 });
    expect(home).toHaveAttribute('data-section-title', 'gymnasium');
    expect(home).toHaveAttribute('tabindex', '-1');
    unmount();
    render(
      <PageFrame title="Cronologia">
        <p>corpo</p>
      </PageFrame>,
    );
    const page = screen.getByRole('heading', { level: 1 });
    expect(page).not.toHaveAttribute('data-section-title');
    expect(page).not.toHaveAttribute('tabindex');
  });
});
