import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForumMyEnvironmentsView } from './ForumMyEnvironmentsView';

const noop = () => {};

describe('ForumMyEnvironmentsView - nothing published yet', () => {
  it('gives «Pubblica un dossier» 44 px on a phone and the design size from md', () => {
    render(
      <ForumMyEnvironmentsView
        environments={[]}
        loading={false}
        likingIds={new Set()}
        onLike={noop}
        onImport={noop}
        onReport={noop}
        onEdit={noop}
        onDelete={noop}
        onWithdraw={noop}
        onRepublish={noop}
        onPublishClick={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Pubblica un dossier' })).toHaveClass('min-h-[44px]', 'md:min-h-0');
  });
});
