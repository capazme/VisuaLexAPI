import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FOCUS_BUTTON_CLEARANCE, PAGE_KICKER, PAGE_TITLE, PageFrame } from './PageFrame';
import { SECTION_PHRASES, sectionKicker } from '../../features/sections/sections';

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

  it('names the page in the title and its section, with the phrase, small over it (L-37)', () => {
    const { unmount } = render(
      <PageFrame title="Oggi" kicker="gymnasium" section="gymnasium">
        <p>corpo</p>
      </PageFrame>,
    );
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent(/^Oggi$/);
    const kicker = screen.getByText('Gymnasium · la tua palestra giuridica');
    expect(kicker).toHaveClass(...PAGE_KICKER.split(' '));
    // Over the title, in the same header, and not a heading of its own.
    expect(kicker.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kicker.tagName).toBe('P');
    // The title names only the page: the line describes it, so the focus on it says the section too.
    expect(title).toHaveAccessibleDescription('Gymnasium · la tua palestra giuridica');
    unmount();
    render(
      <PageFrame title="Cronologia">
        <p>corpo</p>
      </PageFrame>,
    );
    expect(screen.queryByText(/ · /)).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute('aria-describedby');
  });

  it('keeps the sections\' phrases in one place, each after its section\'s name', () => {
    expect(SECTION_PHRASES).toEqual({
      gymnasium: 'la tua palestra giuridica',
      opus: 'la tua officina giuridica',
      forum: 'il luogo del dibattito giuridico',
    });
    expect(sectionKicker('opus')).toBe('Opus · la tua officina giuridica');
    expect(sectionKicker('forum')).toBe('Forum · il luogo del dibattito giuridico');
  });

  it('marks a section\'s home title for the section switcher\'s focus, and no other', () => {
    const { unmount } = render(
      <PageFrame title="Oggi" section="gymnasium">
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
  'components/features/planner/OpusPage.tsx',
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

/**
 * The pages' names in one list (L-37): the phone's bar and the titles of Gymnasium's views, Opus's, the dossier list and
 * the Forum's two pages read `features/sections/pageNames.ts`; none keeps a list of its own or writes its title by hand.
 */
describe('the pages\' names (L-37)', () => {
  it.each([
    'components/features/studia/StudiaPage.tsx',
    'components/features/planner/OpusPage.tsx',
    'components/features/dossier/DossierListView.tsx',
    'components/features/bulletin/BulletinBoardPage.tsx',
    'components/features/bulletin/ForumCommunityPage.tsx',
    'components/layout/phoneBarTitle.ts',
  ])('%s reads them from the one list', (file) => {
    const source = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
    expect(source).toMatch(/from '[./]+(features\/sections\/)?pageNames'|from '\.\.\/\.\.\/features\/sections\/pageNames'/);
    expect(source).not.toMatch(/function pageName\b|const PAGES\b/);
    // A page that imports the list still takes its title from it, never a word written in its frame.
    expect(source).not.toMatch(/<PageFrame[^>]*\btitle="/);
  });

  it.each([
    ['components/features/bulletin/BulletinBoardPage.tsx', 'PUBLIC_DOSSIERS_PAGE'],
    ['components/features/bulletin/ForumCommunityPage.tsx', 'COMMUNITY_PAGE'],
    ['components/features/dossier/DossierListView.tsx', 'DOSSIER_PAGE'],
  ])('%s is titled %s', (file, name) => {
    const source = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
    expect(source).toContain(`title={${name}}`);
  });
});
