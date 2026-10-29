import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HighlightColorMenu } from './HighlightColorMenu';
import { appStore } from '../../../store/useAppStore';

afterEach(() => appStore.getState().closeSettings());

describe('HighlightColorMenu — the gear to the colours\' meanings', () => {
  it('opens Impostazioni at «Significato dei colori», its click never reaching the row it sits in', () => {
    const onRow = vi.fn();
    render(<div onClick={onRow}><HighlightColorMenu labelled triggerClassName="min-h-[44px] px-2 py-1 text-xs md:min-h-0" /></div>);
    const gear = screen.getByRole('button', { name: 'Cambia il significato dei colori' });
    // The trigger's look, 44 px wide on a phone whatever the trigger's padding.
    expect(gear).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'md:min-w-0');
    fireEvent.click(gear);
    expect(appStore.getState().settingsDialog).toEqual({ open: true, section: 'highlightColors' });
    expect(onRow).not.toHaveBeenCalled();
  });

  it('can be left out where a gear stands beside it already (Study Mode)', () => {
    render(<HighlightColorMenu meaningsGear={false} />);
    expect(screen.getByRole('button', { name: 'Colore: giallo (nuove evidenziazioni)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambia il significato dei colori' })).toBeNull();
  });
});
