import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FOCUS_BUTTON_CLEARANCE, PAGE_TITLE, PageFrame } from './PageFrame';

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

  it('keeps a header with an action clear of the Focus button, and only such a header', () => {
    const { unmount } = render(
      <PageFrame title="Cronologia" action={<button type="button">Svuota cronologia</button>}>
        <p>corpo</p>
      </PageFrame>,
    );
    expect(screen.getByRole('banner')).toHaveClass(FOCUS_BUTTON_CLEARANCE);
    unmount();
    render(
      <PageFrame title="Community">
        <p>corpo</p>
      </PageFrame>,
    );
    expect(screen.getByRole('banner')).not.toHaveClass(FOCUS_BUTTON_CLEARANCE);
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

/**
 * The section pages (W2): each draws its title through the frame, or — under a way back — with `PAGE_TITLE`; none writes
 * a title of its own, puts an icon beside it, or narrows the page under the layout's frame.
 */
const SECTION_PAGES = [
  'components/features/dossier/DossierListView.tsx',
  'components/features/dossier/TrashPage.tsx',
  'components/features/bulletin/BulletinBoardPage.tsx',
  'components/features/bulletin/ForumCommunityPage.tsx',
  'components/features/studia/StudiaPage.tsx',
  'components/features/documents/DocumentReviewPage.tsx',
  'features/connections/ConnectAiAppPage.tsx',
  'components/features/history/HistoryView.tsx',
  'pages/MerltHubPage.tsx',
  'features/merlt/contrib/ContribPage.tsx',
  'features/merlt/validate/ValidationPage.tsx',
  // Public, outside the layout, in the same frame since M1: the title at the column's edge, the text narrow.
  'pages/CreditsPage.tsx',
];

describe('the section pages (W2)', () => {
  it.each(SECTION_PAGES)('%s takes its title from the frame', (file) => {
    const source = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
    expect(source).toMatch(/<PageFrame\b|className=\{PAGE_TITLE\}/);
    // Any `<h1` left is the frame's token alone, with its words and nothing else inside.
    for (const [, inside] of source.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)) expect(inside).not.toMatch(/</);
    expect(source).not.toMatch(/<h1\b(?![^>]*className=\{PAGE_TITLE\})/);
    // The root of the page is the frame's width.
    expect(source).not.toMatch(/mx-auto[^"'`]*max-w-(?:3xl|4xl|6xl)|max-w-(?:3xl|4xl|6xl)[^"'`]*mx-auto/);
  });
});
