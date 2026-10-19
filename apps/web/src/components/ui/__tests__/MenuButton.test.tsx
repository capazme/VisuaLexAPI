import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MenuButton } from '../MenuButton';

function setup(onSelect = vi.fn(), onParentClick = vi.fn()) {
  render(
    <div>
      <div onClick={onParentClick}>
        <MenuButton label="Azioni" items={[
          { label: 'Modifica', onSelect },
          { label: 'Disattivata', onSelect: vi.fn(), disabled: true },
          { label: 'Elimina', onSelect: vi.fn(), danger: true, separatorBefore: true },
        ]}>⋯</MenuButton>
      </div>
      <button>fuori</button>
    </div>,
  );
  return { trigger: screen.getByRole('button', { name: 'Azioni' }), onSelect, onParentClick };
}

describe('MenuButton', () => {
  it('opens on click on its first item, selects, closes and returns focus', () => {
    const { trigger, onSelect } = setup();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Modifica' })).toHaveFocus();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('moves with the arrows, skipping a disabled item, and closes on Escape', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Modifica' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Elimina' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Modifica' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Elimina' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('opens from ArrowUp on its last item', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Elimina' })).toHaveFocus();
  });

  it('closes on a click outside, and never lets a click reach the card it sits in', () => {
    const { trigger, onParentClick } = setup();
    fireEvent.click(trigger);
    expect(onParentClick).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'fuori' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not select a disabled item', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni' }));
    expect(screen.getByRole('menuitem', { name: 'Disattivata' })).toBeDisabled();
  });
});
