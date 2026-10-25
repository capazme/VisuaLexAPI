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

  it('says each time it opens, by click or by the arrows', () => {
    const onOpen = vi.fn();
    render(<MenuButton label="Azioni" items={[{ label: 'Modifica', onSelect: vi.fn() }]} onOpen={onOpen}>⋯</MenuButton>);
    const trigger = screen.getByRole('button', { name: 'Azioni' });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  describe('placement="auto"', () => {
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
    function inColumn(triggerTop: number) {
      render(
        <section data-testid="column" style={{ overflowY: 'auto' }}>
          <MenuButton label="Azioni" placement="auto" items={[{ label: 'Rimuovi', onSelect: vi.fn(), danger: true }]}>⋯</MenuButton>
        </section>,
      );
      screen.getByTestId('column').getBoundingClientRect = () => rect(100, 700);
      const trigger = screen.getByRole('button', { name: 'Azioni' });
      trigger.getBoundingClientRect = () => rect(triggerTop, triggerTop + 44);
      fireEvent.click(trigger);
      return screen.getByRole('menu');
    }

    it('opens below while the column clipping it has room there', () => {
      expect(inColumn(300)).toHaveClass('mt-1');
    });

    it('opens above when the column clipping it has no room below (the last act of a column that scrolls, D7d)', () => {
      expect(inColumn(640)).toHaveClass('bottom-full', 'mb-1');
    });
  });
});
