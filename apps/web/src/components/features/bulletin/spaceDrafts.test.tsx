import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { forgetUserData } from '../../../services/sessionEnd';
import { useSpaceDraft } from './spaceDrafts';

describe('useSpaceDraft (LC145)', () => {
  it('keeps a space\'s text by its key until the session ends', () => {
    const first = renderHook(() => useSpaceDraft('decline:n1'));
    act(() => first.result.current[1]('Non ora'));
    first.unmount();
    // Reopened: the text is there.
    const again = renderHook(() => useSpaceDraft('decline:n1'));
    expect(again.result.current[0]).toBe('Non ora');
    again.unmount();
    // A sign-out without a reload: the next person in this tab finds nothing.
    forgetUserData();
    expect(renderHook(() => useSpaceDraft('decline:n1')).result.current[0]).toBe('');
  });
});
