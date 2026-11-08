import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StudyModeSettings } from './StudyModeSettings';
import { appStore } from '../../../../store/useAppStore';

afterEach(() => appStore.getState().closeSettings());

describe('StudyModeSettings — the way to the colours\' meanings', () => {
  it('its last entry opens Impostazioni at «Significato dei colori»', () => {
    render(
      <StudyModeSettings
        isOpen
        onClose={vi.fn()}
        fontSize={18}
        onFontSizeChange={vi.fn()}
        lineHeight={1.8}
        onLineHeightChange={vi.fn()}
        theme="sepia"
        onThemeChange={vi.fn()}
      />,
    );
    const entry = screen.getByRole('button', { name: 'Cambia il significato dei colori' });
    expect(entry).toHaveClass('min-h-[44px]');
    fireEvent.click(entry);
    expect(appStore.getState().settingsDialog).toEqual({ open: true, section: 'highlightColors' });
  });
});
