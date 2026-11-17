import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
// Impostazioni is a page (LC84): the gear opens it at «Significato dei colori» (`#colori`).
const openSettings = vi.hoisted(() => vi.fn());
vi.mock('../../settings/settingsRoute', () => ({ useOpenSettings: () => openSettings }));
import { StudyModeSettings } from './StudyModeSettings';

afterEach(() => openSettings.mockReset());

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
    expect(openSettings).toHaveBeenCalledWith('colori');
  });
});
