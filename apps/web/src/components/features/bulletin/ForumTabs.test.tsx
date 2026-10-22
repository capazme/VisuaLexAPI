import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForumTabs, type ForumTab } from './ForumTabs';

// The Forum's tabs at 320 px (S7a): short labels on a phone, sharing the row in equal parts; whole from `sm`. Since U1
// they are `ui/SegmentedTabs`: a tablist whose chosen tab's mark slides.
describe('ForumTabs', () => {
  it('writes a short label on a phone and the whole one from sm, for each tab', () => {
    render(<ForumTabs active="explore" onChange={vi.fn()} pendingCount={0} />);
    for (const [short, whole] of [['Esplora', 'Esplora'], ['Miei', 'I miei pubblicati'], ['Suggeriti', 'Suggerimenti']]) {
      const tab = screen.getByText(whole, { selector: 'span.hidden' }).closest('button')!;
      expect(within(tab).getByText(short, { selector: 'span.sm\\:hidden' })).toBeInTheDocument();
      expect(within(tab).getByText(whole, { selector: 'span.hidden' })).toHaveClass('sm:inline');
    }
  });

  it('shares the row in equal parts on a phone, 44 px tall, and takes its own width from sm', () => {
    render(<ForumTabs active="explore" onChange={vi.fn()} pendingCount={0} />);
    const row = document.getElementById('tour-forum-tabs')!;
    expect(row).toHaveClass('w-full', 'sm:w-fit');
    expect(screen.getByRole('tablist', { name: 'Sezioni del Forum' })).toBe(row);
    const tabs = within(row).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) expect(tab).toHaveClass('flex-1', 'sm:flex-none', 'min-h-[44px]', 'whitespace-nowrap');
  });

  it('marks the tab shown, and changes tab on a press', async () => {
    const onChange = vi.fn();
    render(<ForumTabs active="my" onChange={onChange} pendingCount={0} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    // The mark sits behind the chosen tab only.
    expect(tabs[1].querySelector('[data-segmented-mark]')).not.toBeNull();
    expect(document.querySelectorAll('[data-segmented-mark]')).toHaveLength(1);
    await userEvent.click(tabs[2]);
    expect(onChange).toHaveBeenCalledWith('suggestions');
  });

  it('moves the choice with the arrows, the focus with it', () => {
    function Harness() {
      const [tab, setTab] = useState<ForumTab>('explore');
      return <ForumTabs active={tab} onChange={setTab} pendingCount={0} />;
    }
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveFocus();
  });

  it('counts the suggestions waiting on their tab, in words too', () => {
    render(<ForumTabs active="explore" onChange={vi.fn()} pendingCount={3} />);
    const tab = screen.getAllByRole('tab')[2];
    expect(tab).toHaveTextContent('3 in attesa');
  });
});
