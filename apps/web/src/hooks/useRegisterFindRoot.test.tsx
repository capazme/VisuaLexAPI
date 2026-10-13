import { StrictMode, useRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { findRootsFor } from '../utils/findTargets';
import { useRegisterFindRoot } from './useRegisterFindRoot';

/** A surface whose text root is drawn only when `shown`, and can be swapped for a new element. */
function Surface({ tabId, targetKey = 'k', shown = true, swap = 0 }: { tabId?: string; targetKey?: string; shown?: boolean; swap?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFindRoot(tabId, targetKey, 'art. 1 c.c.', ref);
  return <section>{shown && <div key={swap} ref={ref} data-swap={swap}>il testo</div>}</section>;
}

describe('useRegisterFindRoot', () => {
  it('registers a text root that is drawn after the surface mounts, and removes it when it goes', () => {
    const { rerender, unmount } = render(<Surface tabId="t" shown={false} />);
    expect(findRootsFor('t')).toHaveLength(0);

    rerender(<Surface tabId="t" shown />);
    expect(findRootsFor('t').map((r) => r.element.dataset.swap)).toEqual(['0']);

    rerender(<Surface tabId="t" shown={false} />);
    expect(findRootsFor('t')).toHaveLength(0);

    rerender(<Surface tabId="t" shown />);
    expect(findRootsFor('t')).toHaveLength(1);
    unmount();
    expect(findRootsFor('t')).toHaveLength(0);
  });

  it('follows the element when it is replaced, and the key when it changes', () => {
    const { rerender, unmount } = render(<Surface tabId="t" />);
    rerender(<Surface tabId="t" swap={1} />);
    expect(findRootsFor('t').map((r) => r.element.dataset.swap)).toEqual(['1']);

    rerender(<Surface tabId="t" swap={1} targetKey="altro" />);
    expect(findRootsFor('t').map((r) => r.targetKey)).toEqual(['altro']);
    unmount();
  });

  it('registers once under StrictMode', () => {
    const { unmount } = render(
      <StrictMode>
        <Surface tabId="strict" />
      </StrictMode>,
    );
    expect(findRootsFor('strict')).toHaveLength(1);
    unmount();
    expect(findRootsFor('strict')).toHaveLength(0);
  });

  it('registers nothing without a tab', () => {
    const { unmount } = render(<Surface />);
    expect(findRootsFor()).toHaveLength(0);
    unmount();
  });
});
