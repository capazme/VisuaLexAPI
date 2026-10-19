import { afterEach, describe, expect, it } from 'vitest';
import { workspaceOrigin, WORKSPACE_AREA_ID } from '../workspaceOrigin';

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
