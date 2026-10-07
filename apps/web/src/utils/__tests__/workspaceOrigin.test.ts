import { afterEach, describe, expect, it } from 'vitest';
import { dragLimits, workspaceOrigin, WORKSPACE_AREA_ID } from '../workspaceOrigin';

afterEach(() => { document.getElementById(WORKSPACE_AREA_ID)?.remove(); });

describe('workspaceOrigin', () => {
  it('is the results area\'s rectangle when it is on the page', () => {
    const el = document.createElement('div');
    el.id = WORKSPACE_AREA_ID;
    el.getBoundingClientRect = () => ({ left: 184, top: 32, width: 1096 } as DOMRect);
    document.body.appendChild(el);
    expect(workspaceOrigin()).toEqual({ left: 184, top: 32, width: 1096 });
  });

  it('falls back to the viewport corner when there is no such element', () => {
    expect(workspaceOrigin()).toEqual({ left: 0, top: 0, width: window.innerWidth });
  });
});

describe('dragLimits', () => {
  const origin = { left: 184, top: 32 };
  const viewport = { width: 1280, height: 800 };

  it('keeps a tab\'s viewport rect inside the window whatever the origin', () => {
    const limits = dragLimits(origin, viewport, 800, 50);
    // viewport position of the tab's left/top edge at each limit
    expect(limits.top + origin.top).toBe(0); // never above the window
    expect(limits.left + origin.left).toBe(50 - 800); // 50px of the tab stay in
    expect(limits.right + origin.left).toBe(1280 - 50);
    expect(limits.bottom + origin.top).toBe(800 - 50);
  });

  it('is the old viewport-corner behaviour when the origin is (0, 0)', () => {
    expect(dragLimits({ left: 0, top: 0 }, viewport, 800, 50)).toEqual({ left: -750, top: 0, right: 1230, bottom: 750 });
  });
});
