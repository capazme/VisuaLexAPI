import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StudyModeSettings } from './StudyModeSettings';

describe('StudyModeSettings — no way out to the colours\' meanings (LC84)', () => {
  it('has no entry to Impostazioni: going there would leave Study Mode and lose its state', () => {
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
    expect(screen.queryByRole('button', { name: 'Cambia il significato dei colori' })).toBeNull();
  });
});
