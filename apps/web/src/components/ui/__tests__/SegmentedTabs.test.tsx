import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { dur, ease, spring } from '../../../lib/motion';
import { SegmentedTabLinks, SegmentedTabPanel, SegmentedTabs } from '../SegmentedTabs';
import { markTransition, panelEntrance } from '../segmentedTabsMotion';

type View = 'uno' | 'due' | 'tre';
const ORDER: View[] = ['uno', 'due', 'tre'];
const TABS = ORDER.map((id) => ({ id, label: id.toUpperCase() }));

function Harness({ second = false }: { second?: boolean }) {
  const [view, setView] = useState<View>('uno');
  return (
    <>
      <SegmentedTabs tabs={TABS} value={view} onChange={setView} label="Viste" panelId="viste" />
      <SegmentedTabPanel panelId="viste" order={ORDER} value={view}>
        <p>contenuto {view}</p>
      </SegmentedTabPanel>
      {second && <SegmentedTabs tabs={TABS} value="tre" onChange={() => {}} label="Altre" panelId="altre" />}
    </>
  );
}

// «Linguette che scorrono» (U1): tabs over one panel, a mark that slides, a content that comes in from the side.
describe('SegmentedTabs', () => {
  it('ties the tabs to their panel, the chosen tab the only one in the Tab order', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(screen.getByRole('tablist', { name: 'Viste' })).toBeInTheDocument();
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-controls', 'viste');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole('tabpanel', { name: 'UNO' })).toHaveTextContent('contenuto uno');
  });

  it('changes the view on a press, the panel named by the new tab', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'TRE' }));
    expect(screen.getByRole('tabpanel', { name: 'TRE' })).toHaveTextContent('contenuto tre');
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('moves the choice and the focus with the arrows, round the ends, and with Home and End', () => {
    render(<Harness />);
    const [uno, due, tre] = screen.getAllByRole('tab');
    uno.focus();
    fireEvent.keyDown(uno, { key: 'ArrowLeft' });
    expect(tre).toHaveAttribute('aria-selected', 'true');
    expect(tre).toHaveFocus();
    fireEvent.keyDown(tre, { key: 'ArrowRight' });
    expect(uno).toHaveFocus();
    fireEvent.keyDown(uno, { key: 'End' });
    expect(tre).toHaveFocus();
    fireEvent.keyDown(tre, { key: 'Home' });
    expect(uno).toHaveFocus();
    fireEvent.keyDown(uno, { key: 'ArrowRight' });
    expect(due).toHaveAttribute('aria-selected', 'true');
    // Alt and an arrow is the browser's back or forward: the tabs leave it alone.
    fireEvent.keyDown(due, { key: 'ArrowRight', altKey: true });
    expect(due).toHaveAttribute('aria-selected', 'true');
  });

  it('draws one mark a row, behind its chosen tab', () => {
    render(<Harness second />);
    const marks = document.querySelectorAll('[data-segmented-mark]');
    expect(marks).toHaveLength(2);
    expect(marks[0].closest('[role="tab"]')).toHaveTextContent('UNO');
    expect(marks[1].closest('[role="tab"]')).toHaveTextContent('TRE');
  });
});

describe('the motion of SegmentedTabs', () => {
  it('slides the mark on the app\'s spring, and draws it in place under reduced motion', () => {
    expect(markTransition(false)).toBe(spring.snappy);
    expect(markTransition(true)).toEqual({ duration: 0 });
  });

  it('brings the content in from the side the choice moved to, in CSS, not on the first drawing', () => {
    expect(panelEntrance(0, false)).toBe('');
    // To a tab further right the content moves right: it starts on the left. 12 px (spacing 3).
    expect(panelEntrance(1, true)).toBe('animate-in fade-in slide-in-from-left-3');
    expect(panelEntrance(-1, true)).toBe('animate-in fade-in slide-in-from-right-3');
    expect(panelEntrance(0, true)).toBe('animate-in fade-in');
  });

  it('plays the entrance on the view drawn after a change, and on the first one not at all', () => {
    render(<Harness />);
    const first = screen.getByRole('tabpanel').firstElementChild!;
    expect(first.className).not.toMatch(/animate-in/);
    fireEvent.click(screen.getByRole('tab', { name: 'TRE' }));
    expect(screen.getByRole('tabpanel').firstElementChild).toHaveClass('animate-in', 'slide-in-from-left-3');
    fireEvent.click(screen.getByRole('tab', { name: 'UNO' }));
    expect(screen.getByRole('tabpanel').firstElementChild).toHaveClass('slide-in-from-right-3');
  });

  // LC105: the entrance's time and curve come from lib/motion.ts, none typed by hand.
  it('times the entrance on dur.pop and the app\'s ease-out, and only after a change', () => {
    render(<Harness />);
    expect((screen.getByRole('tabpanel').firstElementChild as HTMLElement).style.animationDuration).toBe('');
    fireEvent.click(screen.getByRole('tab', { name: 'DUE' }));
    const view = screen.getByRole('tabpanel').firstElementChild as HTMLElement;
    expect(view.style.animationDuration).toBe(`${dur.pop * 1000}ms`);
    expect(view.style.animationTimingFunction).toBe(`cubic-bezier(${ease.out.join(', ')})`);
  });
  // LC19: in the dark the chosen option of a group is the light ink with dark text, as every other group's; the grey
  // mark on the grey track hardly stood out.
  it('marks the chosen tab in the light ink in the dark, with dark text', () => {
    render(<Harness />);
    const chosen = screen.getByRole('tab', { name: 'UNO' });
    expect(chosen).toHaveClass('dark:text-ink-950');
    expect(chosen.querySelector('[data-segmented-mark]')).toHaveClass('dark:bg-toga-400');
    expect(screen.getByRole('tab', { name: 'DUE' })).not.toHaveClass('dark:text-ink-950');
  });

});

