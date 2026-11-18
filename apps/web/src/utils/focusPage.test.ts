import { describe, expect, it } from 'vitest';
import { focusLanding } from './focusPage';

// #640's CI: a first look that stops at once (a control already holds the focus) reached the watch before it existed.
describe('focusLanding', () => {
  it('stops at once, without throwing, when something already holds the focus', () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    let stop: (() => void) | undefined;
    expect(() => { stop = focusLanding(false); }).not.toThrow();
    stop?.();
    button.remove();
  });
});
