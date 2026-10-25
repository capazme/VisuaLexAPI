import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '../Tooltip';

function Row() {
  return (
    <>
      <Tooltip content="Evidenzia"><button>uno</button></Tooltip>
      <Tooltip content="Annota"><button>due</button></Tooltip>
      <Tooltip content="Copia"><button>tre</button></Tooltip>
    </>
  );
}

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits 500 ms under a pointer the first time', () => {
    render(<Row />);
    fireEvent.mouseEnter(screen.getByText('uno').parentElement!);
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByText('Evidenzia')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('Evidenzia')).toBeInTheDocument();
  });

  it('opens the next one at once within 300 ms of closing another, and waits again after', () => {
    render(<Row />);
    const first = screen.getByText('uno').parentElement!;
    const second = screen.getByText('due').parentElement!;
    fireEvent.mouseEnter(first);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.mouseLeave(first);
    act(() => vi.advanceTimersByTime(299));
    fireEvent.mouseEnter(second);
    expect(screen.getByText('Annota')).toBeInTheDocument();

    fireEvent.mouseLeave(second);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.mouseEnter(screen.getByText('tre').parentElement!);
    expect(screen.queryByText('Copia')).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText('Copia')).toBeInTheDocument();
  });

  it('shows at once on keyboard focus', () => {
    render(<Row />);
    const button = screen.getByText('due');
    fireEvent.keyDown(document.body, { key: 'Tab' });
    fireEvent.focus(button);
    expect(screen.getByText('Annota')).toBeInTheDocument();
  });

  it('leaves the focus a click gives to the pointer\'s timing', () => {
    render(<Row />);
    const button = screen.getByText('due');
    fireEvent.pointerDown(button);
    fireEvent.focus(button);
    expect(screen.queryByText('Annota')).toBeNull();
    fireEvent.mouseEnter(button.parentElement!);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText('Annota')).toBeInTheDocument();
  });
});