describe('SegmentedTabs as a choice, with no panel', () => {
  function Choice() {
    const [kind, setKind] = useState<View>('uno');
    return <SegmentedTabs tabs={TABS} value={kind} onChange={setKind} label="Tipo di scheda" />;
  }

  it('is a radio group, not tabs: no tab promises a panel that is not there', () => {
    render(<Choice />);
    expect(screen.getByRole('radiogroup', { name: 'Tipo di scheda' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    for (const radio of radios) expect(radio).not.toHaveAttribute('aria-controls');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves the choice and the focus with the arrows and a press', () => {
    render(<Choice />);
    const [uno, due, tre] = screen.getAllByRole('radio');
    uno.focus();
    fireEvent.keyDown(uno, { key: 'ArrowRight' });
    expect(due).toHaveAttribute('aria-checked', 'true');
    expect(due).toHaveFocus();
    fireEvent.keyDown(due, { key: 'End' });
    expect(tre).toHaveFocus();
    fireEvent.click(uno);
    expect(uno).toHaveAttribute('aria-checked', 'true');
    expect(uno.querySelector('[data-segmented-mark]')).not.toBeNull();
  });
});

describe('SegmentedTabLinks', () => {
  const LINKS = [{ to: '/viste/oggi', label: 'Oggi' }, { to: '/viste/prossimi', label: 'Prossimi' }];
  function App() {
    return (
      <MemoryRouter initialEntries={['/viste/oggi']}>
        <SegmentedTabLinks links={LINKS} label="Viste di Work" />
        <Routes>
          <Route path="/viste/oggi" element={<p>vista oggi</p>} />
          <Route path="/viste/prossimi" element={<p>vista prossimi</p>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('is a navigation of links, the current one marked by aria-current and the mark', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Viste di Work' });
    expect(nav.querySelector('[role="tab"]')).toBeNull();
    const oggi = screen.getByRole('link', { name: 'Oggi' });
    expect(oggi).toHaveAttribute('aria-current', 'page');
    expect(oggi.querySelector('[data-segmented-mark]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Prossimi' })).not.toHaveAttribute('aria-current');
  });

  it('goes to the view pressed, the mark following it', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: 'Prossimi' }));
    expect(screen.getByText('vista prossimi')).toBeInTheDocument();
    const prossimi = screen.getByRole('link', { name: 'Prossimi' });
    expect(prossimi).toHaveAttribute('aria-current', 'page');
    expect(document.querySelectorAll('[data-segmented-mark]')).toHaveLength(1);
    expect(prossimi.querySelector('[data-segmented-mark]')).not.toBeNull();
  });

  // LC110: Opus's views, at their header's height from md and a bar at the screen's foot on a phone.
  it('in the small size stands at the fields\' height and corners', () => {
    render(<MemoryRouter initialEntries={['/viste/oggi']}><SegmentedTabLinks size="sm" links={LINKS} label="Viste" /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Viste' })).toHaveClass('p-0.5', 'rounded-md');
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('min-h-10', 'md:min-h-8', 'rounded-md');
  });

  it('as a foot bar puts each icon over its words on a phone, the mark tinted, the icon hidden from md', () => {
    const links = LINKS.map((link) => ({ ...link, icon: <svg data-icon /> }));
    render(<MemoryRouter initialEntries={['/viste/oggi']}><SegmentedTabLinks size="sm" footBar links={links} label="Viste" /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Viste' });
    expect(nav).toHaveClass('max-md:bg-transparent', 'max-md:p-0');
    const oggi = screen.getByRole('link', { name: 'Oggi' });
    // 44 px for a thumb on the bar, the links sharing its width.
    expect(oggi).toHaveClass('max-md:min-h-11', 'max-md:flex-1');
    expect(oggi.querySelector('[data-icon]')!.parentElement).toHaveClass('md:hidden');
    expect(oggi.querySelector('[data-icon]')!.parentElement).toHaveAttribute('aria-hidden');
    expect(oggi.querySelector('[data-icon]')!.closest('.max-md\\:flex-col')).not.toBeNull();
    expect(oggi.querySelector('[data-segmented-mark]')).toHaveClass('max-md:bg-ink-200');
  });
});

// LC106: the small row stands among the fields at their height and corners.
describe('SegmentedTabs, small', () => {
  it('makes the row 44 px on a phone and 36 from md, with 4 px corners', () => {
    render(<SegmentedTabs size="sm" label="Ordina" tabs={[{ id: 'a', label: 'Data' }, { id: 'b', label: 'Nome' }]} value="a" onChange={() => {}} />);
    const row = screen.getByRole('radiogroup', { name: 'Ordina' });
    // 2 px of track round segments of 40 and 32 px.
    expect(row).toHaveClass('p-0.5', 'rounded-md');
    expect(row).not.toHaveClass('p-1', 'rounded-lg');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveClass('min-h-10', 'md:min-h-8', 'rounded-md');
  });
});
