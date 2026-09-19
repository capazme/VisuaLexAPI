import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChangelogContent } from './ChangelogNotification';
import type { ChangelogEntry } from '../../config/versionConfig';

const entry = (over: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  hash: 'd3bb80b1',
  message: 'fix(sidebar): lift hover tooltips above page content',
  summary: 'lift hover tooltips above page content',
  type: 'fix',
  scope: 'sidebar',
  date: '2026-08-20 10:00:00 +0200',
  author: 'capazme',
  ...over,
});

describe('ChangelogContent', () => {
  it('shows a change without its conventional-commit prefix', () => {
    render(<ChangelogContent changelog={[entry()]} />);

    expect(screen.getByText('lift hover tooltips above page content')).toBeInTheDocument();
    expect(screen.queryByText(/fix\(sidebar\):/)).not.toBeInTheDocument();
  });

  it('labels a change with the area it touched', () => {
    render(<ChangelogContent changelog={[entry()]} />);

    expect(screen.getByText('sidebar')).toBeInTheDocument();
  });

  it('leaves out the commit hash and the author', () => {
    render(<ChangelogContent changelog={[entry()]} />);

    expect(screen.queryByText(/d3bb80b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/capazme/)).not.toBeInTheDocument();
  });

  it('falls back to the raw message when an older server sends no summary', () => {
    render(
      <ChangelogContent
        changelog={[entry({ summary: undefined, type: undefined, scope: undefined })]}
      />
    );

    expect(
      screen.getByText('fix(sidebar): lift hover tooltips above page content')
    ).toBeInTheDocument();
  });

  it('reports an empty changelog instead of rendering nothing', () => {
    render(<ChangelogContent changelog={[]} />);

    expect(screen.getByText('Nessun changelog disponibile')).toBeInTheDocument();
  });
});
